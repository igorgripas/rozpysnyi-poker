import { describe, expect, it } from 'vitest';
import {
  isLegalJokerCall,
  isLegalPlay,
  legalJokerCalls,
  legalPlays,
  trickWinner,
} from '../src/index.js';
import type {
  Card,
  JokerCall,
  JokerCard,
  PlayedJoker,
  Rank,
  StandardCard,
  Suit,
} from '../src/index.js';

const c = (suit: Suit, rank: Rank): StandardCard => ({ kind: 'standard', suit, rank });
const J0: JokerCard = { kind: 'joker', index: 0 };
const J1: JokerCard = { kind: 'joker', index: 1 };
const j = (index: 0 | 1, call: JokerCall): PlayedJoker => ({ kind: 'joker', index, call });

const highTrump = (index: 0 | 1 = 0) => j(index, { type: 'highTrump' });
const high = (suit: Suit, index: 0 | 1 = 0) => j(index, { type: 'high', suit });
const low = (suit: Suit, index: 0 | 1 = 0) => j(index, { type: 'low', suit });
const take = (index: 0 | 1 = 1) => j(index, { type: 'take' });
const discard = (index: 0 | 1 = 1) => j(index, { type: 'discard' });

describe('джокер: оголошення', () => {
  it('R-6.1: "high trump" lead is allowed only when the hand has a trump', () => {
    expect(isLegalJokerCall([], 'spades', { type: 'highTrump' })).toBe(true);
    expect(isLegalJokerCall([], null, { type: 'highTrump' })).toBe(false);
  });

  it('R-6.2: "high <suit>" lead is allowed only for a non-trump suit', () => {
    expect(isLegalJokerCall([], 'spades', { type: 'high', suit: 'hearts' })).toBe(true);
    expect(isLegalJokerCall([], 'spades', { type: 'high', suit: 'spades' })).toBe(false);
    expect(isLegalJokerCall([], null, { type: 'high', suit: 'spades' })).toBe(true);
  });

  it('R-6.3: "low <suit>" lead is allowed for any suit, including trump', () => {
    expect(isLegalJokerCall([], 'spades', { type: 'low', suit: 'spades' })).toBe(true);
    expect(isLegalJokerCall([], 'spades', { type: 'low', suit: 'clubs' })).toBe(true);
    expect(isLegalJokerCall([], null, { type: 'low', suit: 'hearts' })).toBe(true);
  });

  it('R-6.1–R-6.3: the leader must declare a lead call, not "take" or "discard"', () => {
    expect(isLegalJokerCall([], 'spades', { type: 'take' })).toBe(false);
    expect(isLegalJokerCall([], 'spades', { type: 'discard' })).toBe(false);
  });

  it('R-6.1–R-6.3: lists every legal lead call', () => {
    const withTrump = legalJokerCalls([], 'spades');
    expect(withTrump).toContainEqual({ type: 'highTrump' });
    expect(withTrump).not.toContainEqual({ type: 'high', suit: 'spades' });
    expect(withTrump).toHaveLength(1 + 3 + 4);
    const noTrump = legalJokerCalls([], null);
    expect(noTrump).not.toContainEqual({ type: 'highTrump' });
    expect(noTrump).toHaveLength(4 + 4);
  });

  it('R-6.4, R-6.5: a joker not on the lead must be "take" or "discard"', () => {
    const trick = [c('hearts', 10)];
    expect(legalJokerCalls(trick, 'spades')).toEqual([{ type: 'take' }, { type: 'discard' }]);
    expect(isLegalJokerCall(trick, 'spades', { type: 'highTrump' })).toBe(false);
    expect(isLegalJokerCall(trick, 'spades', { type: 'low', suit: 'hearts' })).toBe(false);
  });

  it('R-6.6: a joker lead may be answered with a joker "take" or "discard"', () => {
    expect(legalJokerCalls([highTrump(0)], 'spades')).toEqual([
      { type: 'take' },
      { type: 'discard' },
    ]);
  });

  it('R-6.1–R-6.5: rejects a trick with an undeclared or wrongly declared joker', () => {
    expect(() => trickWinner(0, [J0 as never], 'spades', 3)).toThrow(RangeError);
    expect(() => trickWinner(0, [highTrump()], null, 3)).toThrow(RangeError);
    expect(() => trickWinner(0, [high('spades')], 'spades', 3)).toThrow(RangeError);
    expect(() => trickWinner(0, [take(0)], 'spades', 3)).toThrow(RangeError);
    expect(() => trickWinner(0, [c('hearts', 6), low('hearts')], 'spades', 3)).toThrow(RangeError);
    expect(() => legalPlays([c('hearts', 6)], [c('hearts', 7), J1 as never], 'spades')).toThrow(
      RangeError,
    );
  });
});

describe('джокер: легальні ходи', () => {
  it('R-5.3: a joker may be played at any time, even holding the led suit or a trump', () => {
    const hand: Card[] = [c('hearts', 6), c('spades', 9), J0];
    expect(legalPlays(hand, [c('hearts', 10)], 'spades')).toEqual([c('hearts', 6), J0]);
    expect(isLegalPlay(hand, [c('hearts', 10)], 'spades', J0)).toBe(true);
    expect(legalPlays(hand, [], 'spades')).toEqual(hand);
  });

  it('R-5.3: a joker not in hand is never legal', () => {
    expect(isLegalPlay([c('hearts', 6), J0], [c('hearts', 10)], null, J1)).toBe(false);
  });

  it('R-6.1: after "high trump" each player must play the highest trump', () => {
    const hand = [c('spades', 7), c('spades', 13), c('hearts', 14), c('spades', 9)];
    expect(legalPlays(hand, [highTrump()], 'spades')).toEqual([c('spades', 13)]);
    expect(isLegalPlay(hand, [highTrump()], 'spades', c('spades', 7))).toBe(false);
  });

  it('R-6.1: after "high trump" without trumps any card may be played', () => {
    const hand = [c('hearts', 6), c('clubs', 14)];
    expect(legalPlays(hand, [highTrump(), c('spades', 6)], 'spades')).toEqual(hand);
  });

  it('R-6.2: after "high <suit>" each player must play the highest card of that suit', () => {
    const hand = [c('hearts', 6), c('hearts', 12), c('spades', 14), c('hearts', 9)];
    expect(legalPlays(hand, [high('hearts')], 'spades')).toEqual([c('hearts', 12)]);
  });

  it('R-6.2: after "high <suit>" without that suit any trump must be played', () => {
    const hand = [c('clubs', 14), c('spades', 7), c('spades', 12)];
    expect(legalPlays(hand, [high('hearts')], 'spades')).toEqual([c('spades', 7), c('spades', 12)]);
  });

  it('R-6.2: after "high <suit>" without that suit and trumps any card may be played', () => {
    const hand = [c('clubs', 14), c('diamonds', 7)];
    expect(legalPlays(hand, [high('hearts')], 'spades')).toEqual(hand);
    expect(legalPlays(hand, [high('hearts')], null)).toEqual(hand);
  });

  it('R-6.3: after "low <suit>" players follow R-5.2 with that suit as the lead', () => {
    const hand = [c('hearts', 6), c('hearts', 12), c('spades', 14)];
    expect(legalPlays(hand, [low('hearts')], 'spades')).toEqual([c('hearts', 6), c('hearts', 12)]);
    expect(legalPlays([c('clubs', 6), c('spades', 8)], [low('hearts')], 'spades')).toEqual([
      c('spades', 8),
    ]);
    expect(legalPlays([c('clubs', 6), c('diamonds', 8)], [low('hearts')], 'spades')).toEqual([
      c('clubs', 6),
      c('diamonds', 8),
    ]);
  });

  it('R-6.6: a joker releases from the duty to play the highest card', () => {
    const hand: Card[] = [c('spades', 7), c('spades', 13), J1];
    expect(legalPlays(hand, [highTrump(0)], 'spades')).toEqual([c('spades', 13), J1]);
    const hearts: Card[] = [c('hearts', 7), c('hearts', 13), J1];
    expect(legalPlays(hearts, [high('hearts', 0)], 'spades')).toEqual([c('hearts', 13), J1]);
  });

  it('R-6.1, R-6.2: the lead obligation holds for every player, not only the next one', () => {
    const hand = [c('hearts', 6), c('hearts', 12)];
    expect(legalPlays(hand, [high('hearts'), c('spades', 6), take()], 'spades')).toEqual([
      c('hearts', 12),
    ]);
  });

  it('R-6.4, R-5.2: a joker played by another player does not change the led suit', () => {
    const hand = [c('hearts', 6), c('spades', 9)];
    expect(legalPlays(hand, [c('hearts', 10), take(0)], 'spades')).toEqual([c('hearts', 6)]);
  });
});

describe('джокер: хто бере взятку', () => {
  it('R-6.1: a "high trump" joker lead takes the trick', () => {
    expect(
      trickWinner(1, [highTrump(), c('spades', 14), c('spades', 6), c('hearts', 14)], 'spades', 4),
    ).toBe(1);
  });

  it('R-6.2: a "high <suit>" joker lead takes the trick when nobody played a trump', () => {
    expect(trickWinner(0, [high('hearts'), c('hearts', 14), c('clubs', 14)], 'spades', 3)).toBe(0);
    expect(trickWinner(0, [high('hearts'), c('hearts', 14), c('clubs', 14)], null, 3)).toBe(0);
  });

  it('R-6.2: if "high <suit>" is answered with a trump, the highest trump takes the trick', () => {
    expect(
      trickWinner(
        2,
        [high('hearts'), c('spades', 7), c('hearts', 14), c('spades', 11)],
        'spades',
        4,
      ),
    ).toBe(1);
    expect(trickWinner(0, [high('hearts'), c('hearts', 14), c('spades', 6)], 'spades', 3)).toBe(2);
  });

  it('R-6.3: a "low <suit>" joker lead is beaten by any card of that suit', () => {
    expect(trickWinner(0, [low('hearts'), c('hearts', 6), c('hearts', 8)], 'spades', 3)).toBe(2);
  });

  it('R-6.3: a "low <suit>" joker lead is beaten by a trump', () => {
    expect(trickWinner(0, [low('hearts'), c('clubs', 14), c('spades', 6)], 'spades', 3)).toBe(2);
  });

  it('R-6.3: "low" in the trump suit loses to any trump, even a six', () => {
    expect(
      trickWinner(0, [low('spades'), c('hearts', 14), c('spades', 6), c('clubs', 9)], 'spades', 4),
    ).toBe(2);
  });

  it('R-6.3: a "low <suit>" joker takes the trick when nobody played that suit or a trump', () => {
    expect(trickWinner(1, [low('hearts'), c('clubs', 14), c('diamonds', 14)], 'spades', 3)).toBe(1);
    expect(trickWinner(1, [low('spades'), c('clubs', 14), c('diamonds', 14)], 'spades', 3)).toBe(1);
    expect(trickWinner(1, [low('hearts'), c('clubs', 14), c('diamonds', 14)], null, 3)).toBe(1);
  });

  it('R-6.4: a "take" joker beats any card, including trumps', () => {
    expect(
      trickWinner(0, [c('hearts', 14), take(), c('spades', 14), c('spades', 13)], 'spades', 4),
    ).toBe(1);
    expect(trickWinner(0, [c('hearts', 6), c('hearts', 14), take()], null, 3)).toBe(2);
  });

  it('R-6.4: a "take" joker beats an earlier joker lead', () => {
    expect(trickWinner(0, [highTrump(0), c('spades', 14), take(1)], 'spades', 3)).toBe(2);
    expect(trickWinner(0, [high('hearts', 0), take(1), c('spades', 14)], 'spades', 3)).toBe(1);
    expect(trickWinner(0, [low('hearts', 0), c('hearts', 14), take(1)], 'spades', 3)).toBe(2);
  });

  it('R-6.4: with two "take" jokers in a trick the later one wins', () => {
    expect(trickWinner(3, [c('hearts', 9), take(0), c('spades', 14), take(1)], 'spades', 4)).toBe(
      2,
    );
    expect(trickWinner(0, [c('hearts', 9), take(0), take(1)], null, 3)).toBe(2);
  });

  it('R-6.5: a "discard" joker never takes the trick', () => {
    expect(trickWinner(0, [c('hearts', 6), discard(), c('clubs', 14)], 'spades', 3)).toBe(0);
    expect(trickWinner(0, [c('hearts', 6), discard()], 'spades', 3)).toBe(0);
    expect(trickWinner(0, [highTrump(0), discard(1), c('hearts', 14)], 'spades', 3)).toBe(0);
  });

  it('R-6.5: a "discard" joker does not beat a "low" joker lead', () => {
    expect(trickWinner(0, [low('hearts', 0), discard(1), c('clubs', 14)], 'spades', 3)).toBe(0);
  });

  it('R-6.4, R-6.5: two jokers in a trick — "take" wins over a "discard"', () => {
    expect(trickWinner(0, [c('hearts', 6), take(0), discard(1)], 'spades', 3)).toBe(1);
    expect(trickWinner(0, [c('hearts', 6), discard(0), take(1)], 'spades', 3)).toBe(2);
    expect(
      trickWinner(0, [c('hearts', 6), discard(0), discard(1), c('hearts', 7)], 'spades', 4),
    ).toBe(3);
  });

  it('R-6.6: a joker lead answered with a "discard" joker is still taken by the lead', () => {
    expect(trickWinner(2, [high('clubs', 1), discard(0), c('clubs', 14)], null, 3)).toBe(2);
  });
});
