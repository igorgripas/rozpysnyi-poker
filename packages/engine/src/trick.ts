import {
  type Card,
  type JokerCard,
  type StandardCard,
  type Suit,
  SUITS,
  assertPlayerCount,
  cardId,
  isJoker,
} from './cards.js';

/**
 * Оголошення джокера (§6).
 * На заході: `highTrump` (R-6.1), `high` (R-6.2), `low` (R-6.3).
 * Не на заході: `take` (R-6.4), `discard` (R-6.5).
 */
export type JokerCall =
  | { readonly type: 'highTrump' }
  | { readonly type: 'high'; readonly suit: Suit }
  | { readonly type: 'low'; readonly suit: Suit }
  | { readonly type: 'take' }
  | { readonly type: 'discard' };

/** Джокер, покладений у взятку разом з оголошенням. */
export interface PlayedJoker extends JokerCard {
  readonly call: JokerCall;
}

/** Карта у взятці: звичайна або джокер з оголошенням. */
export type TrickCard = StandardCard | PlayedJoker;

function assertSeat(seat: number, playerCount: number, label: string): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount) {
    throw new RangeError(`${label} має бути від 0 до ${playerCount - 1}, отримано ${seat}`);
  }
}

/** Легальні оголошення джокера для ходу на позиції `position` у взятці (R-6.1–R-6.6). */
function callsFor(position: number, trump: Suit | null): JokerCall[] {
  if (position > 0) return [{ type: 'take' }, { type: 'discard' }];
  const calls: JokerCall[] = [];
  if (trump !== null) calls.push({ type: 'highTrump' });
  for (const suit of SUITS) if (suit !== trump) calls.push({ type: 'high', suit });
  for (const suit of SUITS) calls.push({ type: 'low', suit });
  return calls;
}

function sameCall(a: JokerCall, b: JokerCall): boolean {
  if (a.type !== b.type) return false;
  if ((a.type === 'high' || a.type === 'low') && (b.type === 'high' || b.type === 'low')) {
    return a.suit === b.suit;
  }
  return true;
}

/** Перевіряє, що кожен джокер у взятці має оголошення, допустиме на його позиції. */
function assertTrick(trick: readonly TrickCard[], trump: Suit | null): void {
  trick.forEach((card, position) => {
    if (!isJoker(card)) return;
    const call = (card as Partial<PlayedJoker>).call;
    if (call === undefined || !callsFor(position, trump).some((legal) => sameCall(legal, call))) {
      throw new RangeError(`Недопустиме оголошення джокера на позиції ${position} у взятці`);
    }
  });
}

/** Масть, яку треба класти у відповідь на захід (R-5.2, R-6.3). */
function leadSuit(lead: TrickCard): Suit | null {
  if (!isJoker(lead)) return lead.suit;
  return lead.call.type === 'high' || lead.call.type === 'low' ? lead.call.suit : null;
}

function highestOf(cards: readonly StandardCard[]): StandardCard[] {
  const best = cards.reduce<StandardCard | undefined>(
    (top, card) => (top === undefined || card.rank > top.rank ? card : top),
    undefined,
  );
  return best === undefined ? [] : [best];
}

/** Хто заходить у першу взятку (R-5.1): гравець ліворуч від роздаючого. */
export function firstLeader(dealer: number, playerCount: number): number {
  assertPlayerCount(playerCount);
  assertSeat(dealer, playerCount, 'Місце роздаючого');
  return (dealer + 1) % playerCount;
}

/**
 * Легальні оголошення джокера, якщо його покласти наступним у взятку `trick`.
 * На заході — R-6.1–R-6.3 (`highTrump` лише з козирем, `high` лише некозирної масті);
 * не на заході — `take` або `discard` (R-6.4–R-6.6).
 */
export function legalJokerCalls(trick: readonly TrickCard[], trump: Suit | null): JokerCall[] {
  assertTrick(trick, trump);
  return callsFor(trick.length, trump);
}

/** Чи легальне оголошення `call` для джокера, покладеного наступним у взятку. */
export function isLegalJokerCall(
  trick: readonly TrickCard[],
  trump: Suit | null,
  call: JokerCall,
): boolean {
  return legalJokerCalls(trick, trump).some((legal) => sameCall(legal, call));
}

/**
 * Легальні карти для наступного ходу у взятці (R-5.2, R-5.3, R-6.1–R-6.3, R-6.6).
 * `trick` — карти, вже покладені у взятку, у порядку ходу; `trick[0]` — захід.
 * Заходити можна будь-якою картою. Інакше — масть заходу; якщо її немає — козир;
 * якщо немає і козиря — будь-яка карта. Після заходу джокером «старший козир» чи
 * «старша <масть>» обов'язково класти найстаршу карту. Джокер легальний завжди.
 */
export function legalPlays(
  hand: readonly Card[],
  trick: readonly TrickCard[],
  trump: Suit | null,
): Card[] {
  assertTrick(trick, trump);
  const lead = trick[0];
  if (lead === undefined) return [...hand];
  const standard = hand.filter((card): card is StandardCard => !isJoker(card));
  const trumps = trump === null ? [] : standard.filter((card) => card.suit === trump);
  const allowed = (cards: readonly StandardCard[]): Card[] =>
    hand.filter((card) => isJoker(card) || cards.includes(card));

  if (isJoker(lead) && lead.call.type === 'highTrump') {
    // R-6.1: найстарший козир; без козирів — будь-яка карта.
    return trumps.length > 0 ? allowed(highestOf(trumps)) : [...hand];
  }
  const suit = leadSuit(lead) as Suit;
  const followSuit = standard.filter((card) => card.suit === suit);
  if (followSuit.length > 0) {
    // R-6.2: після «старшої <масті>» — лише найстарша карта цієї масті.
    const mustHighest = isJoker(lead) && lead.call.type === 'high';
    return allowed(mustHighest ? highestOf(followSuit) : followSuit);
  }
  if (trumps.length > 0) return allowed(trumps);
  return [...hand];
}

/** Чи легальний хід `card` (R-5.2, R-5.3, R-6.x): карта є в руці й дозволена обов'язком ходу. */
export function isLegalPlay(
  hand: readonly Card[],
  trick: readonly TrickCard[],
  trump: Suit | null,
  card: Card,
): boolean {
  return legalPlays(hand, trick, trump).some((legal) => cardId(legal) === cardId(card));
}

/**
 * Хто бере взятку (R-5.4, R-6.1–R-6.5).
 * `leader` — місце гравця, що зайшов; `trick` — карти у порядку ходу за годинниковою стрілкою.
 * Повертає місце переможця. Для незавершеної взятки — хто бере її на цей момент.
 */
export function trickWinner(
  leader: number,
  trick: readonly TrickCard[],
  trump: Suit | null,
  playerCount: number,
): number {
  assertPlayerCount(playerCount);
  assertSeat(leader, playerCount, 'Місце гравця, що заходить');
  if (trick.length === 0 || trick.length > playerCount) {
    throw new RangeError(
      `У взятці має бути від 1 до ${playerCount} карт, отримано ${trick.length}`,
    );
  }
  assertTrick(trick, trump);
  const seat = (index: number): number => (leader + index) % playerCount;

  // R-6.4: джокер «беру» б'є все; з двох — пізніший.
  const lastTake = trick.findLastIndex((card) => isJoker(card) && card.call.type === 'take');
  if (lastTake >= 0) return seat(lastTake);

  const lead = trick[0] as TrickCard;
  // Джокер «маленька» — карта масті X, молодша за шістку (R-6.3); ранг 5 поза RANKS.
  const effective = (card: TrickCard): { suit: Suit; rank: number } | null => {
    if (!isJoker(card)) return { suit: card.suit, rank: card.rank };
    return card.call.type === 'low' ? { suit: card.call.suit, rank: 5 } : null;
  };

  if (isJoker(lead) && lead.call.type !== 'low') {
    // R-6.1: бере джокер. R-6.2: бере найстарший козир, якщо його поклали, інакше джокер.
    let bestIndex = 0;
    let bestRank = 0;
    trick.forEach((card, index) => {
      if (!isJoker(card) && card.suit === trump && lead.call.type === 'high') {
        if (card.rank > bestRank) {
          bestRank = card.rank;
          bestIndex = index;
        }
      }
    });
    return seat(bestIndex);
  }

  // R-5.4 (і R-6.3 для «маленької»); джокер «скидаю» не б'є нічого (R-6.5).
  let bestIndex = 0;
  let best = effective(lead) as { suit: Suit; rank: number };
  trick.forEach((card, index) => {
    const value = effective(card);
    if (index === 0 || value === null) return;
    const beats =
      value.suit === best.suit ? value.rank > best.rank : trump !== null && value.suit === trump;
    if (beats) {
      best = value;
      bestIndex = index;
    }
  });
  return seat(bestIndex);
}
