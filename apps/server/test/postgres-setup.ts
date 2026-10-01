// Глобальне налаштування тестів: справжній Postgres. Якщо задано TEST_DATABASE_URL
// (напр. service container у CI) — беремо його; інакше піднімаємо тимчасовий кластер.
import type { TestProject } from 'vitest/node';
import { startTempPostgres } from './postgres-cluster.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Адреса Postgres із правами створювати бази. */
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => void> {
  const external = process.env.TEST_DATABASE_URL;
  if (external !== undefined && external !== '') {
    project.provide('databaseUrl', external);
    return () => undefined;
  }
  const postgres = await startTempPostgres();
  if (postgres === null) {
    throw new Error(
      'Для тестів сервера потрібен Postgres: задайте TEST_DATABASE_URL або встановіть PostgreSQL (initdb).',
    );
  }
  project.provide('databaseUrl', postgres.url);
  return () => postgres.stop();
}
