// Глобальне налаштування тестів: справжній Postgres. Якщо задано TEST_DATABASE_URL
// (напр. service container у CI) — беремо його; інакше піднімаємо тимчасовий кластер
// з локально встановлених бінарників Postgres (на ubuntu-раннерах GitHub вони є).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Адреса Postgres із правами створювати бази. */
    databaseUrl: string;
  }
}

/** Каталог із `initdb`/`postgres`: з `pg_config` або найновіша версія в /usr/lib/postgresql. */
function findBinDir(): string | null {
  try {
    const dir = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    if (existsSync(join(dir, 'initdb'))) return dir;
  } catch {
    // pg_config немає в PATH — шукаємо далі.
  }
  const root = '/usr/lib/postgresql';
  if (!existsSync(root)) return null;
  const versions = readdirSync(root)
    .filter((v) => existsSync(join(root, v, 'bin', 'initdb')))
    .sort((a, b) => Number(b) - Number(a));
  return versions[0] === undefined ? null : join(root, versions[0], 'bin');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

export default async function setup(project: TestProject): Promise<() => void> {
  const external = process.env.TEST_DATABASE_URL;
  if (external !== undefined && external !== '') {
    project.provide('databaseUrl', external);
    return () => undefined;
  }
  const bin = findBinDir();
  if (bin === null) {
    throw new Error(
      'Для тестів сервера потрібен Postgres: задайте TEST_DATABASE_URL або встановіть PostgreSQL (initdb).',
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'poker-pg-'));
  const data = join(dir, 'data');
  execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8'], {
    stdio: 'ignore',
  });
  const port = await freePort();
  const postgres = spawn(
    join(bin, 'postgres'),
    [
      '-D',
      data,
      '-p',
      String(port),
      '-k',
      dir,
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      'fsync=off',
    ],
    { stdio: 'ignore' },
  );
  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      execFileSync(join(bin, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(port)], {
        stdio: 'ignore',
      });
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('Тимчасовий Postgres не запустився');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  project.provide('databaseUrl', url);
  return () => {
    postgres.kill('SIGINT');
    rmSync(dir, { recursive: true, force: true });
  };
}
