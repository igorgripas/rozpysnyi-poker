import { type Card, type StandardCard, type Suit, assertPlayerCount, isJoker } from './cards.js';

function assertSeat(seat: number, playerCount: number, label: string): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount) {
    throw new RangeError(`${label} має бути від 0 до ${playerCount - 1}, отримано ${seat}`);
  }
}

/** Джокери розігруються за §6 (T15); тут підтримуються лише звичайні карти. */
function assertNoJokers(cards: readonly Card[]): void {
  if (cards.some(isJoker)) {
    throw new RangeError('Джокери поки не підтримуються у розіграші взяток');
  }
}

function sameCard(a: StandardCard, b: StandardCard): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Хто заходить у першу взятку (R-5.1): гравець ліворуч від роздаючого. */
export function firstLeader(dealer: number, playerCount: number): number {
  assertPlayerCount(playerCount);
  assertSeat(dealer, playerCount, 'Місце роздаючого');
  return (dealer + 1) % playerCount;
}

/**
 * Легальні карти для наступного ходу у взятці (R-5.2).
 * `trick` — карти, вже покладені у взятку, у порядку ходу; `trick[0]` — захід.
 * Заходити можна будь-якою картою. Інакше — масть заходу; якщо її немає — козир;
 * якщо немає і козиря — будь-яка карта.
 */
export function legalPlays(
  hand: readonly StandardCard[],
  trick: readonly StandardCard[],
  trump: Suit | null,
): StandardCard[] {
  assertNoJokers(hand);
  assertNoJokers(trick);
  const lead = trick[0];
  if (lead === undefined) return [...hand];
  const followSuit = hand.filter((card) => card.suit === lead.suit);
  if (followSuit.length > 0) return followSuit;
  const trumps = trump === null ? [] : hand.filter((card) => card.suit === trump);
  if (trumps.length > 0) return trumps;
  return [...hand];
}

/** Чи легальний хід `card` (R-5.2): карта є в руці й дозволена обов'язком ходу. */
export function isLegalPlay(
  hand: readonly StandardCard[],
  trick: readonly StandardCard[],
  trump: Suit | null,
  card: StandardCard,
): boolean {
  return legalPlays(hand, trick, trump).some((legal) => sameCard(legal, card));
}

/**
 * Хто бере взятку (R-5.4): найстарший козир, а без козирів — найстарша карта масті заходу.
 * `leader` — місце гравця, що зайшов; `trick` — карти у порядку ходу за годинниковою стрілкою.
 * Повертає місце переможця. Для незавершеної взятки — хто бере її на цей момент.
 */
export function trickWinner(
  leader: number,
  trick: readonly StandardCard[],
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
  assertNoJokers(trick);
  const lead = trick[0] as StandardCard;
  const beats = (card: StandardCard, best: StandardCard): boolean => {
    if (card.suit === best.suit) return card.rank > best.rank;
    return trump !== null && card.suit === trump;
  };
  let bestIndex = 0;
  let best = lead;
  trick.forEach((card, index) => {
    if (index > 0 && beats(card, best)) {
      best = card;
      bestIndex = index;
    }
  });
  return (leader + bestIndex) % playerCount;
}
