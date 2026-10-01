// Безперервність гри (T55): сервер зупиняється посеред взятки (SIGTERM, як при передеплої
// чи засинанні), через хвилину стартує новий процес — гра продовжується з того самого стану.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { type TempPostgres, freePort, startTempPostgres } from '../../server/test/postgres-cluster';
import { takeTurn } from './support/player';

const SERVER_DIR = fileURLToPath(new URL('../../server', import.meta.url));
/** Скільки сервер «лежить» між зупинкою й новим процесом, мс. */
const DOWNTIME_MS = 60_000;

let postgres: TempPostgres | null = null;

test.beforeAll(async () => {
  postgres = await startTempPostgres();
});

test.afterAll(() => {
  postgres?.stop();
});

/** Окремий процес сервера (як на хостингу) з базою Postgres. */
async function startServer(port: number, databaseUrl: string): Promise<ChildProcess> {
  const server = spawn('node', ['--import', 'tsx', '--conditions=source', 'src/main.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: databaseUrl },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return server;
    } catch {
      // Ще стартує.
    }
    if (Date.now() > deadline) throw new Error('Сервер не стартував');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Грає за людину, доки не настане її хід посеред взятки (на столі вже є карти). */
async function playUntilMidTrick(page: Page): Promise<void> {
  for (let step = 0; step < 200; step++) {
    const handle = await page.waitForFunction(
      () => {
        const play = document.querySelector('.hand__card:not(:disabled)') !== null;
        const other =
          document.querySelector('.bidding__options button:not(:disabled)') !== null ||
          document.querySelector('.joker-dialog') !== null;
        if (!play && !other) return false;
        const trick = document.querySelector('.felt__trick');
        const mid =
          play &&
          trick !== null &&
          !trick.matches('.felt__trick--last, .felt__trick--taken') &&
          trick.querySelectorAll('.felt__card').length > 0;
        return mid ? 'mid' : 'move';
      },
      null,
      { polling: 50, timeout: 60_000 },
    );
    if ((await handle.jsonValue()) === 'mid') return;
    await takeTurn(page);
  }
  throw new Error('Не дочекалися ходу посеред взятки');
}

/** Що бачить гравець: рука, карти на столі, факти роздачі й чий хід. */
function tableState(page: Page) {
  return page.evaluate(() => ({
    hand: [...document.querySelectorAll('.hand__card')].map((card) =>
      card.getAttribute('data-card'),
    ),
    trick: [...document.querySelectorAll('.felt__trick .felt__card')].map(
      (card) => card.textContent,
    ),
    facts: document.querySelector('.game__facts')?.textContent ?? '',
    turn: document.querySelector('.game__turn')?.textContent ?? '',
  }));
}

test('SIGTERM посеред взятки → новий процес через 60 с → гра продовжується з того самого стану', async ({
  page,
}) => {
  test.setTimeout(4 * 60_000);
  if (postgres === null) throw new Error('Для цього e2e потрібен PostgreSQL (initdb)');
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let server = await startServer(port, postgres.url);
  try {
    await page.goto(`/?server=${encodeURIComponent(url)}`);
    await page.getByLabel('Ваше імʼя').fill('Оля');
    await page.getByRole('button', { name: 'Створити кімнату' }).click();
    await page.getByRole('button', { name: 'Додати бота' }).click();
    await page.getByRole('button', { name: 'Додати бота' }).click();
    await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(3);
    await page.getByRole('button', { name: 'Почати гру' }).click();

    await playUntilMidTrick(page);
    const before = await tableState(page);
    expect(before.trick.length).toBeGreaterThan(0);

    // Передеплой: сервер дописує все в базу, попереджає клієнта й виходить.
    server.kill('SIGTERM');
    const [code] = (await once(server, 'exit')) as [number | null];
    expect(code).toBe(0);
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('Сервер прокидається, зачекайте до хвилини…');
    await page.waitForTimeout(DOWNTIME_MS);
    await expect(alert).toHaveText('Сервер прокидається, зачекайте до хвилини…');

    // Новий процес на тій самій адресі: клієнт сам перепідключається й повертається в кімнату.
    server = await startServer(port, postgres.url);
    await expect(alert).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => tableState(page), { timeout: 15_000 }).toEqual(before);

    // Гра йде далі: хід приймається.
    expect(await takeTurn(page)).toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    server.kill('SIGTERM');
  }
});
