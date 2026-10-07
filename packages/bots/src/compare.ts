import { type GameState, MAX_PLAYERS, MIN_PLAYERS, scoreTable } from '@poker/engine';
import type { Bot } from './bot.js';
import { playGame } from './play.js';

/** Поріг |z| для A/B-порівняння: двобічне p ≈ 0,05. */
export const COMPARE_Z = 2;

export interface CompareOptions {
  readonly games: number;
  /** Seed першої гри; наступні — поспіль. */
  readonly from: number;
  /** Нова версія бота. Фабрика викликається на кожне місце в кожній грі. */
  readonly candidate: () => Bot;
  /** Базова версія бота. */
  readonly base: () => Bot;
}

/** Результати однієї версії на місці, яке порівнюємо. */
export interface CompareSide {
  /** Середній фінальний підсумок (R-7.7). */
  readonly mean: number;
  /** Скільки замовлень зіграно на цьому місці. */
  readonly bids: number;
  /** Частка точно виконаних замовлень (R-7.1, R-7.2). */
  readonly exactRate: number;
  /** Частка переборів (R-7.3). */
  readonly overRate: number;
}

export interface CompareRow {
  readonly players: number;
  readonly games: number;
  readonly candidateMean: number;
  readonly baseMean: number;
}

export interface CompareResult {
  readonly games: number;
  readonly from: number;
  readonly candidate: CompareSide;
  readonly base: CompareSide;
  /** Середня парна різниця «кандидат − база» на тому самому місці й seed. */
  readonly meanDiff: number;
  readonly standardError: number;
  readonly z: number;
  /** |z| > COMPARE_Z. */
  readonly significant: boolean;
  readonly byPlayers: readonly CompareRow[];
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

interface SeatOutcome {
  readonly final: number;
  readonly bids: number;
  readonly exact: number;
  readonly over: number;
}

function seatOutcome(state: GameState, seat: number): SeatOutcome {
  let bids = 0;
  let exact = 0;
  let over = 0;
  for (const record of state.history) {
    const bid = record.bids[seat] ?? null;
    if (bid === null) continue;
    const taken = record.taken[seat] as number;
    bids++;
    if (taken === bid) exact++;
    else if (taken > bid) over++;
  }
  return { final: scoreTable(state).summary[seat]?.final as number, bids, exact, over };
}

function side(outcomes: readonly SeatOutcome[]): CompareSide {
  const bids = outcomes.reduce((sum, o) => sum + o.bids, 0);
  const rate = (count: number): number => (bids === 0 ? 0 : count / bids);
  return {
    mean: mean(outcomes.map((o) => o.final)),
    bids,
    exactRate: rate(outcomes.reduce((sum, o) => sum + o.exact, 0)),
    overRate: rate(outcomes.reduce((sum, o) => sum + o.over, 0)),
  };
}

/**
 * A/B-порівняння двох версій бота на тих самих роздачах. На кожен seed — дві гри з тією самою
 * колодою: кандидат на місці `seed mod N` проти базових ботів, і ті самі базові боти на всіх
 * місцях. Парна різниця на тому самому місці прибирає вплив карт, тож похибка в рази менша,
 * ніж у незалежних іграх. N чергується 3…6 (R-1.2).
 */
export function compareBots({ games, from, candidate, base }: CompareOptions): CompareResult {
  if (!Number.isInteger(games) || games < 2 || !Number.isInteger(from) || from < 0) {
    throw new RangeError('Кількість ігор має бути цілим ≥ 2, перший seed — невідʼємним цілим');
  }
  const rows = Array.from({ length: games }, (_, i) => {
    const seed = (from + i) % 2 ** 32;
    const players = MIN_PLAYERS + (i % (MAX_PLAYERS - MIN_PLAYERS + 1));
    const seat = seed % players;
    const mixed = Array.from({ length: players }, (_, s) => (s === seat ? candidate() : base()));
    const baseline = Array.from({ length: players }, () => base());
    return {
      players,
      candidate: seatOutcome(playGame(seed, mixed), seat),
      base: seatOutcome(playGame(seed, baseline), seat),
    };
  });
  const diffs = rows.map((r) => r.candidate.final - r.base.final);
  const meanDiff = mean(diffs);
  const variance = diffs.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0) / (games - 1);
  const standardError = Math.sqrt(variance / games);
  const z =
    standardError === 0
      ? meanDiff === 0
        ? 0
        : Math.sign(meanDiff) * Infinity
      : meanDiff / standardError;

  const byPlayers: CompareRow[] = [];
  for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
    const group = rows.filter((r) => r.players === players);
    if (group.length === 0) continue;
    byPlayers.push({
      players,
      games: group.length,
      candidateMean: mean(group.map((r) => r.candidate.final)),
      baseMean: mean(group.map((r) => r.base.final)),
    });
  }

  return {
    games,
    from,
    candidate: side(rows.map((r) => r.candidate)),
    base: side(rows.map((r) => r.base)),
    meanDiff,
    standardError,
    z,
    significant: Math.abs(z) > COMPARE_Z,
    byPlayers,
  };
}

const num = (value: number): string => value.toFixed(1);
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** Звіт A/B-порівняння в markdown; `labels` — як назвати версії (напр. git-ref). */
export function formatComparison(
  result: CompareResult,
  labels: { readonly candidate: string; readonly base: string },
): string {
  const z = result.z.toFixed(1);
  const verdict = !result.significant
    ? `немає значущої різниці (|z| = ${Math.abs(result.z).toFixed(1)} ≤ ${COMPARE_Z})`
    : result.z > 0
      ? `✅ кандидат значуще сильніший (z = ${z})`
      : `❌ кандидат значуще слабший (z = ${z})`;
  const last = result.from + result.games - 1;
  const line = (name: string, s: CompareSide): string =>
    `| ${name} | ${num(s.mean)} | ${pct(s.exactRate)} | ${pct(s.overRate)} | ${s.bids} |`;
  return [
    `## A/B: ${labels.candidate} проти ${labels.base}`,
    '',
    `Ігор: ${result.games} (seed ${result.from}…${last}). На кожен seed кандидат грає на одному місці проти базових ботів, а база — на тому самому місці з тими самими картами.`,
    '',
    '| Версія | Середній підсумок | Влучні замовлення | Перебір | Замовлень |',
    '|--------|-------------------|-------------------|---------|-----------|',
    line(`кандидат (${labels.candidate})`, result.candidate),
    line(`база (${labels.base})`, result.base),
    '',
    `- Парна різниця: **${num(result.meanDiff)}** ± ${num(result.standardError)} (z = ${z}).`,
    `- ${verdict}.`,
    '',
    '| N | Ігор | Кандидат | База |',
    '|---|------|----------|------|',
    ...result.byPlayers.map(
      (row) =>
        `| ${row.players} | ${row.games} | ${num(row.candidateMean)} | ${num(row.baseMean)} |`,
    ),
    '',
  ].join('\n');
}
