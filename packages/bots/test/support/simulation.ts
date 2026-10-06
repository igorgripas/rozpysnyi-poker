/**
 * Політики гравців симулятора (AUTOPILOT §5 п.4): випадкова легальна з інваріантів рушія
 * і боти з цього пакета. Спільна для `pnpm simulate` і регресійних seed ботів.
 */
import { DEFAULT_OPTIONS, MAX_PLAYERS, type GameOptions, type GameState } from '@poker/engine';
import { playRandomGame } from '../../../engine/test/support/invariants.js';
import type { SimulationPolicy } from '../../../engine/test/support/regressions.js';
import { type Bot, createHeuristicBot, createRandomBot, playGame } from '../../src/index.js';

/** Склад столу для гри ботів на `seed`. */
function botsFor(seed: number, players: number, policy: 'heuristic' | 'mixed'): Bot[] {
  // У змішаній грі евристичний бот сидить на місці `seed mod N`, решта — випадкові боти.
  const heuristicSeat = seed % players;
  return Array.from({ length: players }, (_, seat) =>
    policy === 'heuristic' || seat === heuristicSeat
      ? createHeuristicBot()
      : createRandomBot((seed * MAX_PLAYERS + seat) % 2 ** 32),
  );
}

/**
 * Повна гра за політикою: `random` — випадкові легальні дії, `heuristic` — усі місця
 * за евристичними ботами, `mixed` — один евристичний бот проти випадкових ботів.
 * `options` — опції кімнати (R-10.2, R-10.3).
 */
export function playSimulatedGame(
  seed: number,
  players: number,
  policy: SimulationPolicy,
  options: GameOptions = DEFAULT_OPTIONS,
): GameState {
  return policy === 'random'
    ? playRandomGame(seed, players, options)
    : playGame(seed, botsFor(seed, players, policy), options);
}
