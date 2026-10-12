import { expect, test } from '@playwright/test';

/** A4 без полів 10 мм (`@page`) у CSS-пікселях. */
const MM = 96 / 25.4;
const PRINTABLE = { width: 190 * MM, height: 277 * MM };

test('T64: таблиця для друку відкривається з головного екрана й вміщується на 360px', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Таблиця для друку' }).click();
  await expect(page.getByRole('heading', { name: 'Таблиця для друку' })).toBeVisible();

  await page.getByRole('radio', { name: '5' }).check();
  const table = page.getByRole('table', { name: 'Таблиця для друку' });
  await expect(table.getByRole('columnheader', { name: 'Бали' })).toHaveCount(5);
  // R-2.1: 22 роздачі + 3 наростаючі підсумки + джокери + разом.
  await expect(table.locator('tbody tr')).toHaveCount(27);
  await expect(table.getByRole('rowheader', { name: 'Разом після основних' })).toBeVisible();
  await expect(table.locator('tbody tr').last()).toContainText('Разом');

  await page.getByRole('switch', { name: /Темною/ }).check();
  await expect(table.locator('tbody tr')).toHaveCount(28);
  await expect(table.locator('tbody tr[data-phase="dark"]')).toHaveCount(1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('T64: у друці таблиця вміщується на одну сторінку A4 для N = 3–6 з «Темною» і без', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Таблиця для друку' }).click();
  const table = page.getByRole('table', { name: 'Таблиця для друку' });
  const dark = page.getByRole('switch', { name: /Темною/ });

  for (const n of [3, 4, 5, 6]) {
    for (const withDark of [false, true]) {
      // Елементи вибору в друці приховані — перемикаємо їх на екрані.
      await page.emulateMedia({ media: 'screen' });
      await page.getByRole('radio', { name: String(n) }).check();
      await dark.setChecked(withDark);
      await expect(table).toHaveAttribute('data-players', String(n));
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByRole('heading', { name: 'Таблиця для друку' })).toBeHidden();

      const box = await table.boundingBox();
      if (box === null) throw new Error('Таблиця не видима в друці');
      expect(box.width).toBeLessThanOrEqual(PRINTABLE.width + 1);
      expect(box.height, `N = ${n}, Темна: ${withDark}`).toBeLessThanOrEqual(PRINTABLE.height);

      const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1');
      const pages = pdf.match(/\/Type\s*\/Page(?!s)/g) ?? [];
      expect(pages, `N = ${n}, Темна: ${withDark}`).toHaveLength(1);
    }
  }
});
