import { type Page, expect, test } from '@playwright/test';
import { playUntil, takeTurn } from './support/player';
import { type SeededServer, startSeededServer } from './support/server';

// Сам хелпер гри (support/player.ts): він має або зробити хід, або швидко впасти з
// причиною, а не висіти до таймауту іншого гравця (#138).

const SEED = 7;
let server: SeededServer | undefined;

test.afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function startGame(page: Page, bots: number): Promise<void> {
  await page.goto(`/?server=${encodeURIComponent(server?.url ?? '')}&trickPause=0`);
  await expect(page.getByRole('img', { name: 'Звʼязок є' })).toBeVisible();
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < bots; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(
    bots + 1,
  );
  await page.getByRole('button', { name: 'Почати гру' }).click();
}

test('хелпер: відмова сервера на хід — одразу помилка з її текстом, а не таймаут', async ({
  page,
  baseURL,
}) => {
  // Ліміт запитів вичерпується посеред першої ж роздачі.
  server = await startSeededServer(SEED, baseURL ?? '', {
    connectionLimits: { requests: 12, windowMs: 60_000 },
  });
  await startGame(page, 3);
  const started = Date.now();
  await expect(playUntil(page)).rejects.toThrow(/Забагато запитів/);
  expect(Date.now() - started).toBeLessThan(30_000);
});

test.describe('рука на 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('хелпер: грає карту, центр якої перекриває сусідня (12 карт)', async ({ page, baseURL }) => {
    test.setTimeout(2 * 60_000);
    server = await startSeededServer(SEED, baseURL ?? '');
    await startGame(page, 2);
    // Ваш хід із 12 карт, і перша легальна карта — не крайня справа: її центр під сусідньою.
    const coveredFirst = () =>
      page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>('.hand__card')];
        const first = document.querySelector<HTMLElement>('.hand__card:not(:disabled)');
        if (cards.length !== 12 || first === null) return false;
        const box = first.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit !== null && !first.contains(hit);
      });
    await playUntil(page, coveredFirst);
    expect(await coveredFirst()).toBe(true);

    expect(await takeTurn(page, 10_000)).toBe(true);
    await expect(page.locator('.hand__card')).toHaveCount(11);
  });
});
