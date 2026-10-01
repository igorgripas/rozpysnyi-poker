/**
 * Генератор фікстури сумісності (T56): грає випадковими легальними ходами `--actions` дій
 * і записує seed, лог і очікуваний стан у `test/golden/compat/`. Фікстури — захищені файли:
 * нові додаються лише через PR з міткою `spec-change`.
 *
 * Запуск: `pnpm --filter @poker/engine compat:fixture --seed 7 --players 4 --actions 90`.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ENGINE_LOG_VERSION,
  apply,
  createGame,
  createRng,
  gameLog,
  legalActions,
} from '../src/index.js';
import type { Action } from '../src/index.js';
import { compatSnapshot, formatFixture } from '../test/support/compat.js';

const { values } = parseArgs({
  options: {
    seed: { type: 'string' },
    players: { type: 'string' },
    actions: { type: 'string' },
    title: { type: 'string' },
  },
});
const seed = Number(values.seed);
const players = Number(values.players);
const count = Number(values.actions);
if (![seed, players, count].every((value) => Number.isInteger(value) && value >= 0)) {
  throw new RangeError('--seed, --players і --actions мають бути невідʼємними цілими');
}

const rng = createRng(seed);
let state = createGame(seed, players);
while (state.actions.length < count && state.status !== 'finished') {
  const legal = legalActions(state);
  state = apply(state, legal[rng.nextInt(legal.length)] as Action);
}
if (state.status === 'finished') throw new RangeError('Гра завершилась: потрібна незавершена гра');

const snapshot = compatSnapshot(state);
const name = `v${ENGINE_LOG_VERSION}-${players}p-seed${seed}.json`;
const file = new URL(`../test/golden/compat/${name}`, import.meta.url);
const title =
  values.title ??
  `N = ${players}, роздача ${snapshot.hand} на ${snapshot.cards} карт, ${state.actions.length} дій`;
writeFileSync(
  file,
  formatFixture({ title, rules: ['R-2.3'], seed, log: gameLog(state), expect: snapshot }),
);
console.log(`Записано test/golden/compat/${name}`);
