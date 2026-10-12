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

test('меню ⚙ на телефоні: кожен перемикач — в один рядок (підпис і стан не переносяться)', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-360', 'перевірка вузького екрана');
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', { name: 'Налаштування' }).click();
  const panel = page.getByRole('group', { name: 'Налаштування' });
  const items = panel.getByRole('button');
  // Вібрація, звук і тема.
  await expect(items).toHaveCount(3);
  await expect(panel.getByRole('button', { name: 'Вібрація на свій хід' })).toBeVisible();
  // Текст перемикача в один рядок: середини всіх рядків тексту (підпис і стан мають різний
  // кегль, але стоять по центру) майже збігаються.
  const spreads = await items.evaluateAll((buttons) =>
    buttons.map((button) => {
      const middles: number[] = [];
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) middles.push(rect.top + rect.height / 2);
      }
      return { text: button.textContent, spread: Math.max(...middles) - Math.min(...middles) };
    }),
  );
  for (const item of spreads) expect(item.spread, item.text ?? '').toBeLessThan(4);
  for (const item of await items.all()) await expect(item).toBeInViewport({ ratio: 1 });
});
