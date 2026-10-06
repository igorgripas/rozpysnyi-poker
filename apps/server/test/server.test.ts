import { parseReplayFile, replay } from '@poker/engine';
import { PROTOCOL_VERSION, playerViewSchema, roomStateSchema } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUG_REPORTS_PER_PLAYER, type BugReport } from '../src/bugReport.js';
import { type PokerServer, type PokerServerOptions, createPokerServer } from '../src/server.js';
import { ABANDONED_TTL_MS, MemoryRoomStore } from '../src/store.js';
import { TestClient } from './client.js';
import { FAST_PLAY, GatedStore, errorCode, testRandom, unwrap } from './support.js';

let server: PokerServer;
let url: string;
const clients: TestClient[] = [];

function client(version?: number): TestClient {
  const created = new TestClient(url, version);
  clients.push(created);
  return created;
}

/** Чекає умову, перевіряючи її кожні кілька мілісекунд. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Не дочекалися умови');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

beforeEach(async () => {
  server = createPokerServer({ random: testRandom(), publicUrl: 'https://poker.test' });
  url = await server.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.close();
});

describe('HTTP', () => {
  it('health check відповідає версією протоколу', async () => {
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, protocolVersion: PROTOCOL_VERSION });
  });
});

describe('підключення', () => {
  it('клієнт іншої версії протоколу отримує відмову versionMismatch', async () => {
    const old = client(PROTOCOL_VERSION + 1);
    const error = await new Promise<Error & { data?: unknown }>((resolve) =>
      old.socket.on('connect_error', resolve),
    );
    expect(error.data).toMatchObject({ code: 'versionMismatch' });
  });

  it('некоректний payload отримує badRequest', async () => {
    const c = client();
    expect(errorCode(await c.request('room:create', { name: '' }))).toBe('badRequest');
    expect(errorCode(await c.request('room:join', { code: '!', name: 'x' } as never))).toBe(
      'badRequest',
    );
  });

  it('дії над кімнатою без сесії — notInRoom', async () => {
    expect(errorCode(await client().request('room:addBot', {}))).toBe('notInRoom');
  });
});

describe('кімната через сокети', () => {
  it('R-9.1: хост створює кімнату, гравець входить за кодом; усі бачать місця в порядку входу', async () => {
    const host = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    expect(session.link).toBe(`https://poker.test/r/${session.code}`);
    await host.until((c) => c.room !== null);
    expect(roomStateSchema.parse(host.room)).toEqual(host.room);

    const guest = client();
    const guestSession = unwrap(
      await guest.request('room:join', { code: session.code, name: 'Петро' }),
    );
    await host.until((c) => c.room?.seats.length === 2);
    await guest.until((c) => c.room?.seats.length === 2);
    expect(guest.room?.you).toBe(guestSession.playerId);
    expect(guest.room?.hostId).toBe(session.playerId);
    expect(host.room?.seats.map((s) => [s.name, s.connected])).toEqual([
      ['Оля', true],
      ['Петро', true],
    ]);

    guest.close();
    await host.until((c) => c.room?.seats[1]?.connected === false);
  });

  it('гравець повертається за токеном з нового підключення', async () => {
    const host = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    host.close();
    const again = client();
    expect(
      unwrap(await again.request('room:resume', { code: session.code, token: session.token })),
    ).toEqual(session);
    await again.until((c) => c.room?.seats[0]?.connected === true);
  });

  it('хост додає ботів, перемішує місця й запускає гру', async () => {
    const host = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:shuffle', {}));
    unwrap(await host.request('room:start', {}));
    await host.until((c) => c.room?.status === 'playing');
    expect(host.room?.seats).toHaveLength(3);
    expect(host.room?.code).toBe(session.code);

    const guest = client();
    expect(errorCode(await guest.request('room:join', { code: session.code, name: 'Петро' }))).toBe(
      'alreadyStarted',
    );
  });
});

describe('ліміти зʼєднання', () => {
  async function restart(options: PokerServerOptions) {
    for (const c of clients.splice(0)) c.close();
    await server.close();
    server = createPokerServer({ random: testRandom(), ...options });
    url = await server.listen({ port: 0, host: '127.0.0.1' });
  }

  it('запитів з одного зʼєднання не більше ліміту за вікно — далі rateLimited', async () => {
    let time = 0;
    await restart({ connectionLimits: { requests: 3, windowMs: 1000 }, now: () => time });
    const c = client();
    unwrap(await c.request('room:create', { name: 'Оля' }));
    unwrap(await c.request('room:addBot', {}));
    unwrap(await c.request('room:addBot', {}));
    expect(errorCode(await c.request('room:shuffle', {}))).toBe('rateLimited');
    // Інше зʼєднання має власний ліміт.
    expect(errorCode(await client().request('room:addBot', {}))).toBe('notInRoom');
    time += 1000;
    unwrap(await c.request('room:shuffle', {}));
  });

  it('кімнат з одного зʼєднання не більше ліміту — далі rateLimited', async () => {
    await restart({ connectionLimits: { rooms: 2 } });
    const c = client();
    unwrap(await c.request('room:create', { name: 'Оля' }));
    unwrap(await c.request('room:create', { name: 'Оля' }));
    expect(errorCode(await c.request('room:create', { name: 'Оля' }))).toBe('rateLimited');
    unwrap(await client().request('room:create', { name: 'Петро' }));
  });

  it('покинута кімната прибирається з памʼяті сервера', async () => {
    let time = 0;
    await restart({ idleTtlMs: 1000, sweepIntervalMs: 10, now: () => time });
    const c = client();
    const session = unwrap(await c.request('room:create', { name: 'Оля' }));
    time = 5000;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.rooms.get(session.code)).toBeDefined();
    c.close();
    await waitFor(() => server.rooms.get(session.code)?.seats[0]?.connected === false);
    time = 6000;
    await waitFor(() => server.rooms.get(session.code) === undefined);
  });
});

describe('гра через сокети', () => {
  it('сервер розсилає viewFor після кожної дії; людина з ботами дограває гру до кінця', async () => {
    await server.close();
    server = createPokerServer({
      random: testRandom(4),
      botDelayMs: 0,
      trickPauseMs: 0,
      ...FAST_PLAY,
    });
    url = await server.listen({ port: 0, host: '127.0.0.1' });

    const host = client();
    const guest = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    unwrap(await guest.request('room:join', { code: session.code, name: 'Петро' }));
    unwrap(await host.request('room:addBot', {}));
    expect(errorCode(await host.request('game:bid', { bid: 0 }))).toBe('notStarted');
    unwrap(await host.request('room:start', {}));

    await host.until((c) => c.view !== null);
    await guest.until((c) => c.view !== null);
    expect(host.view?.seat).not.toBe(guest.view?.seat);
    expect(playerViewSchema.parse(host.view)).toEqual(host.view);

    const players = [host, guest];
    const finished = () => players.every((c) => c.room?.status === 'finished');
    while (!finished()) {
      await waitFor(
        () => finished() || players.some((c) => (c.view?.legalActions.length ?? 0) > 0),
      );
      for (const c of players) {
        const action = c.view?.legalActions[0];
        if (action === undefined) continue;
        c.view = null;
        const result =
          action.type === 'bid'
            ? await c.request('game:bid', { bid: action.bid })
            : await c.request('game:play', {
                card: action.card,
                ...(action.call !== undefined && { call: action.call }),
              });
        unwrap(result);
      }
    }
    expect(host.view?.status ?? 'finished').toBe('finished');
  }, 60_000);
});

describe('перепідключення й рестарт (R-9.3)', () => {
  it('R-9.3: сервер переживає рестарт посеред гри; гравець повертається за токеном і бачить свою руку', async () => {
    const store = new MemoryRoomStore();
    await server.close();
    server = createPokerServer({
      random: testRandom(4),
      store,
      botDelayMs: 0,
      trickPauseMs: 0,
      ...FAST_PLAY,
    });
    url = await server.listen({ port: 0, host: '127.0.0.1' });

    const host = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:start', {}));
    await host.until((c) => (c.view?.legalActions.length ?? 0) > 0);
    const view = host.view;
    host.close();

    await server.close();
    server = createPokerServer({
      random: testRandom(5),
      store,
      botDelayMs: 0,
      trickPauseMs: 0,
      ...FAST_PLAY,
    });
    url = await server.listen({ port: 0, host: '127.0.0.1' });

    const again = client();
    expect(
      unwrap(await again.request('room:resume', { code: session.code, token: session.token })),
    ).toEqual(session);
    await again.until((c) => c.view !== null && c.room?.seats[0]?.connected === true);
    expect(again.view).toEqual(view);
    const action = again.view?.legalActions[0];
    expect(action?.type).toBe('bid');
    unwrap(await again.request('game:bid', { bid: action?.type === 'bid' ? action.bid : 0 }));
  });

  it('R-10.1: хост вмикає опції кімнати, гості бачать їх у стані кімнати', async () => {
    const host = client();
    const guest = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    unwrap(await guest.request('room:join', { code: session.code, name: 'Петро' }));
    await guest.until((c) => c.room?.seats.length === 2);
    expect(guest.room?.options).toEqual({ dark: false, zeroLimit: false });
    const on = { dark: true, zeroLimit: true };
    expect(errorCode(await guest.request('room:options', on))).toBe('notHost');
    expect(errorCode(await host.request('room:options', { dark: true } as never))).toBe(
      'badRequest',
    );
    unwrap(await host.request('room:options', on));
    await guest.until((c) => c.room?.options.dark === true);
    expect(guest.room?.options).toEqual(on);
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:start', {}));
    await guest.until((c) => c.view !== null);
    expect(guest.view?.options).toEqual(on);
    expect(errorCode(await host.request('room:options', on))).toBe('alreadyStarted');
  });

  it('R-9.3: хост налаштовує таймер і віддає боту місце відключеного гравця', async () => {
    const host = client();
    const guest = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    unwrap(await guest.request('room:join', { code: session.code, name: 'Петро' }));
    expect(errorCode(await guest.request('room:settings', { turnTimerSec: 30 }))).toBe('notHost');
    unwrap(await host.request('room:settings', { turnTimerSec: 30 }));
    await guest.until((c) => c.room?.turnTimerSec === 30);
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:start', {}));
    await host.until((c) => c.room?.turnDeadline !== null);

    expect(errorCode(await host.request('room:replaceWithBot', { seat: 1 }))).toBe(
      'playerConnected',
    );
    guest.close();
    await host.until((c) => c.room?.seats[1]?.connected === false);
    unwrap(await host.request('room:replaceWithBot', { seat: 1 }));
    await host.until((c) => c.room?.seats[1]?.kind === 'bot');
  });
});

describe('сховище кімнат (T54)', () => {
  const stores: GatedStore[] = [];

  async function restartWith(store: GatedStore): Promise<void> {
    if (!stores.includes(store)) stores.push(store);
    await server.close();
    server = createPokerServer({
      random: testRandom(6),
      store,
      botDelayMs: 0,
      trickPauseMs: 0,
      ...FAST_PLAY,
    });
    url = await server.listen({ port: 0, host: '127.0.0.1' });
  }

  afterEach(() => {
    // Інакше зупинка сервера чекала б записів, які тест так і не пропустив.
    for (const store of stores.splice(0)) store.open();
  });

  /** Пропускає записи по одному, доки запит не отримає відповідь. */
  async function drain<T>(store: GatedStore, pending: Promise<T>): Promise<T> {
    let done = false;
    void pending.finally(() => (done = true));
    while (!done) {
      store.release();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return pending;
  }

  /** Запит, який памʼятає, чи вже прийшла відповідь. */
  function tracked<T>(pending: Promise<T>): { promise: Promise<T>; acked: () => boolean } {
    let acked = false;
    const promise = pending.then((result) => {
      acked = true;
      return result;
    });
    return { promise, acked: () => acked };
  }

  it('дія підтверджується клієнту лише після запису в сховище', async () => {
    const store = new GatedStore();
    await restartWith(store);
    const host = client();
    const creating = tracked(host.request('room:create', { name: 'Оля' }));
    await waitFor(() => store.waiting === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(creating.acked()).toBe(false);
    const session = unwrap(await drain(store, creating.promise));
    expect(await store.load(session.code)).not.toBeNull();

    const adding = tracked(host.request('room:addBot', {}));
    await waitFor(() => store.waiting === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(adding.acked()).toBe(false);
    // Інші гравці теж бачать зміну лише після запису.
    expect(host.room?.seats).toHaveLength(1);
    unwrap(await drain(store, adding.promise));
    expect((await store.load(session.code))?.seats).toHaveLength(2);
    await host.until((c) => c.room?.seats.length === 2);
  });

  it('невдалий запис у сховище — клієнт отримує помилку unavailable', async () => {
    const store = new GatedStore();
    await restartWith(store);
    const host = client();
    unwrap(await drain(store, host.request('room:create', { name: 'Оля' })));
    store.fail = true;
    expect(errorCode(await drain(store, host.request('room:addBot', {})))).toBe('unavailable');
  });

  it('після рестарту кімната підвантажується зі сховища за кодом і для входу нового гравця', async () => {
    const store = new GatedStore();
    store.gated = false;
    await restartWith(store);
    const host = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    host.close();
    await restartWith(store);
    expect(server.rooms.get(session.code)).toBeUndefined();

    const guest = client();
    unwrap(await guest.request('room:join', { code: session.code.toLowerCase(), name: 'Петро' }));
    await guest.until((c) => c.room?.seats.length === 2);
    expect(guest.room?.seats.map((m) => m.name)).toEqual(['Оля', 'Петро']);
  });
});

describe('зупинка сервера (T55)', () => {
  it('на зупинці сервер перестає приймати дії, дописує все в базу й попереджає клієнтів', async () => {
    const store = new GatedStore();
    store.gated = false;
    await server.close();
    server = createPokerServer({
      random: testRandom(7),
      store,
      botDelayMs: 0,
      trickPauseMs: 0,
      ...FAST_PLAY,
    });
    url = await server.listen({ port: 0, host: '127.0.0.1' });
    const host = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));

    // Дія прийнята до зупинки, але ще не записана.
    store.gated = true;
    const adding = host.request('room:addBot', {});
    await waitFor(() => store.waiting === 1);
    const closing = server.close();
    // Нові дії вже не приймаються.
    expect(errorCode(await host.request('room:addBot', {}))).toBe('unavailable');
    // Нові підключення теж: клієнт чекатиме на новий процес.
    const late = new TestClient(url);
    clients.push(late);
    const refused = await new Promise<unknown>((resolve) => {
      late.socket.on('connect_error', (error) => resolve((error as { data?: unknown }).data));
      late.socket.on('connect', () => resolve('connected'));
    });
    expect(refused).toEqual({ code: 'unavailable' });
    expect(host.restarting).toBe(false);
    store.open();
    // Прийнята дія дописується й підтверджується.
    unwrap(await adding);
    await host.until((c) => c.restarting);
    await closing;
    expect((await store.load(session.code))?.seats.map((m) => m.kind)).toEqual(['human', 'bot']);
    // Закритий сервер можна закрити ще раз (afterEach).
  });
});

describe('звіт про баг (T52)', () => {
  /** Перезапускає сервер із підробленим репортером, що памʼятає створені issues. */
  async function withReporter({
    fail = false,
    ...options
  }: { fail?: boolean } & PokerServerOptions = {}) {
    const reports: BugReport[] = [];
    await server.close();
    server = createPokerServer({
      random: testRandom(4),
      botDelayMs: 0,
      trickPauseMs: 0,
      bugReportLimits: { perHour: 100, perIpPerHour: 100 },
      ...FAST_PLAY,
      ...options,
      bugReporter: {
        async report(report) {
          if (fail) throw new Error('GitHub недоступний');
          reports.push(report);
          return { url: `https://github.com/o/r/issues/${reports.length}` };
        },
      },
    });
    url = await server.listen({ port: 0, host: '127.0.0.1' });
    return reports;
  }

  /** Кімната хоста з двома ботами, гра почалася. */
  async function startWithBots() {
    const host = client();
    unwrap(await host.request('room:create', { name: 'Оля' }));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:start', {}));
    await host.until((c) => (c.view?.legalActions.length ?? 0) > 0);
    return host;
  }

  /** Хост ходить першою легальною дією, доки гра не завершиться. */
  async function playToEnd(host: TestClient) {
    const finished = () => host.room?.status === 'finished';
    while (!finished()) {
      await waitFor(() => finished() || (host.view?.legalActions.length ?? 0) > 0);
      const action = host.view?.legalActions[0];
      if (action === undefined) continue;
      host.view = null;
      unwrap(
        action.type === 'bid'
          ? await host.request('game:bid', { bid: action.bid })
          : await host.request('game:play', {
              card: action.card,
              ...(action.call !== undefined && { call: action.call }),
            }),
      );
    }
  }

  it('AUTOPILOT §6: звіт посеред гри не публікується до її кінця — інакше seed розкрив би чужі карти', async () => {
    const reports = await withReporter();
    const host = client();
    unwrap(await host.request('room:create', { name: 'Оля' }));
    expect(errorCode(await host.request('game:reportBug', { description: 'баг' }))).toBe(
      'notStarted',
    );
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:start', {}));
    await host.until((c) => (c.view?.legalActions.length ?? 0) > 0);
    const code = host.room?.code ?? '';
    const reportedAt = server.rooms.get(code)?.game?.actions.length;

    // Посилання немає: issue ще не створено.
    expect(unwrap(await host.request('game:reportBug', { description: 'Не той козир' }))).toEqual({
      url: null,
    });
    expect(reports).toHaveLength(0);

    await playToEnd(host);
    await waitFor(() => reports.length === 1);
    const report = reports[0];
    expect(report?.body).toContain('Не той козир');
    expect(report?.body).toContain(`дій у лозі на момент звіту: ${reportedAt}`);
    const file = parseReplayFile(report?.body ?? '');
    const game = server.rooms.get(code)?.game;
    expect(game?.status).toBe('finished');
    expect(replay(file.seed, file.log)).toEqual(game);
  }, 60_000);

  it('AUTOPILOT §6: після завершення гри звіт публікується одразу й гравець отримує посилання', async () => {
    const reports = await withReporter();
    const host = await startWithBots();
    await playToEnd(host);
    expect(
      unwrap(await host.request('game:reportBug', { description: 'Не той підсумок' })),
    ).toEqual({ url: 'https://github.com/o/r/issues/1' });
    expect(reports).toHaveLength(1);
    const file = parseReplayFile(reports[0]?.body ?? '');
    expect(replay(file.seed, file.log)).toEqual(server.rooms.get(host.room?.code ?? '')?.game);
  }, 60_000);

  it('звітів від одного гравця не більше ліміту — далі rateLimited', async () => {
    const reports = await withReporter();
    const host = await startWithBots();
    // Відкладені звіти (гра ще йде) теж рахуються.
    for (let i = 0; i < BUG_REPORTS_PER_PLAYER; i++) {
      unwrap(await host.request('game:reportBug', { description: `баг ${i}` }));
    }
    expect(errorCode(await host.request('game:reportBug', { description: 'ще' }))).toBe(
      'rateLimited',
    );
    await playToEnd(host);
    await waitFor(() => reports.length === BUG_REPORTS_PER_PLAYER);
    expect(errorCode(await host.request('game:reportBug', { description: 'ще' }))).toBe(
      'rateLimited',
    );
    expect(reports).toHaveLength(BUG_REPORTS_PER_PLAYER);
  });

  it('без налаштованого репортера чи при збої GitHub — unavailable', async () => {
    const host = client();
    unwrap(await host.request('room:create', { name: 'Оля' }));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:start', {}));
    expect(errorCode(await host.request('game:reportBug', { description: 'баг' }))).toBe(
      'unavailable',
    );

    // Після гри звіт публікується одразу: збій GitHub видно гравцеві.
    await withReporter({ fail: true });
    const again = await startWithBots();
    await playToEnd(again);
    expect(errorCode(await again.request('game:reportBug', { description: 'баг' }))).toBe(
      'unavailable',
    );
  }, 60_000);

  it('AUTOPILOT §6: звіт посеред гри переживає перезапуск сервера з тим самим сховищем', async () => {
    const store = new MemoryRoomStore();
    await withReporter({ store });
    const host = await startWithBots();
    const code = host.room?.code ?? '';
    const reportedAt = server.rooms.get(code)?.game?.actions.length;
    const { id, token } = server.rooms.get(code)?.seats[0] ?? { id: '', token: null };
    unwrap(await host.request('game:reportBug', { description: 'Не той козир' }));
    host.close();

    const reports = await withReporter({ store });
    expect(reports).toHaveLength(0);
    const again = client();
    unwrap(await again.request('room:resume', { code, token: token ?? '' }));
    await playToEnd(again);
    await waitFor(() => reports.length === 1);
    expect(reports[0]?.body).toContain('Не той козир');
    expect(reports[0]?.body).toContain(`дій у лозі на момент звіту: ${reportedAt}`);
    const file = parseReplayFile(reports[0]?.body ?? '');
    expect(replay(file.seed, file.log)).toEqual(server.rooms.get(code)?.game);
    // Ліміт гравця теж пережив рестарт, а опублікований звіт прибрано з черги.
    await server.rooms.persisted(code);
    const snapshot = await store.load(code);
    expect(snapshot?.bugReports).toEqual([]);
    expect(snapshot?.bugReportsSent).toEqual({ [id]: 1 });
  }, 60_000);

  it('AUTOPILOT §6: звіт із покинутої гри публікується під час очищення', async () => {
    let time = Date.now();
    const store = new MemoryRoomStore(() => time);
    await withReporter({ store, cleanupIntervalMs: 20 });
    const host = await startWithBots();
    const code = host.room?.code ?? '';
    const game = server.rooms.get(code)?.game;
    unwrap(await host.request('game:reportBug', { description: 'Гра зависла' }));
    host.close();
    const reports = await withReporter({ store, cleanupIntervalMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Гру ще можуть продовжити: seed не публікується.
    expect(reports).toHaveLength(0);

    time += ABANDONED_TTL_MS + 1;
    await waitFor(() => reports.length === 1);
    const file = parseReplayFile(reports[0]?.body ?? '');
    expect(replay(file.seed, file.log)).toEqual(game);
    expect(reports[0]?.body).toContain('Гра зависла');
    expect((await store.load(code))?.bugReports).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reports).toHaveLength(1);
  }, 60_000);

  it('AUTOPILOT §6: глобальний ліміт звітів на сервер і на IP-адресу — rateLimited', async () => {
    let time = 0;
    const reports = await withReporter({
      bugReportLimits: { perHour: 2, perIpPerHour: 100 },
      now: () => time,
    });
    // Кожна нова кімната дає новий ліміт гравця, але не обходить ліміт сервера.
    for (let i = 0; i < 2; i++) {
      const host = await startWithBots();
      unwrap(await host.request('game:reportBug', { description: `баг ${i}` }));
    }
    const third = await startWithBots();
    expect(errorCode(await third.request('game:reportBug', { description: 'ще' }))).toBe(
      'rateLimited',
    );
    time += 60 * 60 * 1000 + 1;
    unwrap(await third.request('game:reportBug', { description: 'через годину' }));
    expect(reports).toHaveLength(0);

    await withReporter({
      bugReportLimits: { perHour: 100, perIpPerHour: 1 },
      trustProxy: true,
      now: () => time,
    });
    const first = await startWithBots();
    unwrap(await first.request('game:reportBug', { description: 'баг' }));
    const sameIp = await startWithBots();
    expect(errorCode(await sameIp.request('game:reportBug', { description: 'баг' }))).toBe(
      'rateLimited',
    );
    // За проксі IP — останній запис X-Forwarded-For; підробити його клієнт не може.
    const spoofed = new TestClient(url, undefined, { 'x-forwarded-for': '1.2.3.4, 127.0.0.1' });
    clients.push(spoofed);
    unwrap(await spoofed.request('room:create', { name: 'Оля' }));
    unwrap(await spoofed.request('room:addBot', {}));
    unwrap(await spoofed.request('room:addBot', {}));
    unwrap(await spoofed.request('room:start', {}));
    expect(errorCode(await spoofed.request('game:reportBug', { description: 'баг' }))).toBe(
      'rateLimited',
    );
    const other = new TestClient(url, undefined, { 'x-forwarded-for': '1.2.3.4' });
    clients.push(other);
    unwrap(await other.request('room:create', { name: 'Оля' }));
    unwrap(await other.request('room:addBot', {}));
    unwrap(await other.request('room:addBot', {}));
    unwrap(await other.request('room:start', {}));
    unwrap(await other.request('game:reportBug', { description: 'баг' }));
  }, 60_000);
});
