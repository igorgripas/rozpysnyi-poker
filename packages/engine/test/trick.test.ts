import { describe, expect, it } from 'vitest';
import { firstLeader, isLegalPlay, legalPlays, trickWinner } from '../src/index.js';
import type { Rank, StandardCard, Suit } from '../src/index.js';

const c = (suit: Suit, rank: Rank): StandardCard => ({ kind: 'standard', suit, rank });

describe('розіграш взяток', () => {
  it('R-5.1: first trick is led by the player left of the dealer', () => {
    expect(firstLeader(0, 4)).toBe(1);
    expect(firstLeader(3, 4)).toBe(0);
    expect(firstLeader(5, 6)).toBe(0);
    expect(firstLeader(1, 3)).toBe(2);
  });

  it('R-5.1: first leader rejects invalid dealer or player count', () => {
    expect(() => firstLeader(4, 4)).toThrow(RangeError);
    expect(() => firstLeader(-1, 4)).toThrow(RangeError);
    expect(() => firstLeader(0, 2)).toThrow(RangeError);
  });

  it('R-5.1: the winner of a trick leads the next one', () => {
    // Гравець 2 заходить, гравець 0 бере взятку — він і заходить далі.
    const winner = trickWinner(
      2,
      [c('hearts', 6), c('hearts', 9), c('hearts', 14), c('hearts', 10)],
      null,
      4,
    );
    expect(winner).toBe(0);
  });

  it('R-5.2: the leader may play any card', () => {
    const hand = [c('hearts', 6), c('spades', 9), c('clubs', 14)];
    expect(legalPlays(hand, [], 'spades')).toEqual(hand);
  });

  it('R-5.2: must follow the led suit when possible', () => {
    const hand = [c('hearts', 6), c('spades', 9), c('clubs', 14), c('hearts', 12)];
    expect(legalPlays(hand, [c('hearts', 10)], 'spades')).toEqual([
      c('hearts', 6),
      c('hearts', 12),
    ]);
    expect(isLegalPlay(hand, [c('hearts', 10)], 'spades', c('spades', 9))).toBe(false);
    expect(isLegalPlay(hand, [c('hearts', 10)], 'spades', c('hearts', 6))).toBe(true);
  });

  it('R-5.2: follow suit is determined by the lead, not by later cards', () => {
    const hand = [c('diamonds', 7), c('spades', 9)];
    // Зайшли бубною, наступний поклав козир (піку) — обов'язок усе одно класти бубну.
    expect(legalPlays(hand, [c('diamonds', 10), c('spades', 6)], 'spades')).toEqual([
      c('diamonds', 7),
    ]);
  });

  it('R-5.2: without the led suit must play a trump', () => {
    const hand = [c('clubs', 6), c('spades', 9), c('diamonds', 14), c('spades', 7)];
    expect(legalPlays(hand, [c('hearts', 10)], 'spades')).toEqual([c('spades', 9), c('spades', 7)]);
    expect(isLegalPlay(hand, [c('hearts', 10)], 'spades', c('diamonds', 14))).toBe(false);
  });

  it('R-5.2: without the led suit and trump may play any card', () => {
    const hand = [c('clubs', 6), c('diamonds', 14)];
    expect(legalPlays(hand, [c('hearts', 10)], 'spades')).toEqual(hand);
  });

  it('R-5.2: in a no-trump hand without the led suit may play any card', () => {
    const hand = [c('clubs', 6), c('spades', 9)];
    expect(legalPlays(hand, [c('hearts', 10)], null)).toEqual(hand);
  });

  it('R-5.2: a card not in hand is never legal', () => {
    const hand = [c('hearts', 6)];
    expect(isLegalPlay(hand, [c('hearts', 10)], null, c('hearts', 7))).toBe(false);
    expect(isLegalPlay(hand, [], null, c('clubs', 7))).toBe(false);
  });

  it('R-5.2: rejects a trick with an undeclared joker (see §6)', () => {
    const joker = { kind: 'joker', index: 0 } as const;
    expect(() => legalPlays([c('hearts', 6)], [joker] as never, null)).toThrow(RangeError);
  });

  it('R-5.4: the highest trump wins the trick', () => {
    expect(
      trickWinner(
        0,
        [c('hearts', 14), c('spades', 6), c('spades', 11), c('hearts', 13)],
        'spades',
        4,
      ),
    ).toBe(2);
  });

  it('R-5.4: a single trump beats higher cards of the led suit', () => {
    expect(trickWinner(1, [c('hearts', 14), c('clubs', 6), c('hearts', 13)], 'clubs', 3)).toBe(2);
  });

  it('R-5.4: without trumps the highest card of the led suit wins', () => {
    expect(
      trickWinner(
        3,
        [c('hearts', 9), c('diamonds', 14), c('hearts', 12), c('clubs', 14)],
        'spades',
        4,
      ),
    ).toBe(1);
  });

  it('R-5.4: off-suit cards never win, even if higher', () => {
    expect(trickWinner(0, [c('hearts', 6), c('diamonds', 14), c('clubs', 14)], null, 3)).toBe(0);
  });

  it('R-5.4: in a no-trump hand the highest card of the led suit wins', () => {
    expect(
      trickWinner(
        4,
        [c('diamonds', 7), c('diamonds', 14), c('spades', 14), c('diamonds', 8), c('diamonds', 6)],
        null,
        5,
      ),
    ).toBe(0);
  });

  it('R-5.4: trick winner rejects an empty trick, too many cards and undeclared jokers', () => {
    expect(() => trickWinner(0, [], null, 3)).toThrow(RangeError);
    expect(() =>
      trickWinner(0, [c('hearts', 6), c('hearts', 7), c('hearts', 8), c('hearts', 9)], null, 3),
    ).toThrow(RangeError);
    expect(() => trickWinner(3, [c('hearts', 6)], null, 3)).toThrow(RangeError);
    const joker = { kind: 'joker', index: 1 } as const;
    expect(() => trickWinner(0, [c('hearts', 6), joker] as never, null, 3)).toThrow(RangeError);
  });
});
