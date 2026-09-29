/** Запис про гру, на якій симулятор знайшов порушення. */
export interface RegressionSeed {
  readonly seed: number;
  readonly players: number;
  /** Перше порушення на момент знахідки. */
  readonly reason: string;
}

/** Розбирає й перевіряє `test/regressions.json`. */
export function parseRegressions(text: string): RegressionSeed[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('regressions.json має бути масивом');
  return data.map((entry: unknown, index) => {
    const { seed, players, reason } = (entry ?? {}) as Partial<RegressionSeed>;
    if (!Number.isInteger(seed) || !Number.isInteger(players) || typeof reason !== 'string') {
      throw new Error(`regressions.json[${index}]: потрібні seed, players і reason`);
    }
    return { seed, players, reason } as RegressionSeed;
  });
}

/** Додає нові записи без дублікатів (за парою seed + players). */
export function addRegressions(
  existing: readonly RegressionSeed[],
  found: readonly RegressionSeed[],
): RegressionSeed[] {
  const key = (r: RegressionSeed): string => `${r.seed}/${r.players}`;
  const merged = [...existing];
  const known = new Set(existing.map(key));
  for (const entry of found) {
    if (known.has(key(entry))) continue;
    known.add(key(entry));
    merged.push(entry);
  }
  return merged;
}
