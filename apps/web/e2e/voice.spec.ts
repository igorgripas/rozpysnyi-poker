import { type Page, type WebSocketRoute, expect, test } from '@playwright/test';

// Голосовий чат (T63): два гравці в окремих браузерах, мікрофон — фейковий пристрій Chromium
// (періодичний сигнал), дозвіл на мікрофон надано заздалегідь.
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

function seat(page: Page, name: string) {
  return page.getByRole('list', { name: 'Гравці' }).getByRole('listitem').filter({ hasText: name });
}

/** Звук гравця `from` грає на сторінці (WebRTC-потік у елементі audio). */
async function hears(page: Page): Promise<{ playing: boolean; muted: boolean }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLAudioElement>('audio[data-voice-peer]')].map((audio) => ({
      playing: audio.srcObject !== null && !audio.paused,
      muted: audio.muted,
    })),
  );
}

test('два гравці говорять голосом; вимкнення звуку інших; після перепідключення голос відновлюється', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const baseURL = testInfo.project.use.baseURL ?? '';
  await page.context().grantPermissions(['microphone'], { origin: baseURL });
  // Перехоплюємо WebSocket Олі, щоб розірвати зʼєднання з сервером на вимогу.
  const sockets: { page: WebSocketRoute; server: WebSocketRoute }[] = [];
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    sockets.push({ page: ws, server: ws.connectToServer() });
  });
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  const heading = page.getByRole('heading', { name: /^Кімната [A-Z0-9]{5}$/ });
  await expect(heading).toBeVisible();
  const code = ((await heading.textContent()) ?? '').replace('Кімната ', '');

  const guestContext = await browser.newContext({ permissions: ['microphone'] });
  const guest = await guestContext.newPage();
  await guest.goto(`/r/${code}`);
  await guest.getByLabel('Ваше імʼя').fill('Петро');
  await guest.getByRole('button', { name: 'Увійти в кімнату' }).click();
  await expect(seat(page, 'Петро')).toBeVisible();

  // Мікрофон вимкнений за замовчуванням; Оля вмикає — Петро чує її й бачить, що вона говорить.
  const mic = page.getByRole('button', { name: 'Мікрофон' });
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(seat(guest, 'Оля')).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
  await expect(seat(page, 'Оля')).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
  await expect
    .poll(() => hears(guest), { timeout: 20_000 })
    .toEqual([{ playing: true, muted: false }]);

  // Петро вимикає звук інших.
  const mute = guest.getByRole('button', { name: 'Вимкнути звук інших' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => hears(guest)).toEqual([{ playing: true, muted: true }]);
  await mute.click();

  // Петро перепідключається (оновлює сторінку) — голос відновлюється без дій Олі.
  await guest.reload();
  await expect(seat(guest, 'Оля')).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
  await expect
    .poll(() => hears(guest), { timeout: 20_000 })
    .toEqual([{ playing: true, muted: false }]);

  // Обрив звʼязку Олі з сервером (сон телефона, деплой): після повернення голос знову працює.
  const count = sockets.length;
  for (const ws of sockets) {
    await ws.server.close();
    await ws.page.close({ code: 4000, reason: 'e2e' });
  }
  await expect(page.getByRole('img', { name: 'Немає звʼязку' })).toBeVisible();
  await expect.poll(() => hears(guest)).toEqual([]);
  await expect.poll(() => sockets.length).toBeGreaterThan(count);
  await expect(page.getByRole('img', { name: 'Звʼязок є' })).toBeVisible();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => hears(guest), { timeout: 20_000 })
    .toEqual([{ playing: true, muted: false }]);
  await expect(seat(guest, 'Оля')).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });

  await guestContext.close();
});
