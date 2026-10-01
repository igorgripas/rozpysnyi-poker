import { expect, test } from '@playwright/test';

const API = process.env.SMOKE_API_URL ?? 'https://rozpysnyi-poker-api.onrender.com';

test('сервер живий: /health', async ({ request }) => {
  await expect
    .poll(async () => (await request.get(`${API}/health`, { timeout: 30_000 })).status(), {
      timeout: 120_000,
      intervals: [5_000],
    })
    .toBe(200);
  const body = await (await request.get(`${API}/health`)).json();
  expect(body.ok).toBe(true);
});

test('гра на проді: кімната з ботами, старт і перший хід', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Smoke');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  const heading = page.getByRole('heading', { name: /^Кімната [A-Z0-9]{5}$/ });
  await expect(heading).toBeVisible();
  const code = ((await heading.textContent()) ?? '').replace('Кімната ', '');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Почати гру' }).click();
  await expect(page.getByRole('region', { name: 'Роздача' })).toContainText('Роздача 1 з');

  // Перший власний хід: замовлення або карта — сервер має прийняти й розіслати новий стан.
  const bid = page
    .getByRole('group', { name: 'Ваше замовлення' })
    .locator('button:enabled')
    .first();
  const card = page.locator('.hand__card:enabled').first();
  await expect(bid.or(card)).toBeVisible();
  if (await bid.isVisible()) {
    await bid.click();
    await expect(page.getByRole('group', { name: 'Ваше замовлення' })).toBeHidden();
  } else {
    const id = await card.getAttribute('data-card');
    await page.locator(`.hand__card[data-card="${id}"]`).click();
    await page.locator(`.hand__card[data-card="${id}"]`).click();
    await expect(page.locator(`.hand__card[data-card="${id}"]`)).toHaveCount(0);
  }

  // Посилання-запрошення відкриває застосунок (SPA-перезапис на Render).
  const invite = await page.context().newPage();
  const response = await invite.goto(`/r/${code}`);
  expect(response?.status()).toBe(200);
  await expect(invite.getByRole('heading', { name: 'Розписний покер' })).toBeVisible();
});
