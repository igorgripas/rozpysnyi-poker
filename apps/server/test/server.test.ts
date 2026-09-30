import { PROTOCOL_VERSION, playerViewSchema, roomStateSchema } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PokerServer, createPokerServer } from '../src/server.js';
import { MemoryRoomStore } from '../src/store.js';
import { TestClient } from './client.js';
import { errorCode, testRandom, unwrap } from './support.js';

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
