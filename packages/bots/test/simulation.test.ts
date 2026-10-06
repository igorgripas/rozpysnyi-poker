import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, MIN_PLAYERS, gameLog } from '@poker/engine';
import { checkGame } from '../../engine/test/support/invariants.js';
import { playSimulatedGame } from './support/simulation.js';

describe('симулятор: ігри ботів', () => {
  for (const policy of ['heuristic', 'mixed'] as const) {
    it(`R-2.3: гра «${policy}» детермінована й не порушує інваріантів`, () => {
      for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
        const state = playSimulatedGame(players * 11, players, policy);
        expect(state.status).toBe('finished');
        expect(checkGame(state)).toEqual([]);
        expect(gameLog(playSimulatedGame(players * 11, players, policy))).toEqual(gameLog(state));
      }
    });
  }

  it('політики дають різні ігри на тому самому seed', () => {
    const logs = (['random', 'heuristic', 'mixed'] as const).map((policy) =>
      JSON.stringify(gameLog(playSimulatedGame(5, 4, policy)).actions),
    );
    expect(new Set(logs).size).toBe(3);
  });
});
