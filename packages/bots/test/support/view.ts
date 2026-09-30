/** Погляд гравця для сценарних тестів ботів: руку, взятку й замовлення задає тест. */
import {
  type Action,
  type Card,
  type HandPhase,
  type PlayerView,
  type Rank,
  type Suit,
  type TrickCard,
  createGame,
  isJoker,
  legalBids,
  legalJokerCalls,
  legalPlays,
  viewFor,
} from '@poker/engine';

const SUIT_BY_LETTER: Record<string, Suit> = {
  S: 'spades',
  C: 'clubs',
  D: 'diamonds',
  H: 'hearts',
};

/** Карта зі скорочення: `S14` — туз пік, `H6` — шістка чирви, `J0` — джокер 0. */
export function card(code: string): Card {
  if (code === 'J0' || code === 'J1') return { kind: 'joker', index: code === 'J0' ? 0 : 1 };
  const suit = SUIT_BY_LETTER[code[0] as string];
  if (suit === undefined) throw new Error(`Невідома масть: ${code}`);
  return { kind: 'standard', suit, rank: Number(code.slice(1)) as Rank };
}

export const cards = (codes: string): Card[] => codes.split(' ').map(card);

export interface Scenario {
  readonly playerCount?: number;
  readonly seat?: number;
  readonly dealer?: number;
  readonly phase?: HandPhase;
  /** Кількість роздатих карт; за замовчуванням — розмір руки. */
  readonly dealt?: number;
  readonly trump?: Suit | null;
  readonly hand: string;
  /** Карти поточної взятки; джокер задається з оголошенням. */
  readonly trick?: readonly TrickCard[];
  /** Замовлення за місцями; `null` — ще не замовив. */
  readonly bids?: readonly (number | null)[];
  readonly taken?: readonly number[];
}

/** Будує погляд гравця на черзі в сценарії з легальними діями за правилами рушія. */
export function scenario(s: Scenario): PlayerView {
  const playerCount = s.playerCount ?? 4;
  const seat = s.seat ?? 0;
  const dealer = s.dealer ?? (seat + playerCount - 1) % playerCount;
  const phase = s.phase ?? 'maximum';
  const hand = cards(s.hand);
  const dealt = s.dealt ?? hand.length;
  const trump = s.trump === undefined ? 'spades' : s.trump;
  const trick = s.trick ?? [];
  const bids = s.bids ?? Array.from({ length: playerCount }, () => null);
  const bidding = phase !== 'misere' && phase !== 'comeback';
  const status = bidding && bids[seat] === null ? 'bidding' : 'playing';
  const leader = (seat - trick.length + playerCount) % playerCount;

  let legalActions: Action[];
  if (status === 'bidding') {
    const previous: number[] = [];
    for (let i = 1; i < playerCount; i++) {
      const bid = bids[(dealer + i) % playerCount];
      if (bid === null || bid === undefined) break;
      previous.push(bid);
    }
    legalActions = legalBids(dealt, previous, playerCount).map((bid) => ({
      type: 'bid',
      seat,
      bid,
    }));
  } else {
    legalActions = legalPlays(hand, trick, trump).flatMap((c): Action[] =>
      isJoker(c)
        ? legalJokerCalls(trick, trump).map((call) => ({ type: 'play', seat, card: c, call }))
        : [{ type: 'play', seat, card: c }],
    );
  }

  const base = viewFor(createGame(1, playerCount), 0);
  return {
    ...base,
    seat,
    status,
    turn: seat,
    spec: { index: 0, phase, cards: dealt, trump: { kind: 'none' }, bidding },
    dealer,
    trump,
    revealed: null,
    hand,
    handSizes: Array.from({ length: playerCount }, (_, i) => {
      const played = (i - leader + playerCount) % playerCount < trick.length;
      return played ? hand.length - 1 : hand.length;
    }),
    bids,
    bidSum: bids.reduce<number>((sum, bid) => sum + (bid ?? 0), 0),
    forbiddenBid: null,
    taken: s.taken ?? Array.from({ length: playerCount }, () => 0),
    leader,
    trick,
    lastTrick: null,
    legalActions,
  };
}

/** Звичайна карта для взятки. */
export function played(code: string): TrickCard {
  const c = card(code);
  if (isJoker(c)) throw new Error('Джокер у взятці задається з оголошенням');
  return c;
}
