import { type Page, expect, test } from '@playwright/test';

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill(name);
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  const heading = page.getByRole('heading', { name: /^Кімната [A-Z0-9]{5}$/ });
  await expect(heading).toBeVisible();
  return ((await heading.textContent()) ?? '').replace('Кімната ', '');
}

function players(page: Page) {
  return page.getByRole('list', { name: 'Гравці' }).getByRole('listitem');
}

test('хост створює кімнату, гість входить за посиланням, хост додає бота й починає гру', async ({
  page,
  browser,
}) => {
  const code = await createRoom(page, 'Оля');
  await expect(page).toHaveURL(new RegExp(`/r/${code}$`));

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(`/r/${code}`);
  await expect(guest.getByText(`Вас запросили в кімнату ${code}`)).toBeVisible();
  await guest.getByLabel('Ваше імʼя').fill('Петро');
  await guest.getByRole('button', { name: 'Увійти в кімнату' }).click();
  await expect(guest.getByRole('heading', { name: `Кімната ${code}` })).toBeVisible();
  await expect(guest.getByText('Чекаємо, поки хост почне гру')).toBeVisible();

  await expect(players(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Почати гру' })).toBeDisabled();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(players(guest)).toHaveCount(3);

  // Гість оновлює сторінку й повертається в кімнату за токеном.
  await guest.reload();
  await expect(players(guest)).toHaveCount(3);

  await page.getByRole('button', { name: 'Почати гру' }).click();
  for (const player of [page, guest]) {
    await expect(player.getByRole('list', { name: 'Ваші карти' })).toBeVisible();
    await expect(player.getByRole('region', { name: 'Роздача' })).toContainText('Роздача 1 з 23');
  }
  await guestContext.close();
});

test('вхід за кодом: невідома кімната показує помилку', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Петро');
  await page.getByLabel('Код кімнати').fill('zzzzz');
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Кімнати ZZZZZ немає');
});

test('кімната очікування вміщується в екран без горизонтальної прокрутки', async ({ page }) => {
  await createRoom(page, 'Оля');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
