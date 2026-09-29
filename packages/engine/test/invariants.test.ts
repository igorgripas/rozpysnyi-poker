import { describe, expect, it } from 'vitest';
import { apply, createGame, legalActions } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import {
  checkBidSums,
  checkCardsPlayedOnce,
  checkGame,
  checkReplay,
  checkScoreFromLog,
  checkTrickSums,
  playRandomGame,
} from './support/invariants.js';

/** Підміняє останню завершену роздачу в історії. */
function corruptLastHand(state: GameState, patch: (taken: number[]) => number[]): GameState {
  const history = [...state.history];
  const last = history.at(-1);
  if (last === undefined) throw new Error('Немає завершених роздач');
  history[history.length - 1] = { ...last, taken: patch([...last.taken]) };
  return { ...state, history };
}

describe('перевірки інваріантів гри', () => {
  it('випадкова гра детермінована: той самий seed дає ту саму гру', () => {
    const a = playRandomGame(7, 4);
    const b = playRandomGame(7, 4);
    expect(a.status).toBe('finished');
    expect(b.actions).toEqual(a.actions);
    expect(playRandomGame(8, 4).actions).not.toEqual(a.actions);
  });

  it('коректна гра не має порушень', () => {
    for (let players = 3; players <= 6; players++) {
      expect(checkGame(playRandomGame(100 + players, players))).toEqual([]);
    }
  });

  it('R-5.4: помічає підмінені взятки в історії', () => {
    const state = corruptLastHand(playRandomGame(1, 3), (taken) => {
      taken[0] = (taken[0] as number) + 1;
      return taken;
    });
    expect(checkTrickSums(state).length).toBeGreaterThan(0);
    expect(checkScoreFromLog(state).length).toBeGreaterThan(0);
    expect(checkReplay(state).length).toBeGreaterThan(0);
  });

  it('R-4.4: помічає суму замовлень, що дорівнює кількості карт', () => {
    const state = playRandomGame(2, 3);
    const history = state.history.map((record) =>
      record.spec.index === 0 ? { ...record, bids: [1, 0, 0] } : record,
    );
    const actions = state.actions.map((action, index) =>
      index < 3 && action.type === 'bid' ? { ...action, bid: action.seat === 0 ? 1 : 0 } : action,
    );
    expect(checkBidSums({ ...state, history, actions }).length).toBeGreaterThan(0);
  });

  it('помічає карту, зіграну двічі', () => {
    const state = playRandomGame(3, 3);
    const first = state.actions.findIndex((a) => a.type === 'play');
    const second = state.actions.findIndex((a, i) => i > first && a.type === 'play');
    const actions = state.actions.map((action, index) =>
      index === second ? (state.actions[first] as Action) : action,
    );
    expect(checkCardsPlayedOnce({ ...state, actions }).length).toBeGreaterThan(0);
  });

  it('незавершена гра теж перевіряється через replay', () => {
    let state = createGame(5, 5);
    for (let i = 0; i < 40; i++) state = apply(state, legalActions(state)[0] as Action);
    expect(checkGame(state)).toEqual([]);
  });
});
