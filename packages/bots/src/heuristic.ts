import {
  type Action,
  type Card,
  DECK_SIZE,
  type JokerCall,
  type PlayerView,
  RANKS,
  SUITS,
  type StandardCard,
  type Suit,
  cardId,
  isJoker,
  scoreHand,
  trickWinner,
} from '@poker/engine';
import { type Bot, assertTurn } from './bot.js';

type PlayAction = Extract<Action, { type: 'play' }>;

/** Мета гравця у взятці: брати (добрати замовлення, перебір, відіграш) чи скидати. */
type Goal = 'take' | 'avoid';

/** Скільки взяток приносить власний джокер: «беру» перебʼє лише пізніший чужий джокер. */
const JOKER_CHANCE = 0.9;
/** Заходимо звичайною картою на взяття, якщо вона бере з такою ймовірністю. */
const LEAD_CONFIDENCE = 0.5;
/** Хто ходить не останнім, бере найменшою картою, що втримає взятку з такою ймовірністю. */
const HOLD_CONFIDENCE = 0.6;

/** Джокерів у колоді (R-1.1). */
const JOKER_COUNT = 2;

/** Ймовірність узяти молодшим козирем: база, приріст за кожну бракуючу карту масті, стеля. */
const RUFF_BASE = 0.35;
const RUFF_PER_SHORTNESS = 0.05;
const RUFF_MAX = 0.7;
/** У коротких роздачах масті не встигають закінчитися — перебивати козирем нічим. */
const RUFF_MIN_CARDS = 4;
/** Масть коротша за це вважається короткою: з неї швидко закінчаться карти. */
const SHORT_SUIT = 2;

/** Що бот знає про роздачу з погляду гравця. */
interface Knowledge {
  readonly view: PlayerView;
  /** Карти, про які відомо, що їх немає в суперників: власні, відкрита, зіграні на очах. */
  readonly known: ReadonlySet<string>;
  /** Невідомі карти: у руках суперників або в решті колоди. */
  readonly unknown: number;
  readonly opponents: number;
  /** Скільки карт у середньому в руці суперника. */
  readonly opponentHand: number;
}

function knowledge(view: PlayerView): Knowledge {
  const seen: Card[] = [...view.hand, ...view.trick];
  if (view.revealed !== null) seen.push(view.revealed);
  if (view.lastTrick !== null) seen.push(...view.lastTrick.cards);
  const known = new Set(seen.map(cardId));
  const tricksPlayed = view.spec.cards - (view.handSizes[view.seat] as number);
  const played = tricksPlayed * view.playerCount + view.trick.length;
  const opponents = view.playerCount - 1;
  const opponentCards = view.handSizes.reduce((sum, size) => sum + size, 0) - view.hand.length;
  return {
    view,
    known,
    unknown: Math.max(1, DECK_SIZE - view.hand.length - played),
    opponents,
    opponentHand: opponentCards / opponents,
  };
}

const standardOf = (cards: readonly Card[]): StandardCard[] =>
  cards.filter((c): c is StandardCard => !isJoker(c));

function countUnknown(k: Knowledge, suit: Suit, above = 0): number {
  return RANKS.filter((rank) => rank > above && !k.known.has(`${suit}-${rank}`)).length;
}

function unknownJokers(k: Knowledge): number {
  let count = 0;
  for (let index = 0; index < JOKER_COUNT; index++) if (!k.known.has(`joker-${index}`)) count++;
  return count;
}

/**
 * Оцінка ймовірності, що карта, якою зайшли, візьме взятку (R-5.4):
 * жодна старша карта масті чи джокер не в руках суперників і ніхто не переб'є козирем.
 */
function leadChance(k: Knowledge, card: StandardCard): number {
  const trump = k.view.trump;
  const share = Math.min(1, (k.opponents * k.opponentHand) / k.unknown);
  // Чужий джокер забирає лише одну взятку — розподіляємо цей ризик на всі карти руки.
  const jokerRisk = (1 - share / k.view.hand.length) ** unknownJokers(k);
  let chance = (1 - share) ** countUnknown(k, card.suit, card.rank) * jokerRisk;
  if (trump !== null && card.suit !== trump) {
    // Суперник переб'є козирем, якщо в нього немає масті заходу, але є козир (R-5.2).
    const suitLeft = countUnknown(k, card.suit) / k.unknown;
    const trumpsLeft = countUnknown(k, trump) / k.unknown;
    const voidInSuit = Math.max(0, 1 - suitLeft) ** k.opponentHand;
    const hasTrump = 1 - Math.max(0, 1 - trumpsLeft) ** k.opponentHand;
    chance *= (1 - voidInSuit * hasTrump) ** k.opponents;
  }
  return chance;
}

/** Оцінка ймовірності, що карта руки принесе взятку, — для замовлення. */
function cardChance(k: Knowledge, card: Card): number {
  if (isJoker(card)) return JOKER_CHANCE;
  const top = leadChance(k, card);
  const trump = k.view.trump;
  if (trump === null || card.suit !== trump || k.view.spec.cards < RUFF_MIN_CARDS) return top;
  // Молодший козир бере, перебиваючи масть, якої в руці бракує (R-5.2, R-5.4).
  const standard = standardOf(k.view.hand);
  const shortness = SUITS.filter((suit) => suit !== trump).reduce((sum, suit) => {
    const length = standard.filter((c) => c.suit === suit).length;
    return sum + Math.max(0, SHORT_SUIT - length);
  }, 0);
  const ruff = Math.min(RUFF_MAX, RUFF_BASE + RUFF_PER_SHORTNESS * shortness);
  return 1 - (1 - top) * (1 - ruff);
}

/** Розподіл кількості взяток, якщо кожна карта бере незалежно зі своєю ймовірністю. */
function trickDistribution(chances: readonly number[]): number[] {
  let dist = [1];
  for (const p of chances) {
    const next = new Array<number>(dist.length + 1).fill(0);
    dist.forEach((q, v) => {
      next[v] = (next[v] as number) + q * (1 - p);
      next[v + 1] = (next[v + 1] as number) + q * p;
    });
    dist = next;
  }
  return dist;
}

/**
 * Замовлення з найбільшим очікуваним результатом (R-4.3, R-7.1–R-7.4) серед легальних:
 * роздаючому заборонене значення виключає рушій (R-4.4), у роздачах з 1–3 картами — ні (R-4.6).
 */
function chooseBid(k: Knowledge): Action {
  const dist = trickDistribution(k.view.hand.map((c) => cardChance(k, c)));
  let best: Action | undefined;
  let bestScore = -Infinity;
  for (const action of k.view.legalActions) {
    if (action.type !== 'bid') continue;
    const expected = dist.reduce(
      (sum, q, taken) => sum + q * scoreHand(k.view.spec, action.bid, taken),
      0,
    );
    if (expected > bestScore) {
      best = action;
      bestScore = expected;
    }
  }
  return best as Action;
}

function goalOf(view: PlayerView): Goal {
  if (view.spec.phase === 'misere') return 'avoid'; // R-7.5
  if (view.spec.phase === 'comeback') return 'take'; // R-7.6
  const bid = view.bids[view.seat] ?? 0;
  const taken = view.taken[view.seat] ?? 0;
  // Недобір коштує −10 за взятку, перебір дає +1 за кожну (R-7.3, R-7.4).
  return taken === bid ? 'avoid' : 'take';
}

function sameCall(a: JokerCall | undefined, b: JokerCall | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Знаходить легальну дію з цією картою (і оголошенням джокера). */
function playAction(view: PlayerView, card: Card, call?: JokerCall): PlayAction {
  const id = cardId(card);
  const action = view.legalActions.find(
    (a): a is PlayAction => a.type === 'play' && cardId(a.card) === id && sameCall(a.call, call),
  );
  if (action === undefined) throw new Error(`Хід ${id} недопустимий`);
  return action;
}

function byRank(a: StandardCard, b: StandardCard): number {
  return a.rank - b.rank;
}

function maxBy<T>(items: readonly T[], score: (item: T) => number): T {
  return items.reduce((best, item) => (score(item) > score(best) ? item : best));
}

function minBy<T>(items: readonly T[], score: (item: T) => number): T {
  return items.reduce((best, item) => (score(item) < score(best) ? item : best));
}

/** Масть, якої найбільше (або найменше) в руці; нічия — за порядком R-1.1. */
function suitByCount(hand: readonly Card[], pick: 'most' | 'fewest', exclude?: Suit): Suit {
  const suits = SUITS.filter((suit) => suit !== exclude);
  const count = (suit: Suit): number =>
    standardOf(hand).filter((card) => card.suit === suit).length;
  return pick === 'most' ? maxBy(suits, count) : minBy(suits, count);
}

function lead(k: Knowledge, goal: Goal): PlayAction {
  const { view } = k;
  const standard = standardOf(view.hand);
  const joker = view.hand.find(isJoker);
  const chance = (card: StandardCard): number => leadChance(k, card) + card.rank / 1000;

  if (goal === 'take') {
    const strongest = standard.length > 0 ? maxBy(standard, chance) : undefined;
    if (strongest !== undefined && (leadChance(k, strongest) >= LEAD_CONFIDENCE || !joker)) {
      return playAction(view, strongest);
    }
    const jokerCard = joker as Card;
    // R-6.1: «старший козир» бере завжди; без козиря «старша <масть>» теж бере (R-6.2).
    if (view.trump !== null) return playAction(view, jokerCard, { type: 'highTrump' });
    return playAction(view, jokerCard, { type: 'high', suit: suitByCount(view.hand, 'most') });
  }

  const weakest = standard.length > 0 ? minBy(standard, chance) : undefined;
  if (weakest !== undefined && (leadChance(k, weakest) < LEAD_CONFIDENCE || !joker)) {
    return playAction(view, weakest);
  }
  // R-6.3: «маленька» масті, якої в руці найменше, — у суперників вона найімовірніше є.
  return playAction(view, joker as Card, {
    type: 'low',
    suit: suitByCount(view.hand, 'fewest'),
  });
}

function follow(k: Knowledge, goal: Goal): PlayAction {
  const { view } = k;
  const legal = view.legalActions.filter((a): a is PlayAction => a.type === 'play');
  const standard = standardOf(legal.map((a) => a.card));
  const joker = legal.find((a) => isJoker(a.card))?.card;
  const last = view.trick.length === view.playerCount - 1;
  const wins = (card: StandardCard): boolean =>
    trickWinner(view.leader, [...view.trick, card], view.trump, view.playerCount) === view.seat;
  const winners = standard.filter(wins).sort(byRank);
  const losers = standard.filter((card) => !wins(card)).sort(byRank);
  const weakest = (): StandardCard =>
    minBy(standard, (card) => leadChance(k, card) + card.rank / 1000);

  if (goal === 'take') {
    if (winners.length > 0) {
      if (last) return playAction(view, winners[0] as StandardCard);
      // Не останнім: найменша карта, яку навряд чи переб'ють, інакше найстарша.
      const safe = winners.find((card) => holdChance(k, card) >= HOLD_CONFIDENCE);
      return playAction(view, safe ?? (winners.at(-1) as StandardCard));
    }
    if (joker !== undefined) return playAction(view, joker, { type: 'take' }); // R-6.4
    return playAction(view, weakest());
  }

  // Карта, що зараз не бере, не візьме й далі: пізніші карти лише підвищують планку.
  if (losers.length > 0) {
    return playAction(
      view,
      maxBy(losers, (card) => leadChance(k, card) + card.rank / 1000),
    );
  }
  if (joker !== undefined) return playAction(view, joker, { type: 'discard' }); // R-6.5
  return playAction(view, (last ? winners.at(-1) : winners[0]) as StandardCard);
}

/** Імовірність, що карта, яка зараз бере, втримає взятку до кінця кола. */
function holdChance(k: Knowledge, card: StandardCard): number {
  const { view } = k;
  const later = view.playerCount - 1 - view.trick.length;
  const share = Math.min(1, (later * k.opponentHand) / k.unknown);
  const higher = countUnknown(k, card.suit, card.rank) + unknownJokers(k);
  return (1 - share) ** higher;
}

/**
 * Евристичний бот. Замовлення — з найбільшим очікуваним балом за оцінкою сили руки.
 * У розіграші бере, поки не добрав замовлення, і скидає, коли добрав; у мізері завжди
 * скидає, у відіграші завжди бере. Джокера береже для взяток, які інакше не взяти.
 */
export function createHeuristicBot(): Bot {
  return {
    name: 'heuristic',
    act(view) {
      assertTurn(view);
      const k = knowledge(view);
      if (view.status === 'bidding') return chooseBid(k);
      const goal = goalOf(view);
      return view.trick.length === 0 ? lead(k, goal) : follow(k, goal);
    },
  };
}
