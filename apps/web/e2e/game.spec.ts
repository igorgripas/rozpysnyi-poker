import { type Locator, type Page, expect, test } from '@playwright/test';
import { playUntil } from './support/player';

test('ігровий стіл: рука, гравці й стіл вміщуються в екран', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  const hand = page.getByRole('list', { name: 'Ваші карти' });
  await expect(hand.getByRole('button')).toHaveCount(1);
  await expect(
    page.getByRole('list', { name: 'Гравці за столом' }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Стіл' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Роздача' })).toContainText('Козир:');
  await expect(page.getByRole('status')).toContainText(/Ваш хід|Хід: Бот/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('R-3.1: відкрита карта-козир не менша за карту в руці, значок козиря більший за текст', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Почати гру' }).click();

  const info = page.getByRole('region', { name: 'Роздача' });
  const table = page.getByRole('region', { name: 'Стіл' });
  // Перша роздача — «Зростання»: відкрита карта лежить на столі, але без видимого підпису.
  const revealed = table.getByRole('figure', { name: 'Відкрита карта' }).locator('.card');
  await expect(revealed).toBeVisible();
  await expect(table).not.toContainText('Відкрита карта');
  const handCard = page.getByRole('list', { name: 'Ваші карти' }).locator('.card').first();
  await expect(handCard).toBeVisible();
  const [own, open] = await Promise.all([handCard.boundingBox(), revealed.boundingBox()]);
  expect(open?.width ?? 0).toBeGreaterThanOrEqual(own?.width ?? Infinity);
  expect(open?.height ?? 0).toBeGreaterThanOrEqual(own?.height ?? Infinity);

  // Значок козиря (якщо відкрито не джокера) — щонайменше в 1.5 раза більший за текст.
  const mark = info.locator('.game__trump .suit-mark');
  if ((await mark.count()) > 0) {
    const ratio = await mark.evaluate((element) => {
      const size = (node: Element) => parseFloat(getComputedStyle(node).fontSize);
      return size(element) / size(element.closest('.game__trump') as Element);
    });
    expect(ratio).toBeGreaterThanOrEqual(1.5);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('R-3.4: «Без козиря» на місці відкритої карти не дрібніше за текст гравців і вміщується', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Почати гру' }).click();
  const table = page.getByRole('region', { name: 'Стіл' });
  await expect(table.locator('.game__revealed')).toBeVisible();

  // Безкозирні роздачі йдуть наприкінці гри, тож слот підмінюємо на той, що без козиря.
  const slot = await table.locator('.game__revealed').evaluate((element) => {
    const none = document.createElement('span');
    none.className = 'game__revealed game__revealed--none';
    none.textContent = 'Без козиря';
    element.replaceWith(none);
    const size = (node: Element) => parseFloat(getComputedStyle(node).fontSize);
    const player = document.querySelector('.player') as Element;
    return {
      size: size(none),
      text: size(player),
      overflow: none.scrollWidth - none.clientWidth,
    };
  });
  expect(slot.size).toBeGreaterThanOrEqual(slot.text);
  expect(slot.overflow).toBeLessThanOrEqual(0);
});

/** Козир на столі, взятка, рука й чий хід — на одному екрані, без прокручування між ними. */
async function expectTrumpWithHand(page: Page): Promise<void> {
  const table = page.getByRole('region', { name: 'Стіл' });
  const trump = table.locator('.game__revealed');
  const hand = page.getByRole('list', { name: 'Ваші карти' });
  // Гравець тримає руку на екрані (прокручує до неї) — козир і стіл лишаються видимими.
  await hand.scrollIntoViewIfNeeded();
  await expect(hand).toBeInViewport({ ratio: 1 });
  await expect(trump).toBeInViewport({ ratio: 1 });
  await expect(table.getByRole('group', { name: 'Взятка' })).toBeInViewport();
  await expect(page.locator('.player[aria-current="true"]')).toBeInViewport();
  // Козир не перекриває карти взятки.
  const box = await trump.boundingBox();
  for (const card of await table.locator('.felt__card').all()) {
    const other = await card.boundingBox();
    if (box === null || other === null) continue;
    const apart =
      box.x + box.width <= other.x ||
      other.x + other.width <= box.x ||
      box.y + box.height <= other.y ||
      other.y + other.height <= box.y;
    expect(apart).toBe(true);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Перевіряє екран у в'юпорті проєкту, а на телефоні — ще й на типових 390×844 і 412×915. */
async function expectOnPhones(page: Page, mobile: boolean): Promise<void> {
  const own = page.viewportSize();
  const sizes = mobile ? [own, { width: 390, height: 844 }, { width: 412, height: 915 }] : [own];
  for (const size of sizes) {
    if (size !== null) await page.setViewportSize(size);
    await expectTrumpWithHand(page);
  }
  if (own !== null) await page.setViewportSize(own);
}

test('R-3.1: козир на столі видно разом із рукою під час замовлень і розіграшу', async ({
  page,
}, testInfo) => {
  test.setTimeout(3 * 60_000);
  const mobile = testInfo.project.name === 'mobile-360';
  await page.goto('/?trickPause=0');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(4);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  // Замовлення: козир (відкрита карта першої роздачі) видно разом із рукою.
  await expect(page.getByRole('group', { name: 'Ваше замовлення' })).toBeVisible();
  await expectOnPhones(page, mobile);

  // Розіграш посеред роздачі: на столі вже є карти суперників, ваш хід.
  await playUntil(page, async () => {
    const onTable = await page
      .locator('.felt__trick:not(.felt__trick--last, .felt__trick--taken) .felt__card')
      .count();
    return (
      onTable >= 2 &&
      (await page.locator('.hand__card').count()) >= 2 &&
      (await page.locator('.hand__card:enabled').count()) > 0
    );
  });
  await expectOnPhones(page, mobile);
});

test('замовлення: кнопки 0…K, сума замовлень на екрані', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Почати гру' }).click();

  // Перша роздача — 1 карта: кнопки 0 і 1.
  const options = page.getByRole('group', { name: 'Ваше замовлення' }).getByRole('button');
  await expect(options).toHaveText(['0', '1']);
  await expect(page.getByRole('region', { name: 'Роздача' })).toContainText(/Замовлено: \d з 1/);
  const enabled = options.and(page.locator(':enabled')).first();
  await enabled.click();
  await expect(page.getByRole('group', { name: 'Ваше замовлення' })).toBeHidden();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('R-4.2: черга замовлень показує замовлення попередніх гравців у порядку ходу', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(6);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  await expect(page.getByRole('group', { name: 'Ваше замовлення' })).toBeVisible();
  const items = page.getByRole('list', { name: 'Черга замовлень' }).getByRole('listitem');
  await expect(items).toHaveCount(6);
  // Роздаючий — останній у черзі (R-4.2).
  await expect(items.last()).toHaveAttribute('data-dealer', 'true');
  const names = await items.locator('.bid-queue__name').allTextContents();
  const values = await items.locator('.bid-queue__value').allTextContents();
  const mine = names.indexOf('Оля');
  // Черга йде за годинниковою стрілкою: Оля (місце 1), далі Бот 1…Бот 5.
  const seats = ['Оля', 'Бот 1', 'Бот 2', 'Бот 3', 'Бот 4', 'Бот 5'];
  const first = seats.indexOf(names[0] ?? '');
  expect(names).toEqual(seats.map((_, i) => seats[(first + i) % 6]));
  values.forEach((value, i) => {
    if (i < mine) expect(value).toMatch(/^\d+$/);
    else if (i === mine) expect(value).toBe('?');
    else expect(value).toBe('—');
  });
  await expect(items.nth(mine)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('region', { name: 'Замовлення' })).toContainText(/Сума: \d з 1/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Число в кожній клітинці видно повністю, у межах ширини екрана.
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (const value of await items.locator('.bid-queue__value').all()) {
    const box = await value.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width).toBe(true);
  }
});

test('таблиця гри відкривається під час гри й на 6 гравців вміщується без прокручування', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(6);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  await page.getByRole('button', { name: 'Таблиця' }).click();
  const dialog = page.getByRole('dialog', { name: 'Таблиця гри' });
  const table = dialog.getByRole('table', { name: 'Таблиця гри' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('rowheader').first()).toHaveText(/^1(б\/к|[♠♣♦♥]\uFE0E)$/);
  await expect(dialog.getByRole('note')).toContainText('Б — безкозирка');
  // R-3.1: легенда пояснює козир після літери мізеру й відіграшу й не виходить за екран.
  const legend = dialog.getByRole('note');
  await expect(legend).toContainText('М — мізер · В — відіграш (після літери — козир)');
  const legendBox = await legend.boundingBox();
  const viewport = page.viewportSize();
  expect((legendBox?.x ?? -1) >= 0).toBe(true);
  expect((legendBox?.x ?? 0) + (legendBox?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
  expect(await legend.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

  const scroll = dialog.locator('.sheet__scroll');
  const overflow = await scroll.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Закріплена ліва колонка не перекриває першу колонку гравця.
  const corner = await dialog.locator('.sheet__corner').boundingBox();
  const firstPlayer = await dialog.locator('.sheet__name').first().boundingBox();
  expect((corner?.x ?? 0) + (corner?.width ?? 0)).toBeLessThanOrEqual((firstPlayer?.x ?? 0) + 0.5);

  await dialog.getByRole('button', { name: 'Закрити' }).click();
  await expect(dialog).toBeHidden();
});

test('R-8.2: після роздачі в таблиці «замовив→взяв» з влучанням; на 6 гравців усе видно', async ({
  page,
}) => {
  test.setTimeout(2 * 60_000);
  await page.goto('/?trickPause=0');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(6);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  // Перша роздача (1 карта) зіграна: у руці вже 2 карти другої роздачі.
  await playUntil(page, async () => (await page.locator('.hand__card').count()) === 2);

  await page.getByRole('button', { name: 'Таблиця' }).click();
  const dialog = page.getByRole('dialog', { name: 'Таблиця гри' });
  const outcomes = dialog.locator('tbody tr').first().locator('.sheet__outcome');
  await expect(outcomes).toHaveCount(6);
  // Між замовленням і «→» — лише текст для екранного читача про джокерів.
  await expect(outcomes.first()).toHaveText(/^[01](, \d джокер\S*)?→[01], (не )?влучив$/);
  const scroll = dialog.locator('.sheet__scroll');
  expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  // Кожне «замовив→взяв» зі значком вміщується у свою клітинку, нічого не обрізано.
  for (const outcome of await outcomes.all()) {
    const fits = await outcome.evaluate((el) => {
      const cell = el.closest('td')?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return cell !== undefined && box.left >= cell.left - 0.5 && box.right <= cell.right + 0.5;
    });
    expect(fits).toBe(true);
  }
  // Найширші значення (кружечки за 2 джокери й «−60») теж вміщуються.
  const widest = await dialog
    .locator('tbody tr')
    .first()
    .evaluate((tr) => {
      const outcome = tr.querySelector('.sheet__outcome');
      const bid = outcome?.querySelector('.sheet__bid');
      const points = tr.querySelector('.sheet__cell--points');
      if (!outcome || !bid || !points) return false;
      bid.setAttribute('data-circles', '2');
      points.textContent = '−60';
      const range = document.createRange();
      range.selectNodeContents(points);
      const cell = outcome.closest('td')?.getBoundingClientRect();
      const box = outcome.getBoundingClientRect();
      return (
        cell !== undefined &&
        box.width <= cell.width + 0.5 &&
        range.getBoundingClientRect().width <= points.getBoundingClientRect().width + 0.5
      );
    });
  expect(widest).toBe(true);
});

test('пауза після взятки: видно, хто бере, і всі карти; у новій роздачі стіл чистий (R-9.2)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Ваше імʼя').fill('Оля');
  await page.getByRole('button', { name: 'Створити кімнату' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await page.getByRole('button', { name: 'Додати бота' }).click();
  await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Почати гру' }).click();

  // Перша роздача — 1 карта: замовлення й одна взятка.
  const bidding = page.getByRole('group', { name: 'Ваше замовлення' });
  await bidding.locator('button:enabled').first().click();
  const card = page.locator('.hand__card:enabled').first();
  await card.click();
  await card.click();
  // Джокер спершу питає оголошення.
  if (await page.locator('.joker-dialog').isVisible()) {
    await page.locator('.joker-dialog button').first().click();
  }

  const felt = page.getByRole('region', { name: 'Стіл' });
  // Карти взятки (окремо від відкритої карти-козиря на столі).
  const trick = felt.getByRole('group', { name: 'Взятка' });
  const players = page.getByRole('list', { name: 'Гравці за столом' }).getByRole('listitem');
  await expect(felt.locator('.felt__trick--taken')).toBeVisible();
  await expect(felt).toContainText(/Бере: Бот \d|Ви берете/);
  await expect(trick.getByRole('figure')).toHaveCount(3);
  await expect(felt.locator('.felt__card[data-winner]')).toHaveCount(1);
  // Хто взяв останню взятку — підсвічено й підписано.
  await expect(players.and(page.locator('[data-last-taker]'))).toHaveCount(1);
  await expect(players.and(page.locator('[data-last-taker]'))).toContainText('взяв останню');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Після паузи — друга роздача: замовлення, а на столі нічого з попередньої.
  await expect(page.getByRole('region', { name: 'Роздача' })).toContainText('Роздача 2 з');
  await expect(trick.getByRole('figure')).toHaveCount(0);
  await expect(felt).not.toContainText('Остання взятка');
  await expect(players.and(page.locator('[data-last-taker]'))).toHaveCount(0);
});

/** Колір і розмір кожного значка масті порівняно з текстом поруч. */
async function suitMarks(scope: Locator) {
  return scope.locator('.suit-mark').evaluateAll((marks) =>
    marks.map((mark) => {
      const style = getComputedStyle(mark);
      const parent = getComputedStyle(mark.parentElement as HTMLElement);
      return {
        red: mark.getAttribute('data-color') === 'red',
        color: style.color,
        textColor: parent.color,
        size: style.fontSize,
        textSize: parent.fontSize,
      };
    }),
  );
}

for (const theme of ['light', 'dark'] as const) {
  test(`масті в козирі й таблиці: ♦ ♥ червоні, ♠ ♣ кольору тексту, розміром як текст (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.getByLabel('Ваше імʼя').fill('Оля');
    await page.getByRole('button', { name: 'Створити кімнату' }).click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Додати бота' }).click();
    await expect(page.getByRole('list', { name: 'Гравці' }).getByRole('listitem')).toHaveCount(6);
    await page.getByRole('button', { name: 'Почати гру' }).click();
    await expect(page.getByRole('list', { name: 'Ваші карти' })).toBeVisible();

    const red = theme === 'light' ? 'rgb(198, 40, 40)' : 'rgb(255, 123, 114)';
    const check = (marks: Awaited<ReturnType<typeof suitMarks>>) => {
      for (const mark of marks) {
        expect(mark.color).toBe(mark.red ? red : mark.textColor);
        expect(mark.size).toBe(mark.textSize);
      }
    };
    // Козир (якщо відкрито не джокера).
    check(await suitMarks(page.getByRole('region', { name: 'Роздача' }).locator('.game__trump')));

    // Кути карт: масть того ж розміру, що й ранг.
    const corners = await page
      .locator('.hand .card')
      .first()
      .evaluate((card) => {
        const size = (selector: string) =>
          getComputedStyle(card.querySelector(selector) as Element).fontSize;
        return [size('.card__corner'), size('.card__corner-suit')];
      });
    expect(corners[1]).toBe(corners[0]);

    await page.getByRole('button', { name: 'Таблиця' }).click();
    const dialog = page.getByRole('dialog', { name: 'Таблиця гри' });
    const marks = await suitMarks(dialog.getByRole('table', { name: 'Таблиця гри' }));
    // Поки зіграно лише першу роздачу — у таблиці її рядок (з мастю, якщо є козир).
    check(marks);
    // Легенда: «9♥» — червона масть того ж розміру, що й цифра.
    const legend = await suitMarks(dialog.getByRole('note'));
    expect(legend).toHaveLength(1);
    expect(legend[0]?.red).toBe(true);
    check(legend);
  });
}
