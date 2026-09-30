/**
 * Регресійні seed: ігри, на яких симулятор знайшов порушення (AUTOPILOT §5 п.4).
 * Симулятор сам дописує сюди seed, що впав; після виправлення запис лишається назавжди.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkGame, playRandomGame } from './support/invariants.js';
import { type RegressionSeed, addRegressions, parseRegressions } from './support/regressions.js';

const regressions: RegressionSeed[] = parseRegressions(
  readFileSync(new URL('./regressions.json', import.meta.url), 'utf8'),
);

describe('регресійні seed симулятора', () => {
  it('файл регресій коректний', () => {
    expect(Array.isArray(regressions)).toBe(true);
    expect(() => parseRegressions('[{"seed": 1}]')).toThrow();
  });

  it('нові seed дописуються без дублікатів', () => {
    const a = { seed: 1, players: 3, reason: 'a' };
    const b = { seed: 1, players: 4, reason: 'b' };
    expect(addRegressions([a], [a, b, b])).toEqual([a, b]);
  });

  for (const { seed, players, reason } of regressions) {
    it(`seed ${seed}, N=${players}: ${reason}`, () => {
      expect(checkGame(playRandomGame(seed, players))).toEqual([]);
    });
  }
});
