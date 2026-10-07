import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';

/** Інтервал перевірки сторінки, мс. Не `raf`: у фонових вкладках кадри не малюються. */
const POLL_MS = 25;

/** Що зараз може зробити гравець на своїй сторінці. */
type Move = 'done' | 'joker' | 'bid' | 'play';

/**
 * Знімок того, що бачить гравець: після його дії він обовʼязково змінюється.
 * `withDialog: false` — без діалогу: він закривається ще до відповіді сервера.
 */
function snapshot(withDialog: boolean): string {
  const text = (selector: string) => document.querySelector(selector)?.textContent ?? '';
  // Без вибору карти (aria-pressed): він змінюється ще до відповіді сервера.
  const hand = [...document.querySelectorAll('.hand__card')].map((card) =>
    card.getAttribute('data-card'),
  );
  return [
    text('.game__facts'),
    text('.game__turn'),
    hand.join(','),
    withDialog && document.querySelector('[role="dialog"]') ? 'dialog' : '',
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

/** Скільки чекати на свій хід і на відповідь сервера, мс. */
const TURN_TIMEOUT_MS = 60_000;

/** Скільки чекати, поки кнопка стане клікабельною, мс: дія не має висіти до таймауту тесту. */
const ACTION_TIMEOUT_MS = 10_000;

/**
 * Точка тапу по карті в руці — біля лівого краю: карти перекриваються, і від 11 карт на 360px
 * центр карти накриває сусідня справа. Видима смужка кожної карти — ліва, а 16px від верху
 * лишаються на карті й після того, як вибрана карта підніметься.
 */
const CARD_POINT = { x: 6, y: 16 };

/**
 * Робить хід `move` через інтерфейс, як людина: замовлення — перша дозволена кнопка,
 * карта — перша легальна (тап вибирає, другий тап грає — подвійним кліком), джокер — перше
 * оголошення. Чекає на новий стан від сервера; відмова сервера — одразу помилка з її текстом.
 */
async function act(page: Page, move: Exclude<Move, 'done'>, timeout: number): Promise<void> {
  // Після оголошення джокера чекаємо на новий стан від сервера, а не на закриття діалогу.
  const withDialog = move !== 'joker';
  const before = await page.evaluate(snapshot, withDialog);
  const options = { timeout: Math.min(timeout, ACTION_TIMEOUT_MS) };
  if (move === 'bid') {
    await page
      .getByRole('group', { name: 'Ваше замовлення' })
      .locator('button:enabled')
      .first()
      .click(options);
  } else if (move === 'joker') {
    await page.locator('.joker-dialog button').first().click(options);
  } else {
    // Конкретна карта за data-card: «перша доступна» може змінитися між тапами.
    const id = await page.locator('.hand__card:enabled').first().getAttribute('data-card', options);
    const card = page.locator(`.hand__card[data-card="${id}"]`);
    const tap = { ...options, position: CARD_POINT };
    // Два тапи одним подвійним кліком: удвічі менше перевірок дієздатності на хід.
    if ((await card.getAttribute('aria-pressed', options)) === 'true') await card.click(tap);
    else await card.dblclick(tap);
  }
  // Дія дійшла до сервера, і він надіслав новий стан — або відмовив (повідомлення в role=alert).
  const outcome = await page.waitForFunction(
    `(() => {
      if ((${snapshot.toString()})(${withDialog}) !== ${JSON.stringify(before)}) return 'ok';
      const alert = document.querySelector('p.error[role="alert"]');
      return alert === null ? false : 'error: ' + alert.textContent;
    })()`,
    null,
    { polling: POLL_MS, timeout },
  );
  const result = (await outcome.jsonValue()) as string;
  if (result !== 'ok') throw new Error(`Сервер не прийняв хід (${move}): ${result}`);
}

/**
 * Робить один хід (чекає на нього до `timeout` мс). Повертає `false`, якщо гру завершено.
 */
export async function takeTurn(page: Page, timeout = TURN_TIMEOUT_MS): Promise<boolean> {
  const move = await nextMove(page, timeout);
  if (move === 'done') return false;
  await act(page, move, timeout);
  return true;
}

/**
 * Грає за гравця, поки гру не завершено або поки `until` не стане істинним.
 * `until` перевіряється щоразу, коли гравцеві знову є що робити, — тобто в його хід.
 */
export async function playUntil(
  page: Page,
  until: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<void> {
  for (;;) {
    const move = await nextMove(page, TURN_TIMEOUT_MS);
    if (move === 'done' || (await until())) return;
    await act(page, move, TURN_TIMEOUT_MS);
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
