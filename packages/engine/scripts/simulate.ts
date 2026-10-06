/**
 * Симулятор (AUTOPILOT §5 п.4): грає повні ігри N = 3…6 випадковими легальними ходами,
 * евристичними ботами й мішаним столом (`packages/bots`) і перевіряє інваріанти.
 * Ігри чергують опції кімнати: без опцій, «Темна» (R-10.2), обмеження нулів (R-10.3) і обидві.
 * Seed, що впав, разом з політикою й опціями дописується в `test/regressions.json`.
 *
 * Запуск: `pnpm simulate [--games 10000] [--from 1]`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type GameOptions, MAX_PLAYERS, MIN_PLAYERS } from '../src/index.js';
import { checkGame } from '../test/support/invariants.js';
import {
  type RegressionSeed,
  type SimulationPolicy,
  addRegressions,
  optionsLabel,
  parseRegressions,
} from '../test/support/regressions.js';
// Рушій не залежить від ботів; симулятор — інструмент розробки, тож підключає їх напряму.
import { playSimulatedGame } from '../../bots/test/support/simulation.js';

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
// Ігри ботів у кілька разів повільніші (`viewFor` на кожен хід), тож половина ігор —
// випадкові легальні дії, решта — евристичні боти й мішаний стіл.
const POLICY_CYCLE: readonly SimulationPolicy[] = ['random', 'heuristic', 'random', 'mixed'];
const OPTIONS_CYCLE: readonly GameOptions[] = [
  { dark: false, zeroLimit: false },
  { dark: true, zeroLimit: false },
  { dark: false, zeroLimit: true },
  { dark: true, zeroLimit: true },
];
const failures: RegressionSeed[] = [];
const started = performance.now();

for (let game = 0; game < games; game++) {
  const seed = (from + game) % 2 ** 32;
  const players = MIN_PLAYERS + (game % variants);
  // Політика змінюється після кожного кола N = 3…6, тож кожна кількість гравців грає кожною.
  const policy = POLICY_CYCLE[
    Math.floor(game / variants) % POLICY_CYCLE.length
  ] as SimulationPolicy;
  // Опції змінюються після кожного циклу політик: кожна пара N × політика грає з кожними.
  const round = Math.floor(game / (variants * POLICY_CYCLE.length));
  const options = OPTIONS_CYCLE[round % OPTIONS_CYCLE.length] as GameOptions;
  let errors: string[];
  try {
    errors = checkGame(playSimulatedGame(seed, players, policy, options));
  } catch (error) {
    errors = [`виняток: ${(error as Error).message}`];
  }
  if (errors.length > 0) {
    const reason = errors[0] as string;
    const entry = { seed, players, ...(policy === 'random' ? {} : { policy }), options, reason };
    failures.push(entry);
    console.error(
      `✗ seed ${seed}, N=${players}, ${policy}${optionsLabel(entry)}:\n  ${errors.slice(0, 5).join('\n  ')}`,
    );
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
