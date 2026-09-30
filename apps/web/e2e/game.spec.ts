import { expect, test } from '@playwright/test';

test('ігровий стіл: рука, гравці й стіл вміщуються в екран', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  const hand = page.getByRole('list', { name: 'Ваші карти' });
  await expect(hand.getByRole('button')).toHaveCount(1);
  await expect(
    page.getByRole('list', { name: 'Гравці за столом' }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Стіл' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Роздача' })).toContainText('Козир:');
  await expect(page.getByRole('status')).toContainText(/Ваш хід|Хід: Бот/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('замовлення: кнопки 0…K, сума замовлень на екрані', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Почати гру' }).click();

  // Перша роздача — 1 карта: кнопки 0 і 1.
  const options = page.getByRole('group', { name: 'Ваше замовлення' }).getByRole('button');
  await expect(options).toHaveText(['0', '1']);
  await expect(page.getByRole('region', { name: 'Роздача' })).toContainText(/Замовлено: \d з 1/);
  const enabled = options.and(page.locator(':enabled')).first();
  await enabled.click();
  await expect(page.getByRole('group', { name: 'Ваше замовлення' })).toBeHidden();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('R-4.2: черга замовлень показує замовлення попередніх гравців у порядку ходу', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(6);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  await expect(page.getByRole('group', { name: 'Ваше замовлення' })).toBeVisible();
  const items = page.getByRole('list', { name: 'Черга замовлень' }).getByRole('listitem');
  await expect(items).toHaveCount(6);
  // Роздаючий — останній у черзі (R-4.2).
  await expect(items.last()).toHaveAttribute('data-dealer', 'true');
  const names = await items.locator('.bid-queue__name').allTextContents();
  const values = await items.locator('.bid-queue__value').allTextContents();
  const mine = names.indexOf('Оля');
  // Черга йде за годинниковою стрілкою: Оля (місце 1), далі Бот 1…Бот 5.
  const seats = ['Оля', 'Бот 1', 'Бот 2', 'Бот 3', 'Бот 4', 'Бот 5'];
  const first = seats.indexOf(names[0] ?? '');
  expect(names).toEqual(seats.map((_, i) => seats[(first + i) % 6]));
  values.forEach((value, i) => {
    if (i < mine) expect(value).toMatch(/^\d+$/);
    else if (i === mine) expect(value).toBe('?');
    else expect(value).toBe('—');
  });
  await expect(items.nth(mine)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('region', { name: 'Замовлення' })).toContainText(/Сума: \d з 1/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Число в кожній клітинці видно повністю, у межах ширини екрана.
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (const value of await items.locator('.bid-queue__value').all()) {
    const box = await value.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width).toBe(true);
  }
});

test('таблиця гри відкривається під час гри й на 6 гравців вміщується без прокручування', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(6);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  await page.getByRole('button', { name: 'Таблиця' }).click();
  const dialog = page.getByRole('dialog', { name: 'Таблиця гри' });
  const table = dialog.getByRole('table', { name: 'Таблиця гри' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('rowheader').first()).toHaveText(/^1(б\/к|[♠♣♦♥])$/);
  await expect(dialog.getByRole('note')).toContainText('Б — безкозирка');

  const scroll = dialog.locator('.sheet__scroll');
  const overflow = await scroll.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Закріплена ліва колонка не перекриває першу колонку гравця.
  const corner = await dialog.locator('.sheet__corner').boundingBox();
  const firstPlayer = await dialog.locator('.sheet__name').first().boundingBox();
  expect((corner?.x ?? 0) + (corner?.width ?? 0)).toBeLessThanOrEqual((firstPlayer?.x ?? 0) + 0.5);

  await dialog.getByRole('button', { name: 'Закрити' }).click();
  await expect(dialog).toBeHidden();
});

test('пауза після взятки: видно, хто бере, і всі карти; у новій роздачі стіл чистий (R-9.2)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  // Перша роздача — 1 карта: замовлення й одна взятка.
  const bidding = page.getByRole('group', { name: 'Ваше замовлення' });
  await bidding.locator('button:enabled').first().click();
  const card = page.locator('.hand__card:enabled').first();
  await card.click();
  await card.click();
  // Джокер спершу питає оголошення.
  if (await page.locator('.joker-dialog').isVisible()) {
    await page.locator('.joker-dialog button').first().click();
  }

  const felt = page.getByRole('region', { name: 'Стіл' });
  const players = page.getByRole('list', { name: 'Гравці за столом' }).getByRole('listitem');
  await expect(felt.locator('.felt__trick--taken')).toBeVisible();
  await expect(felt).toContainText(/Бере: Бот \d|Ви берете/);
  await expect(felt.getByRole('figure')).toHaveCount(3);
  await expect(felt.locator('.felt__card[data-winner]')).toHaveCount(1);
  // Хто взяв останню взятку — підсвічено й підписано.
  await expect(players.and(page.locator('[data-last-taker]'))).toHaveCount(1);
  await expect(players.and(page.locator('[data-last-taker]'))).toContainText('взяв останню');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Після паузи — друга роздача: замовлення, а на столі нічого з попередньої.
  await expect(page.getByRole('region', { name: 'Роздача' })).toContainText('Роздача 2 з');
  await expect(felt.getByRole('figure')).toHaveCount(0);
  await expect(felt).not.toContainText('Остання взятка');
  await expect(players.and(page.locator('[data-last-taker]'))).toHaveCount(0);
});
