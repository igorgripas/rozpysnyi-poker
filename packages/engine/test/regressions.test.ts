/**
 * Регресійні seed: ігри, на яких симулятор знайшов порушення (AUTOPILOT §5 п.4).
 * Симулятор сам дописує сюди seed, що впав; після виправлення запис лишається назавжди.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/index.js';
import { checkGame, playRandomGame } from './support/invariants.js';
import {
  type RegressionSeed,
  addRegressions,
  optionsLabel,
  parseRegressions,
} from './support/regressions.js';

/** Гра з регресійного запису випадковими легальними діями з його опціями кімнати. */
function playRegression({ seed, players, options }: RegressionSeed) {
  return playRandomGame(seed, players, options);
}

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

  it('політика ботів зберігається й розрізняє записи', () => {
    const random = { seed: 1, players: 3, reason: 'a' };
    const heuristic = { ...random, policy: 'heuristic' as const };
    expect(addRegressions([random], [heuristic, heuristic])).toEqual([random, heuristic]);
    expect(parseRegressions(JSON.stringify([heuristic]))).toEqual([heuristic]);
    expect(parseRegressions(JSON.stringify([random]))).toEqual([random]);
    expect(() =>
      parseRegressions('[{"seed": 1, "players": 3, "reason": "", "policy": "x"}]'),
    ).toThrow();
  });

  it('R-10.2, R-10.3: опції кімнати зберігаються й розрізняють записи', () => {
    const plain = { seed: 1, players: 3, reason: 'a' };
    const dark = { ...plain, options: { dark: true, zeroLimit: false } };
    const both = { ...plain, options: { dark: true, zeroLimit: true } };
    expect(addRegressions([plain], [dark, both, dark])).toEqual([plain, dark, both]);
    expect(parseRegressions(JSON.stringify([dark, both]))).toEqual([dark, both]);
    expect(() =>
      parseRegressions('[{"seed": 1, "players": 3, "reason": "", "options": {"dark": 1}}]'),
    ).toThrow();
  });

  it('R-10.2, R-10.3: гра з регресійного seed грає з його опціями', () => {
    const options = { dark: true, zeroLimit: true };
    expect(playRegression({ seed: 7, players: 4, reason: '', options }).options).toEqual(options);
    expect(playRegression({ seed: 7, players: 4, reason: '' }).options).toEqual(DEFAULT_OPTIONS);
  });

  // Ігри ботів (`policy` ≠ `random`) перевіряє `packages/bots/test/regressions.test.ts`.
  for (const entry of regressions.filter((r) => r.policy === undefined)) {
    it(`seed ${entry.seed}, N=${entry.players}${optionsLabel(entry)}: ${entry.reason}`, () => {
      expect(checkGame(playRegression(entry))).toEqual([]);
    });
  }
});
