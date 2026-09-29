/** Детермінований генератор псевдовипадкових чисел (R-2.3). */
export interface Rng {
  /** Наступне число в [0, 1). */
  next(): number;
  /** Наступне ціле в [0, n). */
  nextInt(n: number): number;
}

const UINT32 = 2 ** 32;

/**
 * Створює RNG з 32-бітного seed (алгоритм mulberry32).
 * Той самий seed завжди дає ту саму послідовність — на цьому тримається replay.
 */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32) {
    throw new RangeError(`Seed має бути цілим від 0 до 2^32 − 1, отримано ${seed}`);
  }
  let state = seed;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
  return {
    next,
    nextInt(n: number): number {
      if (!Number.isInteger(n) || n <= 0) {
        throw new RangeError(`Межа має бути додатним цілим, отримано ${n}`);
      }
      return Math.floor(next() * n);
    },
  };
}

/** Повертає перетасовану копію масиву (Фішер — Єйтс), вхідний масив не змінюється (R-2.3). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}
