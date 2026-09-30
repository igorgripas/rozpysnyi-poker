import { type WebSocketRoute, expect, test } from '@playwright/test';

test('PWA: маніфест й іконки доступні, застосунок можна встановити', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const response = await request.get(href ?? '');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { display: string; icons: { src: string }[] };
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  }
  expect((await request.get('/sw.js')).ok()).toBe(true);
});

test('обрив звʼязку: стан показано на екрані, перепідключення й повернення в кімнату автоматичні', async ({
  page,
  browser,
}) => {
  // Перехоплюємо WebSocket, щоб розірвати зʼєднання на вимогу.
  const sockets: { page: WebSocketRoute; server: WebSocketRoute }[] = [];
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    sockets.push({ page: ws, server: ws.connectToServer() });
  });

  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Звʼязок є' })).toBeVisible();
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  const heading = page.getByRole('heading', { name: /^Кімната [A-Z0-9]{5}$/ });
  await expect(heading).toBeVisible();
  const code = ((await heading.textContent()) ?? '').replace('Кімната ', '');

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(`/r/${code}`);
  await guest.getByLabel('Ваше імʼя').fill('Петро');
  await guest.getByRole('button', { name: 'Увійти в кімнату' }).click();
  const host = guest.getByRole('list', { name: 'Гравці' }).getByRole('listitem').first();
  await expect(host).toContainText('Оля');
  await expect(host).not.toContainText('не в мережі');

  // Обрив: хост бачить повідомлення, гість — що хост не в мережі.
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  const count = sockets.length;
  for (const ws of sockets) {
    await ws.server.close();
    await ws.page.close({ code: 4000, reason: 'e2e' });
  }
  await expect(page.getByRole('alert')).toContainText('Немає звʼязку з сервером');
  await expect(page.getByRole('img', { name: 'Немає звʼязку' })).toBeVisible();
  await expect(host).toContainText('не в мережі');

  // Socket.IO перепідключається сам, клієнт повертається в кімнату за токеном.
  await expect.poll(() => sockets.length).toBeGreaterThan(count);
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('img', { name: 'Звʼязок є' })).toBeVisible();
  await expect(host).not.toContainText('не в мережі');

  // Сесія на сервері відновлена: хост може керувати кімнатою.
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(guest.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(3);
  await guestContext.close();
});
