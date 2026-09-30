import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';

/** Інтервал перевірки сторінки, мс. Не `raf`: у фонових вкладках кадри не малюються. */
const POLL_MS = 25;

/** Що зараз може зробити гравець на своїй сторінці. */
type Move = 'done' | 'joker' | 'bid' | 'play';

/** Знімок того, що бачить гравець: після його дії він обовʼязково змінюється. */
function snapshot(): string {
  const text = (selector: string) => document.querySelector(selector)?.textContent ?? '';
  // Без вибору карти (aria-pressed): він змінюється ще до відповіді сервера.
  const hand = [...document.querySelectorAll('.hand__card')].map((card) =>
    card.getAttribute('data-card'),
  );
  return [
    text('.game__facts'),
    text('.game__turn'),
    hand.join(','),
    document.querySelector('[role="dialog"]') ? 'dialog' : '',
    document.querySelector('.bidding__options') ? 'bidding' : '',
    document.querySelector('.results') ? 'results' : '',
  ].join('|');
}

/** Чекає, поки гравцеві буде що робити (або гру завершено). */
async function nextMove(page: Page, timeout: number): Promise<Move> {
  const handle = await page.waitForFunction(
    () => {
      if (document.querySelector('.results')) return 'done';
      if (document.querySelector('.joker-dialog')) return 'joker';
      if (document.querySelector('.bidding__options button:not(:disabled)')) return 'bid';
      if (document.querySelector('.hand__card:not(:disabled)')) return 'play';
      return false;
    },
    null,
    { polling: POLL_MS, timeout },
  );
  return (await handle.jsonValue()) as Move;
}

/**
 * Робить один хід через інтерфейс, як людина: замовлення — перша дозволена кнопка,
 * карта — перша легальна (тап вибирає, другий тап грає), джокер — перше оголошення.
 * Повертає `false`, якщо гру завершено.
 */
export async function takeTurn(page: Page, timeout = 60_000): Promise<boolean> {
  const move = await nextMove(page, timeout);
  if (move === 'done') return false;
  const before = await page.evaluate(snapshot);
  if (move === 'bid') {
    await page
      .getByRole('group', { name: 'Ваше замовлення' })
      .locator('button:enabled')
      .first()
      .click();
  } else if (move === 'joker') {
    await page.locator('.joker-dialog button').first().click();
  } else {
    const card = page.locator('.hand__card:enabled').first();
    await card.click();
    await card.click();
  }
  // Дія дійшла до сервера, і він надіслав новий стан.
  await page.waitForFunction(`(${snapshot.toString()})() !== ${JSON.stringify(before)}`, null, {
    polling: POLL_MS,
    timeout,
  });
  return true;
}

/** Грає за гравця, поки гру не завершено або поки `until` не стане істинним. */
export async function playUntil(
  page: Page,
  until: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<void> {
  while (!(await until())) {
    if (!(await takeTurn(page))) return;
  }
}

/** Перевірка доступності axe (WCAG 2.1 A/AA) для поточного екрана. */
export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = violations.map(
    (v) => `${v.id}: ${v.help} — ${v.nodes.map((node) => node.target.join(' ')).join('; ')}`,
  );
  expect(summary).toEqual([]);
}
