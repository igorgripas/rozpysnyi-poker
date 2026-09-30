import { type Locator, type Page, expect, test } from '@playwright/test';
import { expectAccessible, playUntil } from './support/player';
import { type SeededServer, startSeededServer } from './support/server';

// Ключові екрани: знімки порівнюються з еталонними (visual.spec.ts-snapshots), кожен
// екран перевіряється axe. Сервер детермінований, тож роздачі щоразу ті самі.
// Оновити еталони: pnpm --filter @poker/web e2e --update-snapshots

const SEED = 7;
let server: SeededServer;

test.beforeEach(async ({ page }, testInfo) => {
  server = await startSeededServer(SEED, testInfo.project.use.baseURL ?? '');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
});

test.afterEach(async () => {
  await server.close();
});

async function open(page: Page): Promise<void> {
  // Пауза взятки вимкнена: інакше повна гра не вкладеться в таймаут.
  await page.goto(`/?server=${encodeURIComponent(server.url)}&trickPause=0`);
  await expect(page.getByRole('img', { name: 'Звʼязок є' })).toBeVisible();
}

async function roomWithBots(page: Page, bots: number): Promise<void> {
  await open(page);
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < bots; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(
    bots + 1,
  );
}

/** Знімок екрана (або лише діалогу) й перевірка доступності. */
async function checkScreen(page: Page, name: string, dialog?: Locator): Promise<void> {
  // Діалоги закріплені у вікні: знімок усієї сторінки залежав би від прокрутки.
  if (dialog === undefined) await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  else await expect(dialog).toHaveScreenshot(`${name}.png`);
  await expectAccessible(page);
}

test('головний екран і лобі', async ({ page }) => {
  await open(page);
  await expect(page.getByLabel('Ваше імʼя')).toBeVisible();
  await checkScreen(page, 'home');
});

test('кімната очікування', async ({ page }) => {
  await roomWithBots(page, 3);
  await checkScreen(page, 'waiting-room');
});

test('гра: замовлення, стіл, джокер, таблиця й результати', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await roomWithBots(page, 3);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  const bidding = page.getByRole('group', { name: 'Ваше замовлення' });
  await expect(bidding).toBeVisible();
  await checkScreen(page, 'bidding');

  // Стіл посеред роздачі: ваш хід, на столі вже є карти суперників.
  await playUntil(page, async () => {
    const onTable = await page
      .locator('.felt__trick:not(.felt__trick--last, .felt__trick--taken) .felt__card')
      .count();
    const cards = await page.locator('.hand__card').count();
    return onTable >= 2 && cards >= 4 && (await page.locator('.hand__card:enabled').count()) > 0;
  });
  await checkScreen(page, 'table');

  const sheetButton = page.getByRole('button', { name: 'Таблиця' });
  await sheetButton.click();
  const sheet = page.getByRole('dialog', { name: 'Таблиця гри' });
  await expect(sheet).toBeVisible();
  await checkScreen(page, 'sheet', sheet);
  await sheet.getByRole('button', { name: 'Закрити' }).click();

  // Діалог оголошення джокера.
  await playUntil(page, () => page.locator('.joker-dialog').isVisible());
  const joker = page.getByRole('dialog', { name: 'Оголошення джокера' });
  await expect(joker).toBeVisible();
  await checkScreen(page, 'joker', joker);

  await playUntil(page);
  await expect(page.getByRole('region', { name: 'Результати' })).toBeVisible();
  await checkScreen(page, 'results');
});

test('темна тема за столом', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await roomWithBots(page, 2);
  await page.getByRole('button', { name: 'Почати гру' }).click();
  await expect(page.getByRole('list', { name: 'Ваші карти' })).toBeVisible();
  await playUntil(page, () => page.locator('.hand__card:enabled').first().isVisible());
  await checkScreen(page, 'table-dark');
});
