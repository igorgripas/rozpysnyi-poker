/**
 * Симулятор (AUTOPILOT §5 п.4): грає повні ігри N = 3…6 випадковими легальними ходами
 * і перевіряє інваріанти. Seed, що впав, дописується в `test/regressions.json`.
 *
 * Запуск: `pnpm simulate [--games 10000] [--from 1]`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { MAX_PLAYERS, MIN_PLAYERS } from '../src/index.js';
import { checkGame, playRandomGame } from '../test/support/invariants.js';
import {
  type RegressionSeed,
  addRegressions,
  parseRegressions,
} from '../test/support/regressions.js';

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '10000' },
    from: { type: 'string', default: '1' },
  },
});
const games = Number(values.games);
const from = Number(values.from);
if (!Number.isInteger(games) || games < 1 || !Number.isInteger(from) || from < 0) {
  throw new RangeError('--games має бути додатним цілим, --from — невідʼємним цілим');
}

const variants = MAX_PLAYERS - MIN_PLAYERS + 1;
const failures: RegressionSeed[] = [];
const started = performance.now();

for (let game = 0; game < games; game++) {
  const seed = (from + game) % 2 ** 32;
  const players = MIN_PLAYERS + (game % variants);
  let errors: string[];
  try {
    errors = checkGame(playRandomGame(seed, players));
  } catch (error) {
    errors = [`виняток: ${(error as Error).message}`];
  }
  if (errors.length > 0) {
    failures.push({ seed, players, reason: errors[0] as string });
    console.error(`✗ seed ${seed}, N=${players}:\n  ${errors.slice(0, 5).join('\n  ')}`);
  }
}

const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`Симуляція: ${games} ігор (seed ${from}…${from + games - 1}) за ${seconds} с.`);

if (failures.length > 0) {
  const file = new URL('../test/regressions.json', import.meta.url);
  const merged = addRegressions(parseRegressions(readFileSync(file, 'utf8')), failures);
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  console.error(`Порушень: ${failures.length}. Seed додано в test/regressions.json.`);
  process.exit(1);
}
