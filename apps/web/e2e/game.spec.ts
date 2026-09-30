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
