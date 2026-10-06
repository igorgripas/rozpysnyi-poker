/**
 * Політика гравців симулятора: `random` — випадкові легальні дії (`playRandomGame`),
 * `heuristic` — усі місця за евристичними ботами, `mixed` — евристичний бот проти випадкових.
 * Ігри ботів відтворює `packages/bots/test/support/simulation.ts`.
 */
export const SIMULATION_POLICIES = ['random', 'heuristic', 'mixed'] as const;
export type SimulationPolicy = (typeof SIMULATION_POLICIES)[number];

/** Запис про гру, на якій симулятор знайшов порушення. */
export interface RegressionSeed {
  readonly seed: number;
  readonly players: number;
  /** Політика гравців; без неї — `random` (записи до появи ботів у симуляторі). */
  readonly policy?: Exclude<SimulationPolicy, 'random'>;
  /** Перше порушення на момент знахідки. */
  readonly reason: string;
}

/** Розбирає й перевіряє `test/regressions.json`. */
export function parseRegressions(text: string): RegressionSeed[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('regressions.json має бути масивом');
  return data.map((entry: unknown, index) => {
    const { seed, players, reason } = (entry ?? {}) as Partial<RegressionSeed>;
    const { policy } = (entry ?? {}) as { policy?: unknown };
    if (!Number.isInteger(seed) || !Number.isInteger(players) || typeof reason !== 'string') {
      throw new Error(`regressions.json[${index}]: потрібні seed, players і reason`);
    }
    if (policy === undefined) return { seed, players, reason } as RegressionSeed;
    if (policy === 'random' || !SIMULATION_POLICIES.some((known) => known === policy)) {
      throw new Error(`regressions.json[${index}]: невідома політика ${String(policy)}`);
    }
    return { seed, players, policy, reason } as RegressionSeed;
  });
}

/** Додає нові записи без дублікатів (за seed, players і політикою). */
export function addRegressions(
  existing: readonly RegressionSeed[],
  found: readonly RegressionSeed[],
): RegressionSeed[] {
  const key = (r: RegressionSeed): string => `${r.seed}/${r.players}/${r.policy ?? 'random'}`;
  const merged = [...existing];
  const known = new Set(existing.map(key));
  for (const entry of found) {
    if (known.has(key(entry))) continue;
    known.add(key(entry));
    merged.push(entry);
  }
  return merged;
}
