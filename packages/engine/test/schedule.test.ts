import { describe, expect, it } from 'vitest';
import {
  SUITS,
  chooseFirstDealer,
  createRng,
  createSchedule,
  dealerForHand,
  maxCardsPerHand,
} from '../src/index.js';
import type { HandPhase } from '../src/index.js';

const PHASES: readonly HandPhase[] = [
  'ascending',
  'maximum',
  'suits',
  'noTrump',
  'misere',
  'comeback',
];

/** Очікувані кількості роздач за таблицею RULES.md §2. */
const TABLE: Record<number, Record<HandPhase, number> & { total: number }> = {
  3: { ascending: 11, maximum: 3, suits: 4, noTrump: 3, misere: 1, comeback: 1, total: 23 },
  4: { ascending: 8, maximum: 4, suits: 4, noTrump: 4, misere: 1, comeback: 1, total: 22 },
  5: { ascending: 6, maximum: 5, suits: 4, noTrump: 5, misere: 1, comeback: 1, total: 22 },
  6: { ascending: 5, maximum: 6, suits: 4, noTrump: 6, misere: 1, comeback: 1, total: 23 },
};

describe('розклад гри', () => {
  for (const n of [3, 4, 5, 6]) {
    it(`R-2.1: schedule for N=${n} matches the table in §2`, () => {
      const schedule = createSchedule(n);
      const expected = TABLE[n];
      expect(expected).toBeDefined();
      expect(schedule).toHaveLength(expected?.total ?? -1);
      for (const phase of PHASES) {
        expect(schedule.filter((hand) => hand.phase === phase)).toHaveLength(
          expected?.[phase] ?? -1,
        );
      }
    });
  }

  it('R-2.1: phases follow in order ascending → maximum → suits → noTrump → misere → comeback', () => {
    for (const n of [3, 4, 5, 6]) {
      const order = createSchedule(n).map((hand) => PHASES.indexOf(hand.phase));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it('R-2.1: ascending hands deal 1, 2, …, MAX − 1 cards', () => {
    for (const n of [3, 4, 5, 6]) {
      const max = maxCardsPerHand(n);
      const cards = createSchedule(n)
        .filter((hand) => hand.phase === 'ascending')
        .map((hand) => hand.cards);
      expect(cards).toEqual(Array.from({ length: max - 1 }, (_, i) => i + 1));
    }
  });

  it('R-2.1: all hands after ascending deal MAX cards', () => {
    for (const n of [3, 4, 5, 6]) {
      const max = maxCardsPerHand(n);
      for (const hand of createSchedule(n).filter((h) => h.phase !== 'ascending')) {
        expect(hand.cards).toBe(max);
      }
    }
  });

  it('R-2.1: hand indexes are consecutive from 0', () => {
    const schedule = createSchedule(4);
    expect(schedule.map((hand) => hand.index)).toEqual(schedule.map((_, i) => i));
  });

  it('R-2.1: exact schedule for N=4', () => {
    expect(createSchedule(4).map((h) => `${h.phase}:${h.cards}`)).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((c) => `ascending:${c}`),
      ...Array.from({ length: 4 }, () => 'maximum:9'),
      ...Array.from({ length: 4 }, () => 'suits:9'),
      ...Array.from({ length: 4 }, () => 'noTrump:9'),
      'misere:9',
      'comeback:9',
    ]);
  });

  it('R-2.1: suits hands have fixed trump in order ♠, ♣, ♦, ♥', () => {
    for (const n of [3, 4, 5, 6]) {
      const trumps = createSchedule(n)
        .filter((hand) => hand.phase === 'suits')
        .map((hand) => hand.trump);
      expect(trumps).toEqual(SUITS.map((suit) => ({ kind: 'fixed', suit })));
    }
  });

  it('R-2.1: ascending and maximum reveal trump, noTrump/misere/comeback have none', () => {
    for (const hand of createSchedule(5)) {
      if (hand.phase === 'ascending' || hand.phase === 'maximum') {
        expect(hand.trump).toEqual({ kind: 'revealed' });
      } else if (hand.phase !== 'suits') {
        expect(hand.trump).toEqual({ kind: 'none' });
      }
    }
  });

  it('R-2.1: misere and comeback have no bidding, other hands do', () => {
    for (const hand of createSchedule(6)) {
      expect(hand.bidding).toBe(hand.phase !== 'misere' && hand.phase !== 'comeback');
    }
  });

  it('R-1.2: schedule rejects invalid player count', () => {
    expect(() => createSchedule(2)).toThrow(RangeError);
    expect(() => createSchedule(7)).toThrow(RangeError);
  });

  it('R-2.2: dealer passes to the next player clockwise after each hand', () => {
    expect(Array.from({ length: 8 }, (_, i) => dealerForHand(2, i, 4))).toEqual([
      2, 3, 0, 1, 2, 3, 0, 1,
    ]);
  });

  it('R-2.2: dealer rotates through every hand of the schedule', () => {
    for (const n of [3, 4, 5, 6]) {
      const schedule = createSchedule(n);
      for (const hand of schedule) {
        expect(dealerForHand(1, hand.index, n)).toBe((1 + hand.index) % n);
      }
    }
  });

  it('R-2.2: dealerForHand rejects invalid arguments', () => {
    expect(() => dealerForHand(4, 0, 4)).toThrow(RangeError);
    expect(() => dealerForHand(-1, 0, 4)).toThrow(RangeError);
    expect(() => dealerForHand(0, -1, 4)).toThrow(RangeError);
    expect(() => dealerForHand(0, 1.5, 4)).toThrow(RangeError);
    expect(() => dealerForHand(0, 0, 7)).toThrow(RangeError);
  });

  it('R-2.2: first dealer is chosen randomly from all seats', () => {
    for (const n of [3, 4, 5, 6]) {
      const seen = new Set<number>();
      for (let seed = 0; seed < 200; seed++) {
        const dealer = chooseFirstDealer(createRng(seed), n);
        expect(dealer).toBeGreaterThanOrEqual(0);
        expect(dealer).toBeLessThan(n);
        seen.add(dealer);
      }
      expect(seen.size).toBe(n);
    }
  });

  it('R-2.2: first dealer is deterministic for the same seed', () => {
    expect(chooseFirstDealer(createRng(42), 5)).toBe(chooseFirstDealer(createRng(42), 5));
  });
});
