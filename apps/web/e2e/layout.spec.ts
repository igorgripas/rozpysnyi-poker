import { expect, test } from '@playwright/test';

test('каркас українською вміщується в екран без горизонтальної прокрутки', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await expect(page.getByRole('heading', { level: 1, name: 'Розписний покер' })).toBeVisible();
  await expect(page.locator('svg.card').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('перемикач теми змінює тему сторінки', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Налаштування' }).click();
  await page.getByRole('button', { name: 'Темна тема' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('шапка: назва в один рядок, вібрація, звук і тема — у меню ⚙, яке вміщується в екран', async ({
  page,
}) => {
  await page.goto('/');
  const title = page.getByRole('heading', { level: 1, name: 'Розписний покер' });
  await expect(title).toBeVisible();
  // Один рядок: висота заголовка не більша за висоту його рядка.
  const lines = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    return element.getBoundingClientRect().height / lineHeight;
  });
  expect(lines).toBeLessThan(1.5);

  const header = page.getByRole('banner');
  await expect(header.getByRole('button')).toHaveCount(1);
  const menu = header.getByRole('button', { name: 'Налаштування' });
  await menu.click();
  const panel = page.getByRole('group', { name: 'Налаштування' });
  await expect(panel.getByRole('button', { name: 'Темна тема' })).toBeInViewport({ ratio: 1 });
  // Стан перемикача читається текстом, і на 360px він теж у межах екрана.
  const sound = panel.getByRole('button', { name: 'Звуки гри' });
  await expect(sound).toContainText('увімкнено');
  await expect(sound).toBeInViewport({ ratio: 1 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
