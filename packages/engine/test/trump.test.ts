import { describe, expect, it } from 'vitest';
import {
  SUITS,
  createDeck,
  createRng,
  createSchedule,
  deal,
  determineTrump,
  shuffle,
} from '../src/index.js';
import type { Card, HandSpec, TrumpRule } from '../src/index.js';

const revealed: TrumpRule = { kind: 'revealed' };
const joker: Card = { kind: 'joker', index: 0 };
const queenOfClubs: Card = { kind: 'standard', suit: 'clubs', rank: 12 };
const sixOfHearts: Card = { kind: 'standard', suit: 'hearts', rank: 6 };

describe('козир', () => {
  it('R-3.1: suit of the top card of the rest becomes trump', () => {
    const result = determineTrump(revealed, [queenOfClubs, sixOfHearts]);
    expect(result).toEqual({ trump: 'clubs', revealed: queenOfClubs });
  });

  it('R-3.1: only the top card is revealed, not the others', () => {
    const result = determineTrump(revealed, [sixOfHearts, joker, queenOfClubs]);
    expect(result).toEqual({ trump: 'hearts', revealed: sixOfHearts });
  });

  it('R-3.2: revealed joker means the hand is played without trump', () => {
    const result = determineTrump(revealed, [joker, queenOfClubs]);
    expect(result).toEqual({ trump: null, revealed: joker });
  });

  it('R-3.2: second joker revealed also means no trump', () => {
    const second: Card = { kind: 'joker', index: 1 };
    expect(determineTrump(revealed, [second]).trump).toBeNull();
  });

  it('R-3.1: revealing requires a non-empty rest of the deck', () => {
    expect(() => determineTrump(revealed, [])).toThrow(RangeError);
  });

  it('R-3.3: in "suits" hands trump is fixed and no card is revealed', () => {
    for (const suit of SUITS) {
      const result = determineTrump({ kind: 'fixed', suit }, [joker, queenOfClubs]);
      expect(result).toEqual({ trump: suit, revealed: null });
    }
  });

  it('R-3.4: no-trump hands have no trump and reveal nothing', () => {
    expect(determineTrump({ kind: 'none' }, [queenOfClubs])).toEqual({
      trump: null,
      revealed: null,
    });
  });

  it('R-3.3: fixed trump in schedule follows ♠, ♣, ♦, ♥ order', () => {
    const rest = [queenOfClubs];
    const trumps = createSchedule(4)
      .filter((spec) => spec.phase === 'suits')
      .map((spec) => determineTrump(spec.trump, rest).trump);
    expect(trumps).toEqual([...SUITS]);
  });

  it('R-3.4: no-trump hands of the schedule have no trump', () => {
    for (const n of [3, 4, 5, 6]) {
      for (const spec of createSchedule(n)) {
        if (spec.phase === 'noTrump') {
          const result = determineTrump(spec.trump, [queenOfClubs]);
          expect(result).toEqual({ trump: null, revealed: null });
        }
      }
    }
  });

  it('R-3.1: misere and comeback reveal the top card; under rules version 1 they had no trump', () => {
    for (const n of [3, 4, 5, 6]) {
      for (const phase of ['misere', 'comeback'] as const) {
        const current = createSchedule(n).find((spec) => spec.phase === phase) as HandSpec;
        expect(determineTrump(current.trump, [queenOfClubs])).toEqual({
          trump: 'clubs',
          revealed: queenOfClubs,
        });
        const legacy = createSchedule(n, undefined, 1).find((spec) => spec.phase === phase);
        expect(determineTrump((legacy as HandSpec).trump, [queenOfClubs])).toEqual({
          trump: null,
          revealed: null,
        });
      }
    }
  });

  it('R-3.1: ascending, maximum, misere and comeback hands of a real deal reveal the top card of the rest', () => {
    const revealing = ['ascending', 'maximum', 'misere', 'comeback'];
    for (const n of [3, 4, 5, 6]) {
      for (const spec of createSchedule(n)) {
        if (!revealing.includes(spec.phase)) continue;
        const { rest } = deal(shuffle(createDeck(), createRng(spec.index + n)), n, spec.cards);
        const result = determineTrump(spec.trump, rest);
        const top = rest[0] as Card;
        expect(result.revealed).toEqual(top);
        expect(result.trump).toBe(top.kind === 'joker' ? null : top.suit);
      }
    }
  });
});
