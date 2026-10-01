import type { GameLog } from '@poker/engine';
import type { RoomStatus } from '@poker/protocol';

/** Версія формату знімка кімнати; збільшується при несумісних змінах. */
export const ROOM_SNAPSHOT_VERSION = 1;

/** Скільки зберігаються завершені ігри, мс. */
export const FINISHED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Скільки зберігаються кімнати в лобі (гру так і не почали), мс. */
export const LOBBY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Гра без змін довше за цей час вважається покинутою: відкладені звіти про баги з неї
 * публікуються, бо seed уже нікому не розкриє чужих карт у грі, що йде.
 */
export const ABANDONED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Звіт про баг з гри, що ще йде (T52): чекає публікації до кінця гри чи до її покидання.
 * Стан гри на момент звіту — перші `actions` дій логу.
 */
export interface PendingBugReport {
  readonly id: string;
  readonly seat: number;
  readonly kinds: readonly ('human' | 'bot')[];
  readonly actions: number;
  readonly description: string;
}

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
  readonly seats: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: 'human' | 'bot';
    readonly token: string | null;
  }[];
  readonly game: { readonly seed: number; readonly log: GameLog } | null;
  /** Ще не опубліковані звіти про баги (у старих знімках поля немає). */
  readonly bugReports?: readonly PendingBugReport[];
  /** Скільки звітів надіслав кожен гравець: ідентифікатор → кількість. */
  readonly bugReportsSent?: Readonly<Record<string, number>>;
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
  /**
   * Коди кімнат із неопублікованими звітами про баги, які вже можна публікувати:
   * гра завершена або покинута (без змін довше `ABANDONED_TTL_MS`).
   */
  unpublishedBugReports(): Promise<string[]>;
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

/** Чи можна публікувати відкладені звіти кімнати (див. `RoomStore.unpublishedBugReports`). */
export function hasPublishableBugReports(
  snapshot: RoomSnapshot,
  updatedAt: number,
  now: number,
): boolean {
  if ((snapshot.bugReports ?? []).length === 0) return false;
  return (
    snapshot.status === 'finished' ||
    (snapshot.status === 'playing' && now - updatedAt > ABANDONED_TTL_MS)
  );
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

  unpublishedBugReports(): Promise<string[]> {
    const now = this.now();
    const codes = [...this.snapshots]
      .filter(([, { json, updatedAt }]) =>
        hasPublishableBugReports(JSON.parse(json) as RoomSnapshot, updatedAt, now),
      )
      .map(([code]) => code);
    return Promise.resolve(codes);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
