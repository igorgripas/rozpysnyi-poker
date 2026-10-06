import { type Page, expect, test } from '@playwright/test';

// Телефон 360×740: на своєму замовленні гравець бачить «Ваш хід», чергу замовлень і кнопки
// без прокручування — гравці показані компактними рядками «імʼя · замовлення · взяв».

const LONG_NAME = 'Олександра Кравченко';

async function startGame(page: Page, bots: number): Promise<void> {
  await page.goto('/');
  // Найдовше імʼя (20 символів): рядок гравця не має розпирати екран.
  await page.getByLabel('Ваше імʼя').fill(LONG_NAME);
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < bots; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(
    bots + 1,
  );
  await page.getByRole('button', { name: 'Почати гру' }).click();
}

for (const players of [4, 6]) {
  test(`замовлення на телефоні: ${players} гравців, «Ваш хід» і панель замовлення видно без прокрутки`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-360', 'перевірка вузького екрана');
    await startGame(page, players - 1);

    const turn = page.locator('.game__turn');
    await expect(turn).toHaveText('Ваш хід — замовлення', { timeout: 15_000 });
    const rows = page.getByRole('list', { name: 'Гравці за столом' }).getByRole('listitem');
    await expect(rows).toHaveCount(players);

    // Кожен гравець — один вузький рядок.
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      expect(box?.height ?? Infinity).toBeLessThanOrEqual(40);
    }

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const bidding = page.getByRole('region', { name: 'Замовлення' });
    await expect(turn).toBeInViewport({ ratio: 1 });
    await expect(bidding.getByRole('list', { name: 'Черга замовлень' })).toBeInViewport({
      ratio: 1,
    });
    await expect(bidding.getByRole('group', { name: 'Ваше замовлення' })).toBeInViewport({
      ratio: 1,
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
