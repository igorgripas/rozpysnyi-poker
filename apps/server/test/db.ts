import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

/** Створює порожню базу для тесту й повертає її адресу. */
export async function freshDatabase(): Promise<string> {
  const admin = inject('databaseUrl');
  const name = `poker_test_${randomBytes(6).toString('hex')}`;
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return url.toString();
}
