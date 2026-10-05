import { type Page, expect, test } from '@playwright/test';
import { playUntil, takeTurn } from './support/player';
import { type SeededServer, startSeededServer } from './support/server';

// Вихід із гри й кімнати (T180): після завершення — «Нова гра», посеред гри — бот і повернення.

// Seed як у visual.spec: та сама кімната (хост і 3 боти) щоразу доходить до кінця гри.
const SEED = 7;
let server: SeededServer;

test.beforeEach(async ({ baseURL }) => {
  server = await startSeededServer(SEED, baseURL ?? '');
});

test.afterEach(async () => {
  await server.close();
});

async function open(page: Page): Promise<void> {
  await page.goto(`/?server=${encodeURIComponent(server.url)}&trickPause=0`);
  await expect(page.getByRole('img', { name: 'Звʼязок є' })).toBeVisible();
}

async function createRoom(page: Page, name: string): Promise<string> {
  await open(page);
  await page.getByLabel('Ваше імʼя').fill(name);
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  const heading = page.getByRole('heading', { name: /^Кімната [A-Z0-9]{5}$/ });
  await expect(heading).toBeVisible();
  return ((await heading.textContent()) ?? '').replace('Кімната ', '');
}

function seat(page: Page, name: string) {
  return page
    .getByRole('list', { name: 'Гравці за столом' })
    .getByRole('listitem')
    .filter({ hasText: name });
}

test('завершена гра → «Нова гра» → після перезавантаження головна, а не старі результати', async ({
  page,
}) => {
  test.setTimeout(5 * 60_000);
  await createRoom(page, 'Оля');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(4);
  await page.getByRole('button', { name: 'Почати гру' }).click();
  await playUntil(page);
  await expect(page.getByRole('region', { name: 'Результати' })).toBeVisible();

  await page.getByRole('button', { name: 'Нова гра' }).click();
  await expect(page.getByRole('button', { name: 'Створити кімнату' })).toBeVisible();
  await expect(page).toHaveURL(/\/\?|\/$/);

  // Знову відкриваємо застосунок (адреса без `?server=` вела б на інший сервер).
  await open(page);
  await expect(page.getByRole('button', { name: 'Створити кімнату' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Результати' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Незавершені ігри' })).toHaveCount(0);
});

test('вихід посеред гри: інші бачать «(бот)», гра йде; «Повернутися в гру» — на своє місце', async ({
  page,
  browser,
}) => {
  test.setTimeout(2 * 60_000);
  const code = await createRoom(page, 'Оля');
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await open(guest);
  await guest.getByLabel('Ваше імʼя').fill('Петро');
  await guest.getByLabel('Код кімнати').fill(code);
  await guest.getByRole('button', { name: 'Увійти', exact: true }).click();
  await expect(guest.getByText('Чекаємо, поки хост почне гру')).toBeVisible();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Почати гру' }).click();

  // Хост ходить, доки не настане хід гостя.
  const guestTurn = guest.getByRole('status').filter({ hasText: /^Ваш хід/ });
  while (!(await guestTurn.isVisible())) await takeTurn(page);

  await guest.getByRole('button', { name: 'Вийти з гри' }).click();
  const dialog = guest.getByRole('dialog', { name: 'Вийти з гри?' });
  await expect(dialog).toContainText('Поки вас немає, за вас ходитиме бот.');
  await dialog.getByRole('button', { name: 'Вийти' }).click();
  await expect(guest.getByRole('button', { name: 'Створити кімнату' })).toBeVisible();

  // Хост бачить позначку, а бот зробив хід за гостя: черга дійшла до хоста.
  await expect(seat(page, 'Петро')).toContainText('Петро (бот)');
  await expect(page.getByRole('status').filter({ hasText: /^Ваш хід/ })).toBeVisible();

  // Повторне відкриття не повертає в гру саме; повернутися можна з головної.
  await open(guest);
  const unfinished = guest.getByRole('region', { name: 'Незавершені ігри' });
  await expect(unfinished).toContainText(`Гра ${code}`);
  await expect(unfinished).toContainText('Оля, Петро, Бот 1');
  await unfinished.getByRole('button', { name: 'Повернутися в гру' }).click();

  await expect(seat(guest, 'Петро')).toContainText('ви');
  await expect(seat(page, 'Петро')).not.toContainText('(бот)');
  // Ті самі карти, що бачить хост у картці гостя, і та сама роздача.
  const cards = await guest.getByRole('list', { name: 'Ваші карти' }).locator('.card').count();
  await expect(seat(page, 'Петро')).toContainText(`Карт: ${cards}`);
  await expect(guest.locator('.game__facts')).toHaveText(
    (await page.locator('.game__facts').textContent()) ?? '',
  );
  await expect(guest.getByRole('region', { name: 'Незавершені ігри' })).toHaveCount(0);
  await guestContext.close();
});
