import { type Page, expect, test } from '@playwright/test';
import { playUntil } from './support/player';

// T65: у панелі кожного гравця одне велике «M / N» (взяв / замовив) зі станом; на телефоні
// 360px із 6 гравцями — без горизонтального скролу й обрізання.

const LONG_NAME = 'Олександра Кравченко';

async function startGame(page: Page, bots: number): Promise<void> {
  await page.goto('/?trickPause=0');
  await page.getByLabel('Ваше імʼя').fill(LONG_NAME);
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < bots; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(
    bots + 1,
  );
  await page.getByRole('button', { name: 'Почати гру' }).click();
}

/** Грає, доки всі замовили і хтось уже взяв взятку. */
async function playUntilTaken(page: Page, players: number): Promise<void> {
  await playUntil(page, async () => {
    const values = await page
      .locator('.player__score[data-state] .player__score-value')
      .allTextContents();
    return values.length === players && values.some((value) => !value.startsWith('0 '));
  });
}

test('R-4.5: «взяв / замовив» на 6 гравцях вміщається без скролу й обрізання', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await startGame(page, 5);
  await playUntilTaken(page, 6);

  const rows = page.getByRole('list', { name: 'Гравці за столом' }).getByRole('listitem');
  await expect(rows).toHaveCount(6);
  for (const row of await rows.all()) {
    const score = row.locator('.player__score');
    await expect(score.locator('.player__score-label')).toHaveText('взяв/зам');
    await expect(score.locator('.player__score-value')).toHaveText(/^\d+ \/ \d+$/);
    await expect(score).toHaveAttribute('data-state', /^(under|exact|over)$/);
    // Значення цілком у своєму рядку й не обрізане.
    const cell = await row.boundingBox();
    const box = await score.boundingBox();
    expect(box?.x ?? -Infinity).toBeGreaterThanOrEqual(cell?.x ?? Infinity);
    expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (cell?.x ?? -Infinity) + (cell?.width ?? 0),
    );
    expect(await score.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }

  // Стан видно значком, не лише кольором.
  for (const [state, mark] of [
    ['exact', '✓'],
    ['over', '↑'],
  ] as const) {
    for (const score of await page.locator(`.player__score[data-state="${state}"]`).all()) {
      await expect(score.locator('.player__score-mark')).toHaveText(mark);
    }
  }

  if (test.info().project.name === 'mobile-360') {
    // Кожен гравець — і далі один вузький рядок.
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      expect(box?.height ?? Infinity).toBeLessThanOrEqual(40);
    }
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
