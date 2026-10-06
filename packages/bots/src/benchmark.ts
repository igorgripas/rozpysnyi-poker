import { MAX_PLAYERS, MIN_PLAYERS, scoreHand, scoreTable } from '@poker/engine';
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

/** Самогра: усі місця — евристичні боти; міряє точність замовлень (калібрування оцінки руки). */
export interface SelfPlayResult {
  readonly games: number;
  readonly from: number;
  /** Скільки замовлень зіграно (гравець × роздача із замовленням). */
  readonly bids: number;
  /** Частка замовлень, виконаних точно (`v = z`, R-7.1, R-7.2). */
  readonly exactRate: number;
  /** Частка переборів (`v > z`, R-7.3). */
  readonly overRate: number;
  /** Частка недоборів (`v < z`, R-7.4). */
  readonly underRate: number;
  /** Середні бали гравця за роздачу із замовленням. */
  readonly bidPoints: number;
  /** Мізери (гравець × роздача мізеру). */
  readonly miseres: number;
  /** Частка мізерів без жодної взятки (R-7.5). */
  readonly misereCleanRate: number;
  /** Середні бали гравця за мізер (R-7.5). */
  readonly miserePoints: number;
}

/** Грає `games` ігор лише евристичними ботами (N чергується 3…6) і рахує точність замовлень. */
export function runSelfPlay({ games, from }: BenchmarkOptions): SelfPlayResult {
  if (!Number.isInteger(games) || games < 1 || !Number.isInteger(from) || from < 0) {
    throw new RangeError('Кількість ігор має бути цілим ≥ 1, перший seed — невідʼємним цілим');
  }
  let bids = 0;
  let exact = 0;
  let over = 0;
  let bidPoints = 0;
  let miseres = 0;
  let clean = 0;
  let miserePoints = 0;
  for (let i = 0; i < games; i++) {
    const players = MIN_PLAYERS + (i % (MAX_PLAYERS - MIN_PLAYERS + 1));
    const bots = Array.from({ length: players }, () => createHeuristicBot());
    const state = playGame((from + i) % 2 ** 32, bots);
    for (const record of state.history) {
      record.taken.forEach((taken, seat) => {
        const bid = record.bids[seat] ?? null;
        const points = scoreHand(record.spec, bid, taken);
        if (bid !== null) {
          bids++;
          bidPoints += points;
          if (taken === bid) exact++;
          else if (taken > bid) over++;
        } else if (record.spec.phase === 'misere') {
          miseres++;
          miserePoints += points;
          if (taken === 0) clean++;
        }
      });
    }
  }
  const rate = (count: number, total: number): number => (total === 0 ? 0 : count / total);
  return {
    games,
    from,
    bids,
    exactRate: rate(exact, bids),
    overRate: rate(over, bids),
    underRate: rate(bids - exact - over, bids),
    bidPoints: rate(bidPoints, bids),
    miseres,
    misereCleanRate: rate(clean, miseres),
    miserePoints: rate(miserePoints, miseres),
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

/** Звіт самогри в markdown. */
export function formatSelfPlay(result: SelfPlayResult): string {
  const last = result.from + result.games - 1;
  return [
    '## Самогра: лише евристичні боти',
    '',
    `Ігор: ${result.games} (seed ${result.from}…${last}), замовлень: ${result.bids}, мізерів: ${result.miseres}.`,
    '',
    `- Замовлення виконано точно: **${pct(result.exactRate)}**, перебір ${pct(result.overRate)}, недобір ${pct(result.underRate)}.`,
    `- Середні бали за роздачу із замовленням: **${num(result.bidPoints)}**.`,
    `- Мізер без взяток: **${pct(result.misereCleanRate)}**, середні бали за мізер ${num(result.miserePoints)}.`,
    '',
  ].join('\n');
}
