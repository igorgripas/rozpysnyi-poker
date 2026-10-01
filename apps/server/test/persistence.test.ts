import {
  type Action,
  ENGINE_LOG_VERSION,
  type GameLog,
  type GameState,
  gameLog,
  replay,
} from '@poker/engine';
import { roomStateSchema } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresRoomStore } from '../src/postgres.js';
import { RoomManager } from '../src/rooms.js';
import { MemoryRoomStore, type RoomSnapshot, type RoomStore } from '../src/store.js';
import { freshDatabase } from './db.js';
import { GatedStore, errorCode, settle, testRandom, unwrap } from './support.js';

const DELAY = 500;
const PAUSE = 2000;

function manager(store: RoomStore, seed = 1) {
  return new RoomManager({
    random: testRandom(seed),
    botDelayMs: DELAY,
    trickPauseMs: PAUSE,
    store,
  });
}

/** Кімната з людьми й ботами; гру запущено. */
async function startedRoom(rooms: RoomManager, humans: number, bots: number) {
  const host = unwrap(await rooms.create('Гравець 0'));
  const players = [host];
  for (let i = 1; i < humans; i++) players.push(unwrap(rooms.join(host.code, `Гравець ${i}`)));
  for (let i = 0; i < bots; i++) unwrap(rooms.addBot(host.code, host.playerId));
  unwrap(rooms.start(host.code, host.playerId));
  return { code: host.code, players };
}

function send(rooms: RoomManager, code: string, playerId: string, action: Action) {
  if (action.type === 'bid') return rooms.bid(code, playerId, action.bid);
  return rooms.play(code, playerId, action.card, action.call);
}

/** Робить `count` ходів людьми (перший легальний хід того, чия черга). */
function playHumans(rooms: RoomManager, code: string, count: number) {
  for (let i = 0; i < count; i++) {
    const room = rooms.get(code);
    const member = room?.seats[room.game?.turn as number];
    const view = rooms.view(code, member?.id as string);
    unwrap(send(rooms, code, member?.id as string, view?.legalActions[0] as Action));
  }
}

function actions(rooms: RoomManager, code: string): number {
  return rooms.get(code)?.game?.actions.length as number;
}

/** «Зупинка процесу»: дописати все у сховище й скасувати таймери. */
async function shutdown(rooms: RoomManager): Promise<void> {
  await rooms.flush();
  rooms.close();
}

const STORES: [string, () => Promise<RoomStore>][] = [
  ['MemoryRoomStore', () => Promise.resolve(new MemoryRoomStore())],
  [
    'PostgresRoomStore',
    async () => {
      const store = new PostgresRoomStore({ connectionString: await freshDatabase() });
      opened.push(store);
      return store;
    },
  ],
];
const opened: PostgresRoomStore[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const store of opened.splice(0)) await store.close();
});

describe.each(STORES)('персистентність: %s', (_name, makeStore) => {
  let store: RoomStore;

  beforeEach(async () => {
    store = await makeStore();
    await store.init();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  it('R-9.3: після рестарту посеред гри стан, місця й таблиця ті самі; гравці чекають на перепідключення', async () => {
    const before = manager(store);
    const { code, players } = await startedRoom(before, 3, 0);
    for (const p of players) before.setConnected(code, p.playerId, true);
    playHumans(before, code, 7);
    const game = before.get(code)?.game as GameState;
    await shutdown(before);

    const after = manager(store, 2);
    // Новий процес нічого не тримає в памʼяті: кімната підвантажується за кодом.
    expect(after.get(code)).toBeUndefined();
    const room = await after.load(code);
    expect(room?.game).toEqual(game);
    expect(room?.status).toBe('playing');
    expect(room?.hostId).toBe(players[0]?.playerId);
    expect(room?.seats.map((m) => [m.id, m.connected])).toEqual(
      players.map((p) => [p.playerId, false]),
    );
    const state = after.roomState(code, players[1]?.playerId as string);
    expect(roomStateSchema.parse(state)).toEqual(state);
    expect(await after.load('ZZZZZ')).toBeUndefined();
  });

  it('R-9.3: після рестарту гравець повертається за токеном і гра продовжується до кінця', async () => {
    const before = manager(store);
    const { code, players } = await startedRoom(before, 3, 0);
    playHumans(before, code, 5);
    await shutdown(before);

    const after = manager(store, 2);
    await after.load(code);
    for (const p of players) expect(unwrap(after.resume(code, p.token))).toEqual(p);
    expect(errorCode(after.resume(code, 'x'.repeat(32)))).toBe('badToken');
    while (after.get(code)?.status !== 'finished') playHumans(after, code, 1);
    const game = after.get(code)?.game as GameState;
    expect(replay(game.seed, gameLog(game))).toEqual(game);
    await shutdown(after);

    // Завершена гра теж переживає рестарт.
    expect((await manager(store, 3).load(code))?.status).toBe('finished');
  });

  it('після рестарту боти продовжують ходити', async () => {
    const before = manager(store);
    const { code } = await startedRoom(before, 1, 2);
    await shutdown(before);
    // Зупинений менеджер більше не ходить ботами.
    const stopped = actions(before, code);
    vi.advanceTimersByTime(DELAY * 10);
    expect(actions(before, code)).toBe(stopped);

    const after = manager(store, 2);
    await after.load(code);
    const turn = after.get(code)?.game?.turn as number;
    if (after.get(code)?.seats[turn]?.kind === 'human') playHumans(after, code, 1);
    const count = actions(after, code);
    vi.advanceTimersByTime(DELAY);
    expect(actions(after, code)).toBe(count + 1);
    after.close();
  });

  it('після рестарту одразу після взятки бот витримує паузу взятки', async () => {
    const before = manager(store);
    const { code, players } = await startedRoom(before, 1, 2);
    const host = players[0]?.playerId as string;
    const game = () => before.get(code)?.game as GameState;
    // Доходимо до моменту, коли взятку щойно завершено, а наступним ходить бот.
    let steps = 0;
    for (;;) {
      expect(++steps).toBeLessThan(5000);
      const g = game();
      const last = g.actions.at(-1);
      const next = g.turn;
      if (
        last?.type === 'play' &&
        g.hand.trick.length === 0 &&
        next !== null &&
        before.get(code)?.seats[next]?.kind === 'bot'
      ) {
        break;
      }
      const view = before.view(code, host);
      if (view?.legalActions.length) {
        unwrap(send(before, code, host, view.legalActions[0] as Action));
      } else vi.advanceTimersByTime(1);
    }
    await shutdown(before);

    const after = manager(store, 2);
    await after.load(code);
    const count = actions(after, code);
    vi.advanceTimersByTime(PAUSE - 1);
    expect(actions(after, code)).toBe(count);
    vi.advanceTimersByTime(1);
    expect(actions(after, code)).toBe(count + 1);
    after.close();
  });

  it('кімната в лобі теж переживає рестарт: можна входити й запускати гру', async () => {
    const host = unwrap(await manager(store).create('Оля'));
    await settle();
    const after = manager(store, 2);
    await after.load(host.code);
    unwrap(after.join(host.code, 'Петро'));
    unwrap(after.addBot(host.code, host.playerId));
    unwrap(after.start(host.code, host.playerId));
    expect(after.get(host.code)?.seats.map((m) => m.name)).toEqual(['Оля', 'Петро', 'Бот 1']);
    after.close();
  });

  it('нові коди кімнат після рестарту не збігаються зі збереженими', async () => {
    const first = manager(store, 1);
    const created = unwrap(await first.create('Оля'));
    await first.flush();
    // Той самий seed дав би той самий код, якби збережені кімнати не враховувались.
    expect(unwrap(await manager(store, 1).create('Петро')).code).not.toBe(created.code);
  });

  it('паралельні завантаження однієї кімнати дають один і той самий обʼєкт', async () => {
    const before = manager(store);
    const { code } = await startedRoom(before, 1, 2);
    await shutdown(before);
    const after = manager(store, 2);
    const [a, b] = await Promise.all([after.load(code), after.load(code)]);
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(after.get(code)).toBe(a);
    after.close();
  });

  it('знімок із неможливим логом не валить сервер: кімнату пропущено', async () => {
    const before = manager(store);
    const { code } = await startedRoom(before, 3, 0);
    await shutdown(before);
    const snapshot = (await store.load(code)) as RoomSnapshot;
    await store.save({
      ...snapshot,
      game: {
        seed: 1,
        log: { version: 1, playerCount: 3, actions: [{ type: 'bid', seat: 5, bid: 9 }] },
      },
    });
    expect(await manager(store, 2).load(code)).toBeUndefined();
  });

  it('R-2.3: гра, збережена несумісною версією рушія, — зрозуміле повідомлення гравцям', async () => {
    const before = manager(store);
    const { code, players } = await startedRoom(before, 2, 1);
    await shutdown(before);
    const snapshot = (await store.load(code)) as RoomSnapshot;
    const log = (snapshot.game as { log: GameLog }).log;
    await store.save({
      ...snapshot,
      game: { seed: 1, log: { ...log, version: ENGINE_LOG_VERSION + 1 } },
    });

    const after = manager(store, 2);
    expect(await after.load(code)).toBeUndefined();
    const token = players[1]?.token as string;
    for (const result of [after.resume(code, token), after.join(code, 'Новий')]) {
      expect(errorCode(result)).toBe('roomNotFound');
      expect(result.ok ? '' : result.error.message).toMatch(/новішою версією.*нову кімнату/);
    }
    after.close();
  });

  it('R-2.3: пояснення про несумісну гру забувається, коли сховище прибрало її знімок', async () => {
    const before = manager(store);
    const { code, players } = await startedRoom(before, 2, 1);
    await shutdown(before);
    const snapshot = (await store.load(code)) as RoomSnapshot;
    const log = (snapshot.game as { log: GameLog }).log;
    await store.save({
      ...snapshot,
      status: 'finished',
      game: { seed: 1, log: { ...log, version: ENGINE_LOG_VERSION + 1 } },
    });

    const after = manager(store, 2);
    expect(await after.load(code)).toBeUndefined();
    const token = players[1]?.token as string;
    expect(errorCode(after.resume(code, token))).toBe('roomNotFound');
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1);
    expect(await after.cleanup()).toBe(1);
    const result = after.resume(code, token);
    expect(errorCode(result)).toBe('roomNotFound');
    expect(result.ok ? '' : result.error.message).toBe(`Кімнати ${code} немає`);
    after.close();
  });

  it('очищення сховища: завершені ігри старші 30 днів, лобі старші 7 днів', async () => {
    const rooms = manager(store);
    const lobby = unwrap(await rooms.create('Оля'));
    const { code } = await startedRoom(rooms, 3, 0);
    await rooms.flush();
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1);
    expect(await rooms.cleanup()).toBe(1);
    expect(await store.load(lobby.code)).toBeNull();
    expect(await store.load(code)).not.toBeNull();
    rooms.close();
  });
});

describe('запис у сховище', () => {
  it('записи однієї кімнати йдуть послідовно в порядку змін', async () => {
    const store = new GatedStore();
    const rooms = manager(store);
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.join(host.code, 'Петро'));
    unwrap(rooms.addBot(host.code, host.playerId));
    await settle();
    // Другий запис не починається, доки не завершився перший.
    expect(store.started).toEqual([`${host.code}:1`]);
    let done = false;
    void rooms.persisted(host.code).then(() => (done = true));
    for (let i = 0; i < 3; i++) {
      store.release();
      await settle();
    }
    expect(store.finished).toEqual([`${host.code}:1`, `${host.code}:2`, `${host.code}:3`]);
    expect(done).toBe(true);
  });

  it('persisted() повідомляє про невдалий запис; наступний успішний запис це виправляє', async () => {
    const store = new GatedStore();
    const errors: unknown[] = [];
    const rooms = new RoomManager({
      random: testRandom(1),
      store,
      onStoreError: (error) => errors.push(error),
    });
    const host = unwrap(await rooms.create('Оля'));
    store.release();
    expect(await rooms.persisted(host.code)).toBe(true);

    store.fail = true;
    unwrap(rooms.join(host.code, 'Петро'));
    const result = rooms.persisted(host.code);
    await settle();
    store.release();
    expect(await result).toBe(false);
    expect(errors).toHaveLength(1);
    expect((await store.load(host.code))?.seats).toHaveLength(1);

    store.fail = false;
    unwrap(rooms.join(host.code, 'Марта'));
    const next = rooms.persisted(host.code);
    await settle();
    store.release();
    expect(await next).toBe(true);
    expect((await store.load(host.code))?.seats).toHaveLength(3);
  });
});

describe('відключений гравець (R-9.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('R-9.3: місце відключеного гравця чекає: без таймера гра не йде далі', async () => {
    const rooms = manager(new MemoryRoomStore());
    const { code } = await startedRoom(rooms, 3, 0);
    const count = actions(rooms, code);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(actions(rooms, code)).toBe(count);
    expect(rooms.roomState(code, rooms.get(code)?.hostId as string).turnDeadline).toBeNull();
  });

  it('R-9.3: хост віддає місце відключеного гравця боту; бот доходить його хід', async () => {
    const store = new MemoryRoomStore();
    const rooms = manager(store);
    const { code, players } = await startedRoom(rooms, 3, 0);
    const host = players[0]?.playerId as string;
    rooms.setConnected(code, host, true);
    const turn = rooms.get(code)?.game?.turn as number;
    const seat = turn === 0 ? 1 : turn;
    const leaving = players[seat];

    unwrap(rooms.replaceWithBot(code, host, seat));
    const member = rooms.get(code)?.seats[seat];
    expect(member).toMatchObject({ kind: 'bot', token: null, connected: true });
    expect(member?.id).not.toBe(leaving?.playerId);
    expect(rooms.roomState(code, host).seats[seat]?.kind).toBe('bot');
    // Старий токен більше не дає доступу до місця.
    expect(errorCode(rooms.resume(code, leaving?.token as string))).toBe('badToken');
    expect(errorCode(rooms.bid(code, leaving?.playerId as string, 0))).toBe('notInRoom');

    while (rooms.get(code)?.game?.turn !== seat) playHumans(rooms, code, 1);
    const count = actions(rooms, code);
    vi.advanceTimersByTime(DELAY);
    expect(actions(rooms, code)).toBe(count + 1);
    await shutdown(rooms);

    // Заміна переживає рестарт.
    const after = manager(store, 2);
    expect((await after.load(code))?.seats[seat]?.kind).toBe('bot');
    after.close();
  });

  it('R-9.3: віддати місце боту може лише хост, лише під час гри і лише за відключеного гравця', async () => {
    const rooms = manager(new MemoryRoomStore());
    const host = unwrap(await rooms.create('Оля'));
    const guest = unwrap(rooms.join(host.code, 'Петро'));
    unwrap(rooms.addBot(host.code, host.playerId));
    expect(errorCode(rooms.replaceWithBot(host.code, host.playerId, 1))).toBe('notStarted');
    unwrap(rooms.start(host.code, host.playerId));

    expect(errorCode(rooms.replaceWithBot(host.code, guest.playerId, 0))).toBe('notHost');
    rooms.setConnected(host.code, guest.playerId, true);
    expect(errorCode(rooms.replaceWithBot(host.code, host.playerId, 1))).toBe('playerConnected');
    expect(errorCode(rooms.replaceWithBot(host.code, host.playerId, 2))).toBe('badRequest');
    expect(errorCode(rooms.replaceWithBot(host.code, host.playerId, 5))).toBe('badRequest');
    rooms.setConnected(host.code, guest.playerId, false);
    unwrap(rooms.replaceWithBot(host.code, host.playerId, 1));
    rooms.close();
  });
});

describe('таймер ходу (R-9.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('R-9.3: таймер за замовчуванням вимкнений; хост вмикає його в налаштуваннях до старту', async () => {
    const rooms = manager(new MemoryRoomStore());
    const host = unwrap(await rooms.create('Оля'));
    const guest = unwrap(rooms.join(host.code, 'Петро'));
    expect(rooms.roomState(host.code, host.playerId).turnTimerSec).toBeNull();
    expect(errorCode(rooms.settings(host.code, guest.playerId, 30))).toBe('notHost');
    unwrap(rooms.settings(host.code, host.playerId, 30));
    expect(rooms.roomState(host.code, guest.playerId).turnTimerSec).toBe(30);
    unwrap(rooms.settings(host.code, host.playerId, null));
    expect(rooms.roomState(host.code, guest.playerId).turnTimerSec).toBeNull();
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.start(host.code, host.playerId));
    expect(errorCode(rooms.settings(host.code, host.playerId, 30))).toBe('alreadyStarted');
    rooms.close();
  });

  it('R-9.3: коли час ходу сплив, сервер робить легальний хід за гравця', async () => {
    const rooms = manager(new MemoryRoomStore());
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.join(host.code, 'Петро'));
    unwrap(rooms.join(host.code, 'Марта'));
    unwrap(rooms.settings(host.code, host.playerId, 10));
    const started = Date.now();
    unwrap(rooms.start(host.code, host.playerId));
    const code = host.code;

    expect(rooms.roomState(code, host.playerId).turnDeadline).toBe(started + 10_000);
    const count = actions(rooms, code);
    const turn = rooms.get(code)?.game?.turn;
    vi.advanceTimersByTime(10_000 - 1);
    expect(actions(rooms, code)).toBe(count);
    vi.advanceTimersByTime(1);
    expect(actions(rooms, code)).toBe(count + 1);
    expect(rooms.get(code)?.game?.actions.at(-1)?.seat).toBe(turn);
    // Гравець лишається людиною, а таймер іде вже для наступного ходу.
    expect(rooms.get(code)?.seats.every((m) => m.kind === 'human')).toBe(true);
    expect(rooms.roomState(code, host.playerId).turnDeadline).toBe(Date.now() + 10_000);

    // Хід до закінчення часу перезапускає таймер.
    vi.advanceTimersByTime(4_000);
    playHumans(rooms, code, 1);
    expect(rooms.roomState(code, host.playerId).turnDeadline).toBe(Date.now() + 10_000);
    vi.advanceTimersByTime(9_999);
    expect(actions(rooms, code)).toBe(count + 2);
    rooms.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('R-9.3: з таймером гра людей без жодного ходу доходить до кінця', async () => {
    const rooms = manager(new MemoryRoomStore());
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.settings(host.code, host.playerId, 5));
    unwrap(rooms.start(host.code, host.playerId));
    let steps = 0;
    while (rooms.get(host.code)?.status !== 'finished') {
      vi.advanceTimersByTime(5_000);
      expect(++steps).toBeLessThan(5000);
    }
    expect(rooms.roomState(host.code, host.playerId).turnDeadline).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('R-9.3: налаштування таймера переживає рестарт, відлік починається заново', async () => {
    const store = new MemoryRoomStore();
    const before = manager(store);
    const host = unwrap(await before.create('Оля'));
    unwrap(before.join(host.code, 'Петро'));
    unwrap(before.join(host.code, 'Марта'));
    unwrap(before.settings(host.code, host.playerId, 20));
    unwrap(before.start(host.code, host.playerId));
    await shutdown(before);

    vi.advanceTimersByTime(60_000);
    const after = manager(store, 2);
    await after.load(host.code);
    const state = after.roomState(host.code, host.playerId);
    expect(state.turnTimerSec).toBe(20);
    expect(state.turnDeadline).toBe(Date.now() + 20_000);
    after.close();
  });
});
