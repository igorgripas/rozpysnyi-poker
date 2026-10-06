import { describe, expect, it } from 'vitest';
import {
  RANKS,
  SUITS,
  cardId,
  compareRank,
  createDeck,
  isJoker,
  maxCardsPerHand,
  assertPlayerCount,
} from '../src/index.js';
import { assertSeat } from '../src/cards.js';

describe('колода', () => {
  it('R-1.1: deck has 36 standard cards and 2 jokers, 38 total', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(38);
    expect(deck.filter(isJoker)).toHaveLength(2);
    expect(deck.filter((c) => !isJoker(c))).toHaveLength(36);
  });

  it('R-1.1: all cards in deck are unique', () => {
    const ids = createDeck().map(cardId);
    expect(new Set(ids).size).toBe(38);
  });

  it('R-1.1: four suits in order spades, clubs, diamonds, hearts', () => {
    expect(SUITS).toEqual(['spades', 'clubs', 'diamonds', 'hearts']);
  });

  it('R-1.1: every suit has nine ranks from 6 to ace', () => {
    const deck = createDeck();
    for (const suit of SUITS) {
      const ranks = deck.flatMap((c) => (!isJoker(c) && c.suit === suit ? [c.rank] : []));
      expect(ranks).toEqual([...RANKS]);
    }
  });

  it('R-1.1: ranks are ordered 6 < 7 < 8 < 9 < 10 < J < Q < K < A', () => {
    expect(RANKS).toHaveLength(9);
    RANKS.slice(1).forEach((higher, i) => {
      const lower = RANKS[i] ?? 6;
      expect(compareRank(higher, lower)).toBeGreaterThan(0);
      expect(compareRank(lower, higher)).toBeLessThan(0);
    });
    expect(compareRank(10, 10)).toBe(0);
  });

  it('R-1.1: createDeck returns a fresh copy each time', () => {
    const a = createDeck();
    a.pop();
    expect(createDeck()).toHaveLength(38);
  });
});

describe('гравці', () => {
  it('R-1.2: player count from 3 to 6 is accepted', () => {
    for (const n of [3, 4, 5, 6]) expect(() => assertPlayerCount(n)).not.toThrow();
  });

  it('R-1.2: player count outside 3..6 is rejected', () => {
    for (const n of [0, 1, 2, 7, 3.5, Number.NaN]) {
      expect(() => assertPlayerCount(n)).toThrow(RangeError);
    }
  });

  it('R-1.3: max cards per hand is floor(38 / N)', () => {
    expect(maxCardsPerHand(3)).toBe(12);
    expect(maxCardsPerHand(4)).toBe(9);
    expect(maxCardsPerHand(5)).toBe(7);
    expect(maxCardsPerHand(6)).toBe(6);
  });

  it('R-1.3: max cards per hand rejects invalid player count', () => {
    expect(() => maxCardsPerHand(2)).toThrow(RangeError);
  });
});

describe('місця', () => {
  it('R-1.2: seat from 0 to N-1 is accepted', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let seat = 0; seat < n; seat++) expect(() => assertSeat(seat, n)).not.toThrow();
    }
  });

  it('R-1.2: seat outside 0..N-1 is rejected with the given label', () => {
    for (const seat of [-1, 4, 1.5, Number.NaN]) {
      expect(() => assertSeat(seat, 4, 'Місце роздаючого')).toThrow(RangeError);
    }
    expect(() => assertSeat(4, 4, 'Місце роздаючого')).toThrow(
      'Місце роздаючого має бути від 0 до 3, отримано 4',
    );
    expect(() => assertSeat(-1, 3)).toThrow('Місце має бути від 0 до 2, отримано -1');
  });
});
