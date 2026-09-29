import { describe, expect, it } from 'vitest';
import { createDeck, createRng, cardId, shuffle } from '../src/index.js';

describe('seed RNG', () => {
  it('R-2.3: same seed produces the same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('R-2.3: different seeds produce different sequences', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('R-2.3: next() returns floats in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('R-2.3: nextInt(n) returns integers in [0, n) covering the whole range', () => {
    const rng = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const x = rng.nextInt(6);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(6);
      seen.add(x);
    }
    expect(seen.size).toBe(6);
  });

  it('R-2.3: nextInt rejects non-positive or non-integer bound', () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
  });

  it('R-2.3: seed must be a 32-bit unsigned integer', () => {
    expect(() => createRng(-1)).toThrow(RangeError);
    expect(() => createRng(1.5)).toThrow(RangeError);
    expect(() => createRng(2 ** 32)).toThrow(RangeError);
    expect(() => createRng(0)).not.toThrow();
    expect(() => createRng(2 ** 32 - 1)).not.toThrow();
  });

  it('R-2.3: sequence for a fixed seed is stable across versions', () => {
    const rng = createRng(20260929);
    const values = Array.from({ length: 5 }, () => rng.nextInt(1000));
    expect(values).toEqual([330, 736, 292, 254, 596]);
  });
});

describe('тасування', () => {
  it('R-2.3: shuffle is a permutation of the deck', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck, createRng(99));
    expect(shuffled).toHaveLength(38);
    expect(shuffled.map(cardId).sort()).toEqual(deck.map(cardId).sort());
  });

  it('R-2.3: shuffle does not mutate the input', () => {
    const deck = createDeck();
    const before = deck.map(cardId);
    shuffle(deck, createRng(99));
    expect(deck.map(cardId)).toEqual(before);
  });

  it('R-2.3: same seed gives the same shuffle', () => {
    const a = shuffle(createDeck(), createRng(5)).map(cardId);
    const b = shuffle(createDeck(), createRng(5)).map(cardId);
    expect(a).toEqual(b);
  });

  it('R-2.3: different seeds give different shuffles', () => {
    const a = shuffle(createDeck(), createRng(5)).map(cardId);
    const b = shuffle(createDeck(), createRng(6)).map(cardId);
    expect(a).not.toEqual(b);
  });

  it('R-2.3: shuffle actually reorders the deck', () => {
    const deck = createDeck().map(cardId);
    const shuffled = shuffle(createDeck(), createRng(5)).map(cardId);
    expect(shuffled).not.toEqual(deck);
  });

  it('R-2.3: every card can land in the first position', () => {
    const firsts = new Set<string>();
    for (let seed = 0; seed < 2000; seed++) {
      const [first] = shuffle(createDeck(), createRng(seed));
      if (first) firsts.add(cardId(first));
    }
    expect(firsts.size).toBe(38);
  });
});
