import { describe, expect, it } from 'vitest';
import {
  biddingOrder,
  createSchedule,
  forbiddenDealerBid,
  handHasBidding,
  isLegalBid,
  legalBids,
} from '../src/index.js';

describe('замовлення', () => {
  it('R-4.1: bidding happens in all hands except misere and comeback', () => {
    for (let n = 3; n <= 6; n++) {
      for (const spec of createSchedule(n)) {
        const expected = spec.phase !== 'misere' && spec.phase !== 'comeback';
        expect(handHasBidding(spec)).toBe(expected);
      }
    }
  });

  it('R-4.2: first bidder is left of the dealer, dealer bids last', () => {
    expect(biddingOrder(0, 4)).toEqual([1, 2, 3, 0]);
    expect(biddingOrder(2, 3)).toEqual([0, 1, 2]);
    expect(biddingOrder(5, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('R-4.2: bidding order covers every seat exactly once for N = 3…6', () => {
    for (let n = 3; n <= 6; n++) {
      for (let dealer = 0; dealer < n; dealer++) {
        const order = biddingOrder(dealer, n);
        expect(order).toHaveLength(n);
        expect(new Set(order).size).toBe(n);
        expect(order[0]).toBe((dealer + 1) % n);
        expect(order[n - 1]).toBe(dealer);
      }
    }
  });

  it('R-4.2: bidding order rejects invalid dealer or player count', () => {
    expect(() => biddingOrder(4, 4)).toThrow(RangeError);
    expect(() => biddingOrder(-1, 4)).toThrow(RangeError);
    expect(() => biddingOrder(0, 2)).toThrow(RangeError);
    expect(() => biddingOrder(0, 7)).toThrow(RangeError);
  });

  it('R-4.3: non-dealer may bid any integer from 0 to cards dealt', () => {
    expect(legalBids(3, [], 4)).toEqual([0, 1, 2, 3]);
    expect(legalBids(3, [3, 3], 4)).toEqual([0, 1, 2, 3]);
  });

  it('R-4.3: bids outside 0…K or non-integers are illegal', () => {
    expect(isLegalBid(3, [], 4, -1)).toBe(false);
    expect(isLegalBid(3, [], 4, 4)).toBe(false);
    expect(isLegalBid(3, [], 4, 1.5)).toBe(false);
    expect(isLegalBid(3, [], 4, Number.NaN)).toBe(false);
    expect(isLegalBid(3, [], 4, 0)).toBe(true);
    expect(isLegalBid(3, [], 4, 3)).toBe(true);
  });

  it('R-4.4: dealer cannot make sum equal to cards dealt (example: 9 cards, others 8 → not 1)', () => {
    expect(forbiddenDealerBid(9, 8)).toBe(1);
    expect(legalBids(9, [3, 3, 2], 4)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(isLegalBid(9, [3, 3, 2], 4, 1)).toBe(false);
    expect(isLegalBid(9, [3, 3, 2], 4, 0)).toBe(true);
  });

  it('R-4.4: forbidden value is K when others bid 0 in total', () => {
    expect(forbiddenDealerBid(1, 0)).toBe(1);
    expect(legalBids(1, [0, 0], 3)).toEqual([0]);
  });

  it('R-4.4: no forbidden value when others already exceed cards dealt', () => {
    expect(forbiddenDealerBid(2, 3)).toBeNull();
    expect(legalBids(2, [2, 1, 0], 4)).toEqual([0, 1, 2]);
  });

  it('R-4.4: forbidden value 0 when others bid exactly K', () => {
    expect(forbiddenDealerBid(4, 4)).toBe(0);
    expect(legalBids(4, [2, 2], 3)).toEqual([1, 2, 3, 4]);
  });

  it('R-4.4: dealer always has at least one legal bid and the total never equals K', () => {
    for (let k = 1; k <= 12; k++) {
      for (let a = 0; a <= k; a++) {
        for (let b = 0; b <= k; b++) {
          const bids = legalBids(k, [a, b], 3);
          expect(bids.length).toBeGreaterThan(0);
          for (const bid of bids) {
            expect(a + b + bid).not.toBe(k);
          }
        }
      }
    }
  });

  it('R-4.4: restriction applies only to the dealer, not to other players', () => {
    // Другий гравець із трьох: сума могла б стати K, але він не роздаючий.
    expect(isLegalBid(2, [1], 3, 1)).toBe(true);
  });

  it('R-4.2: no more bids are accepted after the dealer has bid', () => {
    expect(() => legalBids(3, [1, 1, 1], 3)).toThrow(RangeError);
  });

  it('R-4.3: previous bids must be valid', () => {
    expect(() => legalBids(3, [4], 3)).toThrow(RangeError);
    expect(() => legalBids(0, [], 3)).toThrow(RangeError);
  });
});
