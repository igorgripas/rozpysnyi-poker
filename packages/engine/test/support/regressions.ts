import type { GameOptions } from '../../src/index.js';

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
  /** Опції кімнати (R-10.2, R-10.3); без них — `DEFAULT_OPTIONS`. */
  readonly options?: GameOptions;
  /** Перше порушення на момент знахідки. */
  readonly reason: string;
}

/** Розбирає й перевіряє `test/regressions.json`. */
export function parseRegressions(text: string): RegressionSeed[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('regressions.json має бути масивом');
  return data.map((entry: unknown, index) => {
    const { seed, players, reason } = (entry ?? {}) as Partial<RegressionSeed>;
    const { policy, options } = (entry ?? {}) as { policy?: unknown; options?: unknown };
    if (!Number.isInteger(seed) || !Number.isInteger(players) || typeof reason !== 'string') {
      throw new Error(`regressions.json[${index}]: потрібні seed, players і reason`);
    }
    if (
      policy !== undefined &&
      (policy === 'random' || !SIMULATION_POLICIES.some((known) => known === policy))
    ) {
      throw new Error(`regressions.json[${index}]: невідома політика ${String(policy)}`);
    }
    if (options !== undefined && !isGameOptions(options)) {
      throw new Error(`regressions.json[${index}]: опції мають містити dark і zeroLimit`);
    }
    return {
      seed,
      players,
      ...(policy === undefined ? {} : { policy }),
      ...(options === undefined ? {} : { options }),
      reason,
    } as RegressionSeed;
  });
}

function isGameOptions(value: unknown): value is GameOptions {
  const { dark, zeroLimit } = (value ?? {}) as Partial<Record<keyof GameOptions, unknown>>;
  return typeof dark === 'boolean' && typeof zeroLimit === 'boolean';
}

/** Увімкнені опції кімнати для назви тесту, напр. `, dark+zeroLimit`; порожньо — без опцій. */
export function optionsLabel({ options }: RegressionSeed): string {
  const enabled =
    options === undefined
      ? []
      : Object.keys(options).filter((key) => options[key as keyof GameOptions]);
  return enabled.length === 0 ? '' : `, ${enabled.join('+')}`;
}

/** Додає нові записи без дублікатів (за seed, players, політикою й опціями). */
export function addRegressions(
  existing: readonly RegressionSeed[],
  found: readonly RegressionSeed[],
): RegressionSeed[] {
  const key = (r: RegressionSeed): string =>
    `${r.seed}/${r.players}/${r.policy ?? 'random'}/${optionsLabel(r)}`;
  const merged = [...existing];
  const known = new Set(existing.map(key));
  for (const entry of found) {
    if (known.has(key(entry))) continue;
    known.add(key(entry));
    merged.push(entry);
  }
  return merged;
}
