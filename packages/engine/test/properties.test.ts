/**
 * Property-based тести (AUTOPILOT §5 п.3): для будь-якого seed, будь-якої кількості гравців
 * і будь-якої послідовності легальних ходів інваріанти гри виконуються.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, createGame, createRng, gameLog, legalActions, replay } from '../src/index.js';
import type { Action, GameOptions, GameState } from '../src/index.js';
import {
  checkBidSums,
  checkCardsPlayedOnce,
  checkReplay,
  checkScoreFromLog,
  checkTrickSums,
  checkZeroStreaks,
} from './support/invariants.js';

const seed = fc.integer({ min: 0, max: 2 ** 32 - 1 });
const players = fc.integer({ min: 3, max: 6 });
const RUNS = { numRuns: 100 };
/** Опції кімнати (§10): будь-яке поєднання. */
const anyOptions = fc.record({ dark: fc.boolean(), zeroLimit: fc.boolean() });
const OFF: GameOptions = { dark: false, zeroLimit: false };

/** Гра за випадковими легальними ходами; `limit` — після скількох дій зупинитись. */
function playLegal(
  gameSeed: number,
  playerCount: number,
  movesSeed: number,
  limit = Infinity,
  options: GameOptions = OFF,
) {
  const rng = createRng(movesSeed);
  let state: GameState = createGame(gameSeed, playerCount, options);
  for (let step = 0; step < limit && state.status !== 'finished'; step++) {
    const actions = legalActions(state);
    state = apply(state, actions[rng.nextInt(actions.length)] as Action);
  }
  return state;
}

function forAnyGame(check: (state: GameState) => string[]): void {
  fc.assert(
    fc.property(seed, players, seed, anyOptions, (gameSeed, playerCount, movesSeed, options) => {
      const state = playLegal(gameSeed, playerCount, movesSeed, Infinity, options);
      expect(state.status).toBe('finished');
      expect(check(state)).toEqual([]);
    }),
    RUNS,
  );
}

describe('property: інваріанти будь-якої гри з легальними ходами (з опціями R-10.1 і без)', () => {
  it('R-1.1, R-2.3: кожна роздана карта зіграна рівно один раз', () => {
    forAnyGame(checkCardsPlayedOnce);
  });

  it('R-5.4: сума взяток кожної роздачі дорівнює кількості карт у роздачі', () => {
    forAnyGame(checkTrickSums);
  });

  it('R-4.4, R-4.6: сума замовлень не дорівнює кількості карт у роздачах з 4+ картами', () => {
    forAnyGame(checkBidSums);
  });

  it('R-10.3: з опцією ніхто не замовляє 0 більше трьох разів поспіль', () => {
    forAnyGame(checkZeroStreaks);
  });

  it('R-7.1–R-7.7, R-8.2, R-8.4, R-10.2: перерахунок балів з логу дає ту саму таблицю', () => {
    forAnyGame(checkScoreFromLog);
  });

  it('R-2.3, R-10.1: replay(seed, log) повної гри дає той самий стан', () => {
    forAnyGame(checkReplay);
  });

  it('R-2.3: replay(seed, log) незавершеної гри дає той самий стан', () => {
    fc.assert(
      fc.property(
        seed,
        players,
        seed,
        fc.nat(800),
        anyOptions,
        (gameSeed, playerCount, movesSeed, steps, options) => {
          const state = playLegal(gameSeed, playerCount, movesSeed, steps, options);
          expect(replay(gameSeed, gameLog(state))).toEqual(state);
        },
      ),
      RUNS,
    );
  });
});
