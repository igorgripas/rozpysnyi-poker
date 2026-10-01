import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { expectAccessible, playUntil } from './support/player';

const NAMES = ['Оля', 'Петро', 'Марія', 'Тарас'];

test('повна гра: 4 гравці в окремих браузерах грають усі 22 роздачі до результатів', async ({
  browser,
}, testInfo) => {
  test.setTimeout(10 * 60_000);
  const { viewport, isMobile, hasTouch, baseURL } = testInfo.project.use;
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const context = await browser.newContext({
      ...(viewport !== undefined && { viewport }),
      ...(isMobile !== undefined && { isMobile }),
      ...(hasTouch !== undefined && { hasTouch }),
      ...(baseURL !== undefined && { baseURL }),
    });
    contexts.push(context);
    pages.push(await context.newPage());
  }
  const [host, ...guests] = pages as [Page, ...Page[]];

  // Пауза взятки вимкнена: інакше 162 взятки не вкладуться в таймаут.
  await host.goto('/?trickPause=0');
  await host.getByLabel('Ваше імʼя').fill(NAMES[0] ?? '');
  await host.getByRole('button', { name: 'Створити кімнату' }).click();
  const heading = host.getByRole('heading', { name: /^Кімната [A-Z0-9]{5}$/ });
  const code = ((await heading.textContent()) ?? '').replace('Кімната ', '');

  for (const [i, guest] of guests.entries()) {
    await guest.goto(`/r/${code}?trickPause=0`);
    await guest.getByLabel('Ваше імʼя').fill(NAMES[i + 1] ?? '');
    await guest.getByRole('button', { name: 'Увійти в кімнату' }).click();
    await expect(guest.getByText('Чекаємо, поки хост почне гру')).toBeVisible();
  }
  await expect(host.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(4);
  await host.getByRole('button', { name: 'Почати гру' }).click();
  for (const page of pages) {
    await expect(page.getByRole('region', { name: 'Роздача' })).toContainText('Роздача 1 з 22');
  }

  // Кожен гравець грає у своєму браузері одночасно з іншими; ходи чергує сервер.
  await Promise.all(pages.map((page) => playUntil(page)));

  // Фінальний екран однаковий у всіх: ті самі підсумки в тому самому порядку.
  const results = await Promise.all(
    pages.map(async (page) => {
      const summary = page.getByRole('region', { name: 'Результати' });
      await expect(summary.getByRole('heading', { name: 'Гру завершено' })).toBeVisible();
      await expect(summary.getByRole('listitem')).toHaveCount(4);
      // Привітання переможця з анімацією кубка (рух не вимкнено).
      await expect(summary.getByRole('heading', { level: 3 })).toContainText(
        /^🏆 Вітаємо, .+! (Спільна п|П)еремога з −?\d+ очк/,
      );
      const animation = await summary
        .locator('.results__trophy')
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(animation).toBe('trophy-bounce');
      return summary.getByRole('listitem').allTextContents();
    }),
  );
  for (const result of results) expect(result).toEqual(results[0]);
  expect(
    (results[0] ?? []).map((row) => NAMES.find((name) => row.startsWith(name))).sort(),
  ).toEqual([...NAMES].sort());
  await expect(host.getByRole('table', { name: 'Таблиця гри' })).toBeVisible();
  await expectAccessible(host);

  for (const context of contexts) await context.close();
});
