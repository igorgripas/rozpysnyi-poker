/**
 * Регресійні seed симулятора для ігор ботів (`policy` ≠ `random`); записи з випадковою
 * легальною політикою перевіряє `packages/engine/test/regressions.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkGame } from '../../engine/test/support/invariants.js';
import { parseRegressions } from '../../engine/test/support/regressions.js';
import { playSimulatedGame } from './support/simulation.js';

const regressions = parseRegressions(
  readFileSync(new URL('../../engine/test/regressions.json', import.meta.url), 'utf8'),
).flatMap(({ policy, ...entry }) => (policy === undefined ? [] : [{ ...entry, policy }]));

describe('регресійні seed симулятора: боти', () => {
  it('файл регресій читається', () => {
    expect(Array.isArray(regressions)).toBe(true);
  });

  for (const { seed, players, policy, reason } of regressions) {
    it(`seed ${seed}, N=${players}, ${policy}: ${reason}`, () => {
      expect(checkGame(playSimulatedGame(seed, players, policy))).toEqual([]);
    });
  }
});
