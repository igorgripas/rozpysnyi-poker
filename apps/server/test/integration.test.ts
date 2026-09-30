// Інтеграційні тести сервера (AUTOPILOT §5 п.5): справжній сервер і кілька віртуальних
// клієнтів через WebSocket — кімната, гра, перепідключення, рестарт сервера посеред гри.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GameState, gameLog, replay, viewFor } from '@poker/engine';
import { type Session, playerViewSchema, roomStateSchema } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PokerServer, type PokerServerOptions, createPokerServer } from '../src/server.js';
import { FileRoomStore } from '../src/store.js';
import { TestClient } from './client.js';
import { testRandom, unwrap } from './support.js';

const TIMEOUT = 60_000;

let server: PokerServer | null = null;
let url = '';
const clients: TestClient[] = [];

async function start(options: PokerServerOptions = {}): Promise<void> {
  server = createPokerServer({ random: testRandom(11), botDelayMs: 0, ...options });
  url = await server.listen({ port: 0, host: '127.0.0.1' });
}

async function stop(): Promise<void> {
  await server?.close();
  server = null;
}

function client(): TestClient {
  const created = new TestClient(url);
  clients.push(created);
  return created;
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await stop();
});

/** Хост створює кімнату, гості входять за кодом, хост додає `bots` ботів. */
async function lobby(names: string[], bots = 0) {
  const players = names.map(() => client());
  const sessions: Session[] = [];
  for (const [i, name] of names.entries()) {
    const c = players[i] as TestClient;
    sessions.push(
      unwrap(
        i === 0
          ? await c.request('room:create', { name })
          : await c.request('room:join', { code: (sessions[0] as Session).code, name }),
      ),
    );
  }
  const host = players[0] as TestClient;
  for (let i = 0; i < bots; i++) unwrap(await host.request('room:addBot', {}));
  const seats = names.length + bots;
  for (const c of players) await c.until((x) => x.room?.seats.length === seats);
  return { players, sessions, host, code: (sessions[0] as Session).code };
}

/** Людина робить перший легальний хід зі свого погляду; `false`, якщо зараз не її хід. */
async function move(c: TestClient): Promise<boolean> {
  const action = c.view?.legalActions[0];
  if (action === undefined) return false;
  c.view = null;
  unwrap(
    action.type === 'bid'
      ? await c.request('game:bid', { bid: action.bid })
      : await c.request('game:play', {
          card: action.card,
          ...(action.call !== undefined && { call: action.call }),
        }),
  );
  return true;
}

/** Чекає, доки хтось із клієнтів отримає хід або виконається `stop`. */
async function nextTurn(players: TestClient[], stop: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!stop() && !players.some((c) => (c.view?.legalActions.length ?? 0) > 0)) {
    if (Date.now() > deadline) throw new Error('Ніхто не отримав хід');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Клієнти грають, доки не виконається `stop` (за замовчуванням — кінець гри). */
async function play(
  players: TestClient[],
  stop: () => boolean = () => players.every((c) => c.room?.status === 'finished'),
): Promise<void> {
  while (!stop()) {
    await nextTurn(players, stop);
    for (const c of players) if (!stop()) await move(c);
  }
}

function game(code: string): GameState {
  return server?.rooms.get(code)?.game as GameState;
}

/** Гра завершена, а її лог відтворює той самий стан (R-2.3). */
function expectFinishedReplayable(code: string): void {
  const state = game(code);
  expect(state.status).toBe('finished');
  expect(replay(state.seed, gameLog(state))).toEqual(state);
}

describe('кімната', () => {
  it('R-9.1: троє клієнтів збирають кімнату; усі бачать однаковий порядок місць після перемішування', async () => {
    const { players, host, sessions } = await lobby(['Оля', 'Петро', 'Марта'], 1);
    unwrap(await host.request('room:shuffle', {}));
    unwrap(await host.request('room:start', {}));
    for (const c of players) await c.until((x) => x.room?.status === 'playing' && x.view !== null);

    const order = host.room?.seats.map((s) => s.id);
    for (const [i, c] of players.entries()) {
      expect(roomStateSchema.parse(c.room)).toEqual(c.room);
      expect(c.room?.seats.map((s) => s.id)).toEqual(order);
      expect(c.room?.you).toBe(sessions[i]?.playerId);
      // Кожен бачить лише власну руку: місце з погляду збігається з місцем у кімнаті.
      expect(c.view?.seat).toBe(order?.indexOf(sessions[i]?.playerId as string));
      expect(playerViewSchema.parse(c.view)).toEqual(c.view);
    }
    const hands = players.map((c) => JSON.stringify(c.view?.hand));
    expect(new Set(hands).size).toBe(players.length);
  });
});

describe('гра', () => {
  it(
    'троє людей і бот дограють гру до кінця; таблиця однакова в усіх, лог відтворює стан',
    async () => {
      const { players, code } = await lobby(['Оля', 'Петро', 'Марта'], 1);
      unwrap(await (players[0] as TestClient).request('room:start', {}));
      await play(players);
      expectFinishedReplayable(code);
      for (const c of players) await c.until((x) => x.view?.status === 'finished');
      const table = players[0]?.view?.table;
      for (const c of players) expect(c.view?.table).toEqual(table);
    },
    TIMEOUT,
  );
});

describe('перепідключення', () => {
  it(
    'R-9.3: відключений гравець чекає на своє місце: гра стоїть, доки він не повернеться за токеном',
    async () => {
      const { players, sessions, code } = await lobby(['Оля', 'Петро', 'Марта']);
      unwrap(await (players[0] as TestClient).request('room:start', {}));
      await play(players, () => game(code).actions.length >= 10);

      // Відключається той, чия черга ходити.
      const turn = game(code).turn as number;
      const leaving = players[turn] as TestClient;
      const others = players.filter((c) => c !== leaving);
      leaving.close();
      for (const c of others) await c.until((x) => x.room?.seats[turn]?.connected === false);
      const actions = game(code).actions.length;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(game(code).actions.length).toBe(actions);

      const back = client();
      const session = sessions[turn] as Session;
      expect(unwrap(await back.request('room:resume', { code, token: session.token }))).toEqual(
        session,
      );
      await back.until((x) => x.view?.seat === turn && x.view.legalActions.length > 0);
      for (const c of others) await c.until((x) => x.room?.seats[turn]?.connected === true);
      players[turn] = back;
      await play(players);
      expectFinishedReplayable(code);
    },
    TIMEOUT,
  );

  it('гравець з двох вкладок: закриття однієї не робить його відключеним', async () => {
    const { players, sessions, code } = await lobby(['Оля', 'Петро']);
    const second = client();
    unwrap(await second.request('room:resume', { code, token: sessions[1]?.token as string }));
    await second.until((x) => x.room?.seats.length === 2);
    (players[1] as TestClient).close();
    unwrap(await (players[0] as TestClient).request('room:addBot', {}));
    // Стан після додавання бота отримано, а Петро досі підключений через другу вкладку.
    await (players[0] as TestClient).until((x) => x.room?.seats.length === 3);
    await second.until((x) => x.room?.seats.length === 3);
    expect(players[0]?.room?.seats[1]?.connected).toBe(true);
    expect(second.view).toBeNull();
  });
});

describe('рестарт сервера', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'poker-it-'));
  });

  afterEach(async () => {
    // Спершу зупиняємо сервер: інакше він писатиме знімки у вже видалений каталог.
    for (const c of clients.splice(0)) c.close();
    await stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    'R-9.3: сервер із FileRoomStore падає посеред гри; після старту гравці повертаються за токенами й дограють',
    async () => {
      await stop();
      await start({ store: new FileRoomStore(dir) });
      const { players, sessions, code } = await lobby(['Оля', 'Петро', 'Марта'], 1);
      unwrap(await (players[0] as TestClient).request('room:start', {}));
      await play(players, () => game(code).actions.length >= 25);
      const rooms = server?.rooms;
      for (const c of players) c.close();
      await stop();
      // Зупинений сервер більше не ходить ботами: це останній збережений стан.
      const before = rooms?.get(code)?.game as GameState;

      // Новий процес: інший порт, інший генератор, стан — лише з диска.
      await start({ store: new FileRoomStore(dir), random: testRandom(99) });
      expect(game(code)).toEqual(before);
      const seats = server?.rooms.get(code)?.seats.map((m) => m.id) ?? [];
      const back = sessions.map(() => client());
      for (const [i, c] of back.entries()) {
        const session = sessions[i] as Session;
        expect(unwrap(await c.request('room:resume', { code, token: session.token }))).toEqual(
          session,
        );
      }
      for (const [i, c] of back.entries()) {
        await c.until((x) => x.view !== null);
        // Кожен бачить свою руку й стіл такими, якими вони були до рестарту.
        const seat = seats.indexOf(sessions[i]?.playerId as string);
        expect(c.view).toEqual(JSON.parse(JSON.stringify(viewFor(before, seat))));
      }
      await play(back);
      expectFinishedReplayable(code);
    },
    TIMEOUT,
  );
});

describe('передача місця боту й таймер ходу', () => {
  it(
    'R-9.3: гравець пішов, хост віддає його місце боту — гра доходить до кінця',
    async () => {
      const { players, code } = await lobby(['Оля', 'Петро', 'Марта']);
      const host = players[0] as TestClient;
      unwrap(await host.request('room:start', {}));
      await play(players, () => game(code).actions.length >= 5);
      (players[2] as TestClient).close();
      await host.until((x) => x.room?.seats[2]?.connected === false);
      unwrap(await host.request('room:replaceWithBot', { seat: 2 }));
      await host.until((x) => x.room?.seats[2]?.kind === 'bot');
      await play(players.slice(0, 2), () => host.room?.status === 'finished');
      expectFinishedReplayable(code);
    },
    TIMEOUT,
  );

  it(
    'R-9.3: з таймером ходу сервер ходить за гравця, який мовчить; клієнти бачать дедлайн',
    async () => {
      const { players, code } = await lobby(['Оля', 'Петро', 'Марта']);
      const host = players[0] as TestClient;
      unwrap(await host.request('room:settings', { turnTimerSec: 5 }));
      unwrap(await host.request('room:start', {}));
      await host.until((x) => x.room?.turnDeadline !== null);
      const deadline = host.room?.turnDeadline as number;
      expect(deadline).toBeGreaterThan(Date.now());
      expect(deadline).toBeLessThanOrEqual(Date.now() + 5_000);
      const turn = game(code).turn;
      // Ніхто не ходить: після дедлайну хід робить сервер, і відлік починається заново.
      await host.until((x) => (x.room?.turnDeadline ?? 0) > deadline, 8_000);
      expect(game(code).actions).toHaveLength(1);
      expect(game(code).actions[0]?.seat).toBe(turn);
    },
    TIMEOUT,
  );
});
