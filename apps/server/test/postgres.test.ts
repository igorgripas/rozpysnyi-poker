// Сховище кімнат на справжньому Postgres (T54).
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PostgresRoomStore } from '../src/postgres.js';
import { ROOM_SNAPSHOT_VERSION, type RoomSnapshot } from '../src/store.js';
import { freshDatabase } from './db.js';

const DAY = 24 * 60 * 60 * 1000;

function snapshot(code: string, status: RoomSnapshot['status'] = 'lobby'): RoomSnapshot {
  return {
    version: ROOM_SNAPSHOT_VERSION,
    code,
    hostId: 'h1',
    status,
    turnTimerSec: null,
    seats: [{ id: 'h1', name: 'Оля', kind: 'human', token: 'token-h1' }],
    game: null,
  };
}

let url: string;
let now: number;
const stores: PostgresRoomStore[] = [];

function store(): PostgresRoomStore {
  const created = new PostgresRoomStore({ connectionString: url, now: () => now });
  stores.push(created);
  return created;
}

beforeEach(async () => {
  url = await freshDatabase();
  now = Date.UTC(2026, 0, 1);
});

afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});

describe('PostgresRoomStore', () => {
  it('створює схему під час старту; повторний і паралельний init нічого не ламає', async () => {
    await Promise.all([store().init(), store().init()]);
    const again = store();
    await again.init();
    expect(await again.load('ABCDE')).toBeNull();
  });

  it('зберігає знімок і читає його іншим екземпляром за кодом (разом із токенами)', async () => {
    const first = store();
    await first.init();
    await first.save(snapshot('ABCDE'));
    await first.save({ ...snapshot('ABCDE', 'playing'), turnTimerSec: 30 });
    await first.save(snapshot('FGHJK'));

    const second = store();
    await second.init();
    expect(await second.load('ABCDE')).toEqual({
      ...snapshot('ABCDE', 'playing'),
      turnTimerSec: 30,
    });
    expect(await second.has('FGHJK')).toBe(true);
    expect(await second.has('ZZZZZ')).toBe(false);
    expect(await second.load('ZZZZZ')).toBeNull();
  });

  it('пошкоджений або несумісний знімок читається як відсутній', async () => {
    const s = store();
    await s.init();
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query(
      `INSERT INTO rooms (code, status, snapshot, updated_at) VALUES ('WRONG', 'lobby', '{"version": 999}', now())`,
    );
    await client.end();
    expect(await s.load('WRONG')).toBeNull();
  });

  it('очищення: завершені ігри старші 30 днів і лобі старші 7 днів', async () => {
    const s = store();
    await s.init();
    await s.save(snapshot('LOBBY', 'lobby'));
    await s.save(snapshot('ENDED', 'finished'));
    await s.save(snapshot('GAMES', 'playing'));
    now += 7 * DAY - 1;
    await s.save(snapshot('FRESH', 'lobby'));
    expect(await s.cleanup()).toBe(0);
    now += 2;
    expect(await s.cleanup()).toBe(1);
    expect(await s.has('LOBBY')).toBe(false);
    expect(await s.has('FRESH')).toBe(true);
    now += 30 * DAY;
    expect(await s.cleanup()).toBe(2);
    expect(await s.has('ENDED')).toBe(false);
    expect(await s.has('FRESH')).toBe(false);
    // Незавершену гру не видаляємо: гравці можуть повернутися.
    expect(await s.has('GAMES')).toBe(true);
  });

  it('недоступна база: init повторює спроби й зрештою кидає помилку', async () => {
    const dead = new PostgresRoomStore({
      connectionString: 'postgres://postgres@127.0.0.1:1/postgres',
      retry: { attempts: 3, delayMs: 1 },
    });
    stores.push(dead);
    await expect(dead.init()).rejects.toThrow();
  });
});
