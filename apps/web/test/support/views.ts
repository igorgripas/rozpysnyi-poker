import { type GameState, apply, createGame, legalActions, viewFor } from '@poker/engine';
import { type RoomState, type WirePlayerView, playerViewSchema } from '@poker/protocol';
import { bot, human, roomState } from './fakeConnection';

/** Погляд гравця в тому вигляді, в якому він приходить мережею. */
export function wireView(state: GameState, seat: number): WirePlayerView {
  return playerViewSchema.parse(JSON.parse(JSON.stringify(viewFor(state, seat))));
}

/** Грає першими допустимими діями, доки умова не стане істинною. */
export function advanceUntil(state: GameState, done: (state: GameState) => boolean): GameState {
  let current = state;
  while (!done(current)) {
    const [action] = legalActions(current);
    if (action === undefined) throw new Error('Гра скінчилася раніше, ніж виконалася умова');
    current = apply(current, action);
  }
  return current;
}

/** Шукає гру (seed) і момент у ній, де виконується умова. */
export function findState(playerCount: number, done: (state: GameState) => boolean): GameState {
  for (let seed = 1; seed < 500; seed++) {
    let state = createGame(seed, playerCount);
    while (state.turn !== null) {
      if (done(state)) return state;
      const [action] = legalActions(state);
      if (action === undefined) break;
      state = apply(state, action);
    }
  }
  throw new Error('Не знайшли потрібного стану гри');
}

export const PLAYER_NAMES = ['Оля', 'Бот 1', 'Бот 2', 'Бот 3', 'Бот 4', 'Бот 5'];

/** Кімната під час гри, де «ви» сидите на місці `you`. */
export function gameRoom(playerCount: number, you: number): RoomState {
  const seats = PLAYER_NAMES.slice(0, playerCount).map((name, seat) =>
    seat === you ? human(`p${seat}`, name) : bot(`p${seat}`, name),
  );
  return roomState({ status: 'playing', hostId: `p${you}`, you: `p${you}`, seats });
}
