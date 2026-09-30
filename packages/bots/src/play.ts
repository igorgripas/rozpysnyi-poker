import { type GameState, apply, createGame, viewFor } from '@poker/engine';
import type { Bot } from './bot.js';

/**
 * Грає повну гру ботами: `bots[seat]` ходить на місці `seat` і бачить лише `viewFor(state, seat)`.
 * Кількість ботів визначає кількість гравців.
 */
export function playGame(seed: number, bots: readonly Bot[]): GameState {
  let state = createGame(seed, bots.length);
  while (state.turn !== null) {
    const seat = state.turn;
    state = apply(state, (bots[seat] as Bot).act(viewFor(state, seat)));
  }
  return state;
}
