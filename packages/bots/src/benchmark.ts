import { MAX_PLAYERS, MIN_PLAYERS, scoreTable } from '@poker/engine';
import type { Bot } from './bot.js';
import { createHeuristicBot } from './heuristic.js';
import { playGame } from './play.js';
import { createRandomBot } from './random.js';

/** Поріг z-статистики, вище якого перевага вважається значущою (однобічне p ≈ 0,0013). */
export const SIGNIFICANCE_Z = 3;

export interface BenchmarkOptions {
  readonly games: number;
  /** Seed першої гри; наступні — поспіль. */
  readonly from: number;
}

/** Результати для однієї кількості гравців. */
export interface BenchmarkRow {
  readonly players: number;
  readonly games: number;
  /** Середній фінальний підсумок евристичного бота (R-7.7). */
  readonly heuristicMean: number;
  /** Середній фінальний підсумок випадкового бота. */
  readonly randomMean: number;
  /** Частка ігор, де евристичний бот на першому місці, зокрема спільному (R-9.4). */
  readonly winRate: number;
}

export interface BenchmarkResult {
  readonly games: number;
  readonly from: number;
  readonly heuristicMean: number;
  readonly randomMean: number;
  /** Середня різниця «евристичний − середній випадковий» у грі. */
  readonly meanDiff: number;
  /** Стандартна похибка середньої різниці. */
  readonly standardError: number;
  /** z-статистика парного порівняння: `meanDiff / standardError`. */
  readonly z: number;
  readonly significant: boolean;
  readonly winRate: number;
  /** Частка перемог випадкового бота — скільки вигравав би бот без переваги. */
  readonly baselineWinRate: number;
  readonly byPlayers: readonly BenchmarkRow[];
}

interface GameOutcome {
  readonly players: number;
  readonly heuristic: number;
  readonly random: number;
  readonly win: number;
  readonly randomWin: number;
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Одна гра: евристичний бот на місці `seed mod N`, решта місць — випадкові боти.
 * Кількість гравців чергується 3…6, щоб кожна гра мала інший склад.
 */
function playOne(seed: number, index: number): GameOutcome {
  const players = MIN_PLAYERS + (index % (MAX_PLAYERS - MIN_PLAYERS + 1));
  const seat = seed % players;
  const bots: Bot[] = Array.from({ length: players }, (_, s) =>
    s === seat ? createHeuristicBot() : createRandomBot((seed * MAX_PLAYERS + s) % 2 ** 32),
  );
  const finals = scoreTable(playGame(seed, bots)).summary.map((row) => row.final);
  const best = Math.max(...finals);
  const others = finals.filter((_, s) => s !== seat);
  return {
    players,
    heuristic: finals[seat] as number,
    random: mean(others),
    win: finals[seat] === best ? 1 : 0,
    randomWin: mean(others.map((score) => (score === best ? 1 : 0))),
  };
}

/** Грає `games` ігор «евристичний проти випадкових» і рахує, чи значуща перевага. */
export function runBenchmark({ games, from }: BenchmarkOptions): BenchmarkResult {
  if (!Number.isInteger(games) || games < 2 || !Number.isInteger(from) || from < 0) {
    throw new RangeError('Кількість ігор має бути цілим ≥ 2, перший seed — невідʼємним цілим');
  }
  const outcomes = Array.from({ length: games }, (_, i) => playOne((from + i) % 2 ** 32, i));
  const diffs = outcomes.map((o) => o.heuristic - o.random);
  const meanDiff = mean(diffs);
  const variance = diffs.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0) / (games - 1);
  const standardError = Math.sqrt(variance / games);
  const z = standardError === 0 ? Math.sign(meanDiff) * Infinity : meanDiff / standardError;

  const byPlayers: BenchmarkRow[] = [];
  for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
    const rows = outcomes.filter((o) => o.players === players);
    if (rows.length === 0) continue;
    byPlayers.push({
      players,
      games: rows.length,
      heuristicMean: mean(rows.map((o) => o.heuristic)),
      randomMean: mean(rows.map((o) => o.random)),
      winRate: mean(rows.map((o) => o.win)),
    });
  }

  return {
    games,
    from,
    heuristicMean: mean(outcomes.map((o) => o.heuristic)),
    randomMean: mean(outcomes.map((o) => o.random)),
    meanDiff,
    standardError,
    z,
    significant: z > SIGNIFICANCE_Z,
    winRate: mean(outcomes.map((o) => o.win)),
    baselineWinRate: mean(outcomes.map((o) => o.randomWin)),
    byPlayers,
  };
}

const num = (value: number): string => value.toFixed(1);
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** Звіт бенчмарку в markdown (для консолі й звіту CI). */
export function formatBenchmark(result: BenchmarkResult): string {
  const verdict = result.significant
    ? `✅ евристичний бот значуще сильніший (z = ${result.z.toFixed(1)} > ${SIGNIFICANCE_Z})`
    : `❌ перевага не значуща (z = ${result.z.toFixed(1)} ≤ ${SIGNIFICANCE_Z})`;
  const last = result.from + result.games - 1;
  return [
    '## Бенчмарк ботів: евристичний проти випадкового',
    '',
    `Ігор: ${result.games} (seed ${result.from}…${last}), у кожній — один евристичний бот, решта випадкові.`,
    '',
    `- Середній фінальний підсумок: евристичний **${num(result.heuristicMean)}**, випадковий **${num(result.randomMean)}**.`,
    `- Середня різниця: **${num(result.meanDiff)}** ± ${num(result.standardError)} (z = ${result.z.toFixed(1)}).`,
    `- Перемоги: евристичний **${pct(result.winRate)}**, випадковий ${pct(result.baselineWinRate)}.`,
    `- ${verdict}.`,
    '',
    '| N | Ігор | Евристичний | Випадковий | Перемоги евристичного |',
    '|---|------|-------------|------------|-----------------------|',
    ...result.byPlayers.map(
      (row) =>
        `| ${row.players} | ${row.games} | ${num(row.heuristicMean)} | ${num(row.randomMean)} | ${pct(row.winRate)} |`,
    ),
    '',
  ].join('\n');
}
