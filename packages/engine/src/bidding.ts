import { assertPlayerCount } from './cards.js';
import type { HandSpec } from './schedule.js';

/** Чи робляться замовлення в роздачі (R-4.1): усі, крім «Мізеру» і «Відіграшу». */
export function handHasBidding(spec: HandSpec): boolean {
  return spec.bidding;
}

/**
 * Порядок замовлення (R-4.2): першим — гравець ліворуч від роздаючого,
 * далі за годинниковою стрілкою, роздаючий — останнім.
 */
export function biddingOrder(dealer: number, playerCount: number): number[] {
  assertPlayerCount(playerCount);
  if (!Number.isInteger(dealer) || dealer < 0 || dealer >= playerCount) {
    throw new RangeError(
      `Місце роздаючого має бути від 0 до ${playerCount - 1}, отримано ${dealer}`,
    );
  }
  return Array.from({ length: playerCount }, (_, i) => (dealer + 1 + i) % playerCount);
}

/** Найбільша кількість карт, за якої R-4.4 не діє (R-4.6): роздачі з 1, 2 і 3 картами. */
const UNRESTRICTED_DEALER_MAX_CARDS = 3;

/**
 * Заборонене для роздаючого значення (R-4.4): `K − (сума замовлень інших)`,
 * якщо воно в межах 0…K; інакше `null`. У роздачах з 1–3 картами — завжди `null` (R-4.6).
 */
export function forbiddenDealerBid(cards: number, othersSum: number): number | null {
  if (cards <= UNRESTRICTED_DEALER_MAX_CARDS) return null;
  const forbidden = cards - othersSum;
  return forbidden >= 0 && forbidden <= cards ? forbidden : null;
}

/** Скільки нулів поспіль можна замовити з опцією R-10.3. */
export const MAX_ZERO_STREAK = 3;

/**
 * Чи заборонене гравцеві замовлення 0 за R-10.3: у трьох попередніх роздачах із замовленням
 * він замовив 0. `previousBids` — його замовлення в попередніх роздачах гри по порядку;
 * `null` — роздача без замовлень (мізер, відіграш), вона послідовність не змінює.
 */
export function zeroBidForbidden(previousBids: readonly (number | null)[]): boolean {
  const bids = previousBids.filter((bid): bid is number => bid !== null);
  return bids.length >= MAX_ZERO_STREAK && bids.slice(-MAX_ZERO_STREAK).every((bid) => bid === 0);
}

function isInRange(cards: number, bid: number): boolean {
  return Number.isInteger(bid) && bid >= 0 && bid <= cards;
}

/**
 * Легальні замовлення для наступного гравця за порядком R-4.2.
 * `previousBids` — замовлення, вже зроблені в цій роздачі, у порядку черги.
 * Діапазон 0…K (R-4.3); для роздаючого (останнього) виключається заборонене значення (R-4.4),
 * крім роздач з 1–3 картами (R-4.6). `zeroForbidden` — 0 заборонений за R-10.3.
 */
export function legalBids(
  cards: number,
  previousBids: readonly number[],
  playerCount: number,
  zeroForbidden = false,
): number[] {
  assertPlayerCount(playerCount);
  if (!Number.isInteger(cards) || cards < 1) {
    throw new RangeError(`Кількість карт має бути додатним цілим, отримано ${cards}`);
  }
  if (previousBids.length >= playerCount) {
    throw new RangeError('Усі гравці вже замовили: роздаючий замовляє останнім');
  }
  for (const bid of previousBids) {
    if (!isInRange(cards, bid)) {
      throw new RangeError(`Замовлення має бути цілим від 0 до ${cards}, отримано ${bid}`);
    }
  }
  const isDealer = previousBids.length === playerCount - 1;
  const forbidden = isDealer
    ? forbiddenDealerBid(
        cards,
        previousBids.reduce((sum, bid) => sum + bid, 0),
      )
    : null;
  const bids: number[] = [];
  for (let bid = zeroForbidden ? 1 : 0; bid <= cards; bid++) {
    if (bid !== forbidden) bids.push(bid);
  }
  return bids;
}

/** Чи легальне замовлення `bid` для наступного гравця (R-4.3, R-4.4, R-4.6). */
export function isLegalBid(
  cards: number,
  previousBids: readonly number[],
  playerCount: number,
  bid: number,
): boolean {
  return isInRange(cards, bid) && legalBids(cards, previousBids, playerCount).includes(bid);
}
