import { GitHubBugReporter } from './bugReport.js';
import { PostgresRoomStore } from './postgres.js';
import { createPokerServer } from './server.js';

// Точка входу: PORT, HOST і PUBLIC_URL (адреса веб-клієнта для посилань) — зі змінних оточення.
// DATABASE_URL — Postgres для кімнат: з ним ігри переживають рестарт сервера.
const databaseUrl = process.env.DATABASE_URL;
const store =
  databaseUrl !== undefined && databaseUrl !== ''
    ? new PostgresRoomStore({
        connectionString: databaseUrl,
        onError: (error) => console.error('Postgres: обрив зʼєднання', error),
      })
    : undefined;
// BUG_REPORT_TOKEN — токен GitHub лише на запис issues: з ним працює кнопка «Повідомити про баг».
const bugReportToken = process.env.BUG_REPORT_TOKEN;
const bugReporter =
  bugReportToken !== undefined && bugReportToken !== ''
    ? new GitHubBugReporter({
        token: bugReportToken,
        repo: process.env.BUG_REPORT_REPO ?? 'igorgripas/rozpysnyi-poker',
      })
    : undefined;
const server = createPokerServer({
  publicUrl: process.env.PUBLIC_URL ?? '',
  logger: true,
  ...(store !== undefined && { store }),
  ...(bugReporter !== undefined && { bugReporter }),
});
await server.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
});

/** Скільки чекати плавної зупинки, мс: хостинг дає ~30 с між SIGTERM і SIGKILL. */
const SHUTDOWN_TIMEOUT_MS = 25_000;

// Передеплой або засинання: перестаємо приймати дії, дописуємо все в базу,
// попереджаємо клієнтів (`server:restarting`) і виходимо.
let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.app.log.info(`${signal}: зупиняємо сервер`);
  setTimeout(() => {
    server.app.log.error('Плавна зупинка не встигла, виходимо');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  try {
    await server.close();
    await store?.close();
    process.exit(0);
  } catch (error) {
    server.app.log.error({ err: error }, 'Помилка під час зупинки');
    process.exit(1);
  }
}
process.on('SIGTERM', (signal) => void stop(signal));
process.on('SIGINT', (signal) => void stop(signal));
