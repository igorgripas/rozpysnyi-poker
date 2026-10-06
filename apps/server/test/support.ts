import { createRng } from '@poker/engine';
import type { Result } from '@poker/protocol';
import type { RandomSource } from '../src/random.js';
import { MemoryRoomStore, type RoomSnapshot } from '../src/store.js';

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

/** Сховище, де кожен запис чекає дозволу тесту (`release`) і памʼятає порядок записів. */
export class GatedStore extends MemoryRoomStore {
  readonly started: string[] = [];
  readonly finished: string[] = [];
  private readonly gates: (() => void)[] = [];
  fail = false;
  /** `false` — записи проходять одразу, без дозволу. */
  gated = true;

  override async save(snapshot: RoomSnapshot): Promise<void> {
    const label = `${snapshot.code}:${snapshot.seats.length}`;
    this.started.push(label);
    if (this.gated) await new Promise<void>((resolve) => this.gates.push(resolve));
    if (this.fail) throw new Error('база недоступна');
    await super.save(snapshot);
    this.finished.push(label);
  }

  /** Пропускає один очікуваний запис. */
  release(): void {
    this.gates.shift()?.();
  }

  /** Знімає шлагбаум: очікувані й наступні записи проходять одразу. */
  open(): void {
    this.gated = false;
    for (const gate of this.gates.splice(0)) gate();
  }

  get waiting(): number {
    return this.gates.length;
  }
}

/** Дає відпрацювати всім готовим промісам і колбекам вводу-виводу. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Без ліміту запитів зʼєднання: тести дограють гру з ботами без затримок,
 * швидше, ніж це може зробити людина.
 */
export const FAST_PLAY = { connectionLimits: { requests: Number.POSITIVE_INFINITY } } as const;
