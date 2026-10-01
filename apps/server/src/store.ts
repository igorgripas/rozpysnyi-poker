import type { GameLog, GameOptions } from '@poker/engine';
import type { RoomStatus } from '@poker/protocol';

/** Версія формату знімка кімнати; збільшується при несумісних змінах. */
export const ROOM_SNAPSHOT_VERSION = 1;

/** Скільки зберігаються завершені ігри, мс. */
export const FINISHED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Скільки зберігаються кімнати в лобі (гру так і не почали), мс. */
export const LOBBY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Знімок кімнати для відновлення після рестарту. Гра зберігається як seed + лог дій
 * і відновлюється через `replay`; стан підключень не зберігається.
 */
export interface RoomSnapshot {
  readonly version: typeof ROOM_SNAPSHOT_VERSION;
  readonly code: string;
  readonly hostId: string;
  readonly status: RoomStatus;
  readonly turnTimerSec: number | null;
  /** Опції кімнати (§10); у знімках, збережених до них, поля немає — опції вимкнені. */
  readonly options?: GameOptions;
  readonly seats: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: 'human' | 'bot';
    readonly token: string | null;
  }[];
  readonly game: { readonly seed: number; readonly log: GameLog } | null;
}

/**
 * Сховище кімнат. Сервер зберігає знімок після кожної зміни й підвантажує кімнату
 * за кодом, коли гравець входить або повертається в неї.
 */
export interface RoomStore {
  /** Готує сховище під час старту: створює або мігрує схему. */
  init(): Promise<void>;
  /** Знімок кімнати або `null`, якщо її немає (чи знімок нечитабельний). */
  load(code: string): Promise<RoomSnapshot | null>;
  /** Чи зайнятий код збереженою кімнатою. */
  has(code: string): Promise<boolean>;
  save(snapshot: RoomSnapshot): Promise<void>;
  /** Видаляє завершені ігри старші 30 днів і лобі старші 7 днів; повертає кількість. */
  cleanup(): Promise<number>;
  close(): Promise<void>;
}

export function isSnapshot(value: unknown): value is RoomSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === ROOM_SNAPSHOT_VERSION
  );
}

/** Чи прострочений знімок зі статусом `status`, востаннє змінений у `updatedAt`. */
export function isExpired(status: RoomStatus, updatedAt: number, now: number): boolean {
  if (status === 'finished') return now - updatedAt > FINISHED_TTL_MS;
  if (status === 'lobby') return now - updatedAt > LOBBY_TTL_MS;
  return false;
}

/** Сховище в памʼяті: для unit-тестів і запуску без бази (рестарт у межах процесу). */
export class MemoryRoomStore implements RoomStore {
  private readonly snapshots = new Map<string, { json: string; updatedAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  init(): Promise<void> {
    return Promise.resolve();
  }

  load(code: string): Promise<RoomSnapshot | null> {
    const entry = this.snapshots.get(code);
    const value: unknown = entry === undefined ? null : JSON.parse(entry.json);
    return Promise.resolve(isSnapshot(value) ? value : null);
  }

  has(code: string): Promise<boolean> {
    return Promise.resolve(this.snapshots.has(code));
  }

  save(snapshot: RoomSnapshot): Promise<void> {
    // Копія через JSON: знімок не ділить обʼєкти з живою кімнатою, як і в базі.
    this.snapshots.set(snapshot.code, { json: JSON.stringify(snapshot), updatedAt: this.now() });
    return Promise.resolve();
  }

  cleanup(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [code, { json, updatedAt }] of this.snapshots) {
      const { status } = JSON.parse(json) as RoomSnapshot;
      if (isExpired(status, updatedAt, now)) {
        this.snapshots.delete(code);
        removed++;
      }
    }
    return Promise.resolve(removed);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
