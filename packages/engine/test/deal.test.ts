import { describe, expect, it } from 'vitest';
import { cardId, createDeck, createRng, deal, maxCardsPerHand, shuffle } from '../src/index.js';

describe('роздача', () => {
  it('R-2.3: deal gives each player the requested number of cards', () => {
    const result = deal(shuffle(createDeck(), createRng(1)), 4, 9);
    expect(result.hands).toHaveLength(4);
    for (const hand of result.hands) expect(hand).toHaveLength(9);
    expect(result.rest).toHaveLength(2);
  });

  it('R-1.3: at MAX cards the remaining deck size matches the table', () => {
    const expectedRest: Record<number, number> = { 3: 2, 4: 2, 5: 3, 6: 2 };
    for (const n of [3, 4, 5, 6]) {
      const result = deal(createDeck(), n, maxCardsPerHand(n));
      expect(result.rest).toHaveLength(expectedRest[n] ?? -1);
    }
  });

  it('R-2.3: dealt cards and rest together form the whole deck without duplicates', () => {
    const deck = shuffle(createDeck(), createRng(77));
    const { hands, rest } = deal(deck, 5, 7);
    const all = [...hands.flat(), ...rest].map(cardId);
    expect(all).toHaveLength(38);
    expect(new Set(all).size).toBe(38);
  });

  it('R-2.3: cards are dealt one at a time in turn, rest keeps deck order', () => {
    const deck = createDeck();
    const { hands, rest } = deal(deck, 3, 2);
    expect(hands[0]).toEqual([deck[0], deck[3]]);
    expect(hands[1]).toEqual([deck[1], deck[4]]);
    expect(hands[2]).toEqual([deck[2], deck[5]]);
    expect(rest).toEqual(deck.slice(6));
  });

  it('R-2.3: same seed gives the same deal', () => {
    const a = deal(shuffle(createDeck(), createRng(2026)), 6, 6);
    const b = deal(shuffle(createDeck(), createRng(2026)), 6, 6);
    expect(a).toEqual(b);
  });

  it('R-2.3: different seeds give different deals', () => {
    const a = deal(shuffle(createDeck(), createRng(2026)), 6, 6);
    const b = deal(shuffle(createDeck(), createRng(2027)), 6, 6);
    expect(a).not.toEqual(b);
  });

  it('R-1.2: deal rejects invalid player count', () => {
    expect(() => deal(createDeck(), 2, 1)).toThrow(RangeError);
    expect(() => deal(createDeck(), 7, 1)).toThrow(RangeError);
  });

  it('R-1.3: deal rejects hand size outside 1..MAX', () => {
    expect(() => deal(createDeck(), 4, 0)).toThrow(RangeError);
    expect(() => deal(createDeck(), 4, 10)).toThrow(RangeError);
    expect(() => deal(createDeck(), 4, 1.5)).toThrow(RangeError);
  });

  it('R-1.1: deal rejects a deck that is not 38 cards', () => {
    expect(() => deal(createDeck().slice(1), 4, 9)).toThrow(RangeError);
  });
});
