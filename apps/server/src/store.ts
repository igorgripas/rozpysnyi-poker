import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameLog } from '@poker/engine';
import type { RoomStatus } from '@poker/protocol';

/** Версія формату знімка кімнати; збільшується при несумісних змінах. */
export const ROOM_SNAPSHOT_VERSION = 1;

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
}

/** Сховище кімнат: сервер зберігає знімок після кожної зміни й читає всі під час старту. */
export interface RoomStore {
  load(): RoomSnapshot[];
  save(snapshot: RoomSnapshot): void;
}

function isSnapshot(value: unknown): value is RoomSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === ROOM_SNAPSHOT_VERSION
  );
}

/** Сховище в памʼяті: для тестів і запуску без диска (рестарт у межах процесу). */
export class MemoryRoomStore implements RoomStore {
  private readonly snapshots = new Map<string, string>();

  load(): RoomSnapshot[] {
    return [...this.snapshots.values()].map((json) => JSON.parse(json) as RoomSnapshot);
  }

  save(snapshot: RoomSnapshot): void {
    // Копія через JSON: знімок не ділить обʼєкти з живою кімнатою, як і на диску.
    this.snapshots.set(snapshot.code, JSON.stringify(snapshot));
  }
}

/** Сховище на диску: файл `<код>.json` на кімнату, запис атомарний (тимчасовий файл + rename). */
export class FileRoomStore implements RoomStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  load(): RoomSnapshot[] {
    const snapshots: RoomSnapshot[] = [];
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const value: unknown = JSON.parse(readFileSync(join(this.dir, file), 'utf8'));
        if (isSnapshot(value)) snapshots.push(value);
      } catch {
        // Пошкоджений файл не має заважати відновленню інших кімнат.
      }
    }
    return snapshots;
  }

  save(snapshot: RoomSnapshot): void {
    const path = join(this.dir, `${snapshot.code}.json`);
    const temp = `${path}.tmp`;
    writeFileSync(temp, JSON.stringify(snapshot));
    renameSync(temp, path);
  }
}
