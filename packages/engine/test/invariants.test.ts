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

/** Підміняє замовлення роздачі `index` (за місцями) в історії й лозі дій. */
function withBids(state: GameState, index: number, bids: readonly number[]): GameState {
  const n = state.playerCount;
  const start = state.history
    .slice(0, index)
    .reduce((offset, record) => offset + (record.spec.bidding ? n : 0) + n * record.spec.cards, 0);
  const history = state.history.map((record) =>
    record.spec.index === index ? { ...record, bids: [...bids] } : record,
  );
  const actions = state.actions.map((action, i) =>
    i >= start && i < start + n && action.type === 'bid'
      ? { ...action, bid: bids[action.seat] as number }
      : action,
  );
  return { ...state, history, actions };
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

  it('R-4.4: помічає суму замовлень, що дорівнює кількості карт (роздача на 4 карти)', () => {
    const state = playRandomGame(2, 3);
    expect(state.history[3]?.spec.cards).toBe(4);
    expect(checkBidSums(state)).toEqual([]);
    expect(checkBidSums(withBids(state, 3, [2, 1, 1]))).toEqual([
      'роздача 4: сума замовлень 4 дорівнює кількості карт',
    ]);
  });

  it('R-4.6: не помічає суму замовлень, що дорівнює кількості карт, у роздачах з 1–3 картами', () => {
    const state = playRandomGame(2, 3);
    expect(checkBidSums(withBids(state, 0, [1, 0, 0]))).toEqual([]);
    expect(checkBidSums(withBids(state, 1, [1, 1, 0]))).toEqual([]);
    expect(checkBidSums(withBids(state, 2, [1, 1, 1]))).toEqual([]);
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
