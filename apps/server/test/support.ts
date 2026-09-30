import { createRng } from '@poker/engine';
import type { Result } from '@poker/protocol';
import type { RandomSource } from '../src/random.js';

/** Детермінований генератор для тестів: той самий seed — ті самі коди, токени й перемішування. */
export function testRandom(seed = 1): RandomSource {
  const rng = createRng(seed);
  let counter = 0;
  return {
    int: (max) => rng.nextInt(max),
    token: () => `token-${seed}-${String(++counter).padStart(16, '0')}`,
    id: () => `id${++counter}`,
  };
}

/** Розпаковує успішний результат або падає з описом помилки. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

/** Код помилки невдалого результату. */
export function errorCode(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}
