import { type GameOptions, type GameState, apply, createGame, viewFor } from '@poker/engine';
import type { Bot } from './bot.js';

/**
 * Грає повну гру ботами: `bots[seat]` ходить на місці `seat` і бачить лише `viewFor(state, seat)`.
 * Кількість ботів визначає кількість гравців; `options` — опції кімнати (§10).
 */
export function playGame(
  seed: number,
  bots: readonly Bot[],
  options?: Partial<GameOptions>,
): GameState {
  let state = createGame(seed, bots.length, options);
  while (state.turn !== null) {
    const seat = state.turn;
    state = apply(state, (bots[seat] as Bot).act(viewFor(state, seat)));
  }
  return state;
}
