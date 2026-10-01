import pg from 'pg';
import { type RetryOptions, withRetry } from './retry.js';
import {
  FINISHED_TTL_MS,
  LOBBY_TTL_MS,
  type RoomSnapshot,
  type RoomStore,
  isSnapshot,
} from './store.js';

/**
 * Міграції схеми по порядку: індекс + 1 — версія схеми. Уже застосовані не змінюються,
 * нові лише додаються в кінець.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE rooms (
     code text PRIMARY KEY,
     status text NOT NULL,
     snapshot jsonb NOT NULL,
     updated_at timestamptz NOT NULL
   );
   CREATE INDEX rooms_status_updated_at ON rooms (status, updated_at);`,
];

/** Ключ advisory-блокування міграцій: два процеси (передеплой) не мігрують одночасно. */
const MIGRATION_LOCK = 7_540_054;

export interface PostgresRoomStoreOptions {
  connectionString: string;
  /** Годинник для `updated_at` і очищення (у тестах — керований). */
  now?: () => number;
  /** Повторні спроби при тимчасових збоях (холодний старт Neon). */
  retry?: RetryOptions;
  /** Помилки простою зʼєднань пулу (Neon закриває неактивні зʼєднання). */
  onError?: (error: Error) => void;
}

/** Сховище кімнат у Postgres: рядок на кімнату, знімок у `jsonb`. */
export class PostgresRoomStore implements RoomStore {
  private readonly pool: pg.Pool;
  private readonly now: () => number;
  private readonly retry: RetryOptions;

  constructor(options: PostgresRoomStoreOptions) {
    this.pool = new pg.Pool({
      connectionString: options.connectionString,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    // Без обробника обрив простою зʼєднання валить процес.
    this.pool.on('error', (error) => options.onError?.(error));
    this.now = options.now ?? (() => Date.now());
    this.retry = options.retry ?? {};
  }

  private query<R extends pg.QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    return withRetry(() => this.pool.query<R>(text, values), this.retry);
  }

  async init(): Promise<void> {
    await withRetry(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
        await client.query('CREATE TABLE IF NOT EXISTS schema_version (version integer NOT NULL)');
        const current = await client.query<{ version: number }>(
          'SELECT version FROM schema_version',
        );
        const version = current.rows[0]?.version ?? 0;
        for (let i = version; i < MIGRATIONS.length; i++) {
          await client.query(MIGRATIONS[i] as string);
        }
        if (current.rows.length === 0) {
          await client.query('INSERT INTO schema_version (version) VALUES ($1)', [
            MIGRATIONS.length,
          ]);
        } else if (version < MIGRATIONS.length) {
          await client.query('UPDATE schema_version SET version = $1', [MIGRATIONS.length]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }, this.retry);
  }

  async load(code: string): Promise<RoomSnapshot | null> {
    const result = await this.query<{ snapshot: unknown }>(
      'SELECT snapshot FROM rooms WHERE code = $1',
      [code],
    );
    const value = result.rows[0]?.snapshot;
    return isSnapshot(value) ? value : null;
  }

  async has(code: string): Promise<boolean> {
    const result = await this.query('SELECT 1 FROM rooms WHERE code = $1', [code]);
    return result.rows.length > 0;
  }

  async save(snapshot: RoomSnapshot): Promise<void> {
    await this.query(
      `INSERT INTO rooms (code, status, snapshot, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
       SET status = EXCLUDED.status, snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`,
      [snapshot.code, snapshot.status, JSON.stringify(snapshot), new Date(this.now())],
    );
  }

  async cleanup(): Promise<number> {
    const now = this.now();
    const result = await this.query(
      `DELETE FROM rooms
       WHERE (status = 'finished' AND updated_at < $1) OR (status = 'lobby' AND updated_at < $2)`,
      [new Date(now - FINISHED_TTL_MS), new Date(now - LOBBY_TTL_MS)],
    );
    return result.rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
