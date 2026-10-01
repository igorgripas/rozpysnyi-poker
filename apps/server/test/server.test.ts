import { PROTOCOL_VERSION, playerViewSchema, roomStateSchema } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PokerServer, createPokerServer } from '../src/server.js';
import { MemoryRoomStore } from '../src/store.js';
import { TestClient } from './client.js';
import { GatedStore, errorCode, testRandom, unwrap } from './support.js';

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

describe('гра через сокети', () => {
  it('сервер розсилає viewFor після кожної дії; людина з ботами дограває гру до кінця', async () => {
    await server.close();
    server = createPokerServer({ random: testRandom(4), botDelayMs: 0, trickPauseMs: 0 });
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
    server = createPokerServer({ random: testRandom(4), store, botDelayMs: 0, trickPauseMs: 0 });
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
    server = createPokerServer({ random: testRandom(5), store, botDelayMs: 0, trickPauseMs: 0 });
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
    server = createPokerServer({ random: testRandom(6), store, botDelayMs: 0, trickPauseMs: 0 });
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
    server = createPokerServer({ random: testRandom(7), store, botDelayMs: 0, trickPauseMs: 0 });
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
