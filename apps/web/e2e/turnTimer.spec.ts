import { type Page, expect, test } from '@playwright/test';
import { takeTurn } from './support/player';
import { type SeededServer, startSeededServer } from './support/server';

// Таймер ходу й «Віддати боту» (R-9.3) у браузері: хост вмикає таймер у кімнаті очікування
// й бачить відлік у грі; гість закриває вкладку, хост віддає його місце боту, а гість
// повертається за посиланням і грає далі зі своїми картами.

const SEED = 7;
let server: SeededServer;

test.beforeEach(async ({ baseURL }) => {
  server = await startSeededServer(SEED, baseURL ?? '');
});

test.afterEach(async () => {
  await server.close();
});

function query(): string {
  return `?server=${encodeURIComponent(server.url)}&trickPause=0`;
}

function seat(page: Page, name: string) {
  return page
    .getByRole('list', { name: 'Гравці за столом' })
    .getByRole('listitem')
    .filter({ hasText: name });
}

/** Карти в руці гравця (ідентифікатори `data-card`). */
function handOf(page: Page): Promise<string[]> {
  return page
    .locator('.hand__card')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card') ?? ''));
}

/** Секунди, що лишилися на хід, з відліку на сторінці. */
async function secondsLeft(page: Page): Promise<number> {
  const text = (await page.getByRole('timer', { name: 'Час на хід' }).textContent()) ?? '';
  const match = /^(\d+) с$/.exec(text);
  if (match === null) throw new Error(`Неочікуваний відлік: «${text}»`);
  return Number(match[1]);
}

test('R-9.3: таймер ходу з кімнати очікування видно в грі; місце гостя — боту, гість повертається зі своїми картами', async ({
  page,
  browser,
}) => {
  test.setTimeout(2 * 60_000);
  await page.goto(`/${query()}`);
  await expect(page.getByRole('img', { name: 'Звʼязок є' })).toBeVisible();
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  const heading = page.getByRole('heading', { name: /^Кімната [A-Z0-9]{5}$/ });
  await expect(heading).toBeVisible();
  const code = ((await heading.textContent()) ?? '').replace('Кімната ', '');

  const guestContext = await browser.newContext();
  let guest = await guestContext.newPage();
  await guest.goto(`/r/${code}${query()}`);
  await guest.getByLabel('Ваше імʼя').fill('Петро');
  await guest.getByRole('button', { name: 'Увійти в кімнату' }).click();
  await expect(guest.getByText('Чекаємо, поки хост почне гру')).toBeVisible();

  // Хост вмикає таймер у кімнаті очікування; гість бачить той самий вибір, але не змінює.
  await page.getByLabel('Таймер ходу').selectOption('60');
  await expect(guest.getByLabel('Таймер ходу')).toHaveValue('60');
  await expect(guest.getByLabel('Таймер ходу')).toBeDisabled();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Почати гру' }).click();

  // У грі на ходу людини йде відлік, не більший за таймер, і він зменшується.
  await expect(page.getByRole('timer', { name: 'Час на хід' })).toBeVisible();
  const first = await secondsLeft(page);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(60);
  await expect.poll(() => secondsLeft(page), { timeout: 5_000 }).toBeLessThan(first);

  // Хост ходить, доки не настане хід гостя.
  const guestTurn = guest.getByRole('status').filter({ hasText: /^Ваш хід/ });
  while (!(await guestTurn.isVisible())) await takeTurn(page);
  const facts = (await guest.locator('.game__facts').textContent()) ?? '';
  const dealt = await handOf(guest);
  expect(dealt.length).toBeGreaterThan(0);

  // Гість закриває вкладку: хост бачить, що його немає в мережі, і віддає місце боту.
  await guest.close();
  await expect(seat(page, 'Петро')).toContainText('не в мережі');
  await expect(page.locator('.game__turn')).toHaveText('Хід: Петро');
  await page.getByRole('button', { name: 'Віддати місце боту: Петро' }).click();
  await expect(seat(page, 'Петро')).toContainText('Петро (бот)');
  await expect(page.getByRole('button', { name: 'Віддати місце боту: Петро' })).toHaveCount(0);
  // Бот одразу ходить за гостя, не чекаючи на таймер: хід переходить далі.
  await expect(page.locator('.game__turn')).not.toHaveText('Хід: Петро');

  // Гість повертається за посиланням і знову займає своє місце.
  guest = await guestContext.newPage();
  await guest.goto(`/r/${code}${query()}`);
  await expect(seat(guest, 'Петро')).toContainText('ви');
  await expect(seat(page, 'Петро')).not.toContainText('(бот)');

  // Та сама роздача й ті самі карти (бот лише замовив за гостя), хост бачить стільки ж.
  await expect(guest.locator('.game__facts')).toHaveText(
    (await page.locator('.game__facts').textContent()) ?? '',
  );
  expect(facts).toMatch(/^Роздача 1 з/);
  await expect(guest.locator('.game__facts')).toContainText('Роздача 1 з');
  expect(await handOf(guest)).toEqual(dealt);
  await expect(seat(page, 'Петро')).toContainText(`Карт: ${dealt.length}`);
  await guestContext.close();
});
