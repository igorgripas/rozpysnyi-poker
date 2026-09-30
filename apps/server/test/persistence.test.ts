import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Action, type GameState, gameLog, replay } from '@poker/engine';
import { roomStateSchema } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from '../src/rooms.js';
import { FileRoomStore, MemoryRoomStore, type RoomStore } from '../src/store.js';
import { errorCode, testRandom, unwrap } from './support.js';

const DELAY = 500;

function manager(store: RoomStore, seed = 1) {
  return new RoomManager({ random: testRandom(seed), botDelayMs: DELAY, store });
}

/** Кімната з людьми й ботами; гру запущено. */
function startedRoom(rooms: RoomManager, humans: number, bots: number) {
  const host = unwrap(rooms.create('Гравець 0'));
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('персистентність', () => {
  it('R-9.3: після рестарту посеред гри стан, місця й таблиця ті самі; гравці чекають на перепідключення', () => {
    const store = new MemoryRoomStore();
    const before = manager(store);
    const { code, players } = startedRoom(before, 3, 0);
    for (const p of players) before.setConnected(code, p.playerId, true);
    playHumans(before, code, 7);
    const game = before.get(code)?.game as GameState;
    before.close();

    const after = manager(store, 2);
    const room = after.get(code);
    expect(room?.game).toEqual(game);
    expect(room?.status).toBe('playing');
    expect(room?.hostId).toBe(players[0]?.playerId);
    expect(room?.seats.map((m) => [m.id, m.connected])).toEqual(
      players.map((p) => [p.playerId, false]),
    );
    const state = after.roomState(code, players[1]?.playerId as string);
    expect(roomStateSchema.parse(state)).toEqual(state);
  });

  it('R-9.3: після рестарту гравець повертається за токеном і гра продовжується до кінця', () => {
    const store = new MemoryRoomStore();
    const before = manager(store);
    const { code, players } = startedRoom(before, 3, 0);
    playHumans(before, code, 5);
    before.close();

    const after = manager(store, 2);
    for (const p of players) expect(unwrap(after.resume(code, p.token))).toEqual(p);
    expect(errorCode(after.resume(code, 'x'.repeat(32)))).toBe('badToken');
    while (after.get(code)?.status !== 'finished') playHumans(after, code, 1);
    const game = after.get(code)?.game as GameState;
    expect(replay(game.seed, gameLog(game))).toEqual(game);
    after.close();

    // Завершена гра теж переживає рестарт.
    expect(manager(store, 3).get(code)?.status).toBe('finished');
  });

  it('після рестарту боти продовжують ходити', () => {
    const store = new MemoryRoomStore();
    const before = manager(store);
    const { code } = startedRoom(before, 1, 2);
    before.close();
    expect(vi.getTimerCount()).toBe(0);

    const after = manager(store, 2);
    const turn = after.get(code)?.game?.turn as number;
    if (after.get(code)?.seats[turn]?.kind === 'human') playHumans(after, code, 1);
    const count = actions(after, code);
    vi.advanceTimersByTime(DELAY);
    expect(actions(after, code)).toBe(count + 1);
    after.close();
  });

  it('кімната в лобі теж переживає рестарт: можна входити й запускати гру', () => {
    const store = new MemoryRoomStore();
    const host = unwrap(manager(store).create('Оля'));
    const after = manager(store, 2);
    unwrap(after.join(host.code, 'Петро'));
    unwrap(after.addBot(host.code, host.playerId));
    unwrap(after.start(host.code, host.playerId));
    expect(after.get(host.code)?.seats.map((m) => m.name)).toEqual(['Оля', 'Петро', 'Бот 1']);
    after.close();
  });

  it('нові коди кімнат після рестарту не збігаються з відновленими', () => {
    const store = new MemoryRoomStore();
    const first = unwrap(manager(store, 1).create('Оля'));
    // Той самий seed дав би той самий код, якби відновлені кімнати не враховувались.
    expect(unwrap(manager(store, 1).create('Петро')).code).not.toBe(first.code);
  });
});

describe('FileRoomStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'poker-rooms-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('зберігає кожну кімнату у файл і відновлює її новим екземпляром', () => {
    const before = manager(new FileRoomStore(dir));
    const { code, players } = startedRoom(before, 3, 0);
    playHumans(before, code, 4);
    const game = before.get(code)?.game;
    before.close();
    expect(readdirSync(dir)).toEqual([`${code}.json`]);

    const after = manager(new FileRoomStore(dir), 2);
    expect(after.get(code)?.game).toEqual(game);
    expect(unwrap(after.resume(code, players[2]?.token as string))).toEqual(players[2]);
    after.close();
  });

  it('створює каталог, якого ще немає', () => {
    const nested = join(dir, 'a', 'b');
    const rooms = manager(new FileRoomStore(nested));
    const { code } = unwrap(rooms.create('Оля'));
    expect(readdirSync(nested)).toEqual([`${code}.json`]);
  });

  it('пошкоджені файли пропускаються, решта кімнат відновлюється', () => {
    const { code } = unwrap(manager(new FileRoomStore(dir)).create('Оля'));
    writeFileSync(join(dir, 'BROKE.json'), '{ не json');
    writeFileSync(join(dir, 'WRONG.json'), JSON.stringify({ version: 999 }));
    writeFileSync(join(dir, 'notes.txt'), 'сторонній файл');
    const store = new FileRoomStore(dir);
    expect(store.load().map((s) => s.code)).toEqual([code]);
  });

  it('знімок із неможливим логом не валить сервер: кімнату пропущено', () => {
    const store = new MemoryRoomStore();
    const before = manager(store);
    const { code } = startedRoom(before, 3, 0);
    before.close();
    const [snapshot] = store.load();
    store.save({
      ...(snapshot as NonNullable<typeof snapshot>),
      game: {
        seed: 1,
        log: { version: 1, playerCount: 3, actions: [{ type: 'bid', seat: 5, bid: 9 }] },
      },
    });
    expect(manager(store, 2).get(code)).toBeUndefined();
  });
});

describe('відключений гравець (R-9.3)', () => {
  it('R-9.3: місце відключеного гравця чекає: без таймера гра не йде далі', () => {
    const rooms = manager(new MemoryRoomStore());
    const { code } = startedRoom(rooms, 3, 0);
    const count = actions(rooms, code);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(actions(rooms, code)).toBe(count);
    expect(rooms.roomState(code, rooms.get(code)?.hostId as string).turnDeadline).toBeNull();
  });

  it('R-9.3: хост віддає місце відключеного гравця боту; бот доходить його хід', () => {
    const store = new MemoryRoomStore();
    const rooms = manager(store);
    const { code, players } = startedRoom(rooms, 3, 0);
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
    rooms.close();

    // Заміна переживає рестарт.
    const after = manager(store, 2);
    expect(after.get(code)?.seats[seat]?.kind).toBe('bot');
    after.close();
  });

  it('R-9.3: віддати місце боту може лише хост, лише під час гри і лише за відключеного гравця', () => {
    const rooms = manager(new MemoryRoomStore());
    const host = unwrap(rooms.create('Оля'));
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
  it('R-9.3: таймер за замовчуванням вимкнений; хост вмикає його в налаштуваннях до старту', () => {
    const rooms = manager(new MemoryRoomStore());
    const host = unwrap(rooms.create('Оля'));
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

  it('R-9.3: коли час ходу сплив, сервер робить легальний хід за гравця', () => {
    const rooms = manager(new MemoryRoomStore());
    const host = unwrap(rooms.create('Оля'));
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

  it('R-9.3: з таймером гра людей без жодного ходу доходить до кінця', () => {
    const rooms = manager(new MemoryRoomStore());
    const host = unwrap(rooms.create('Оля'));
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

  it('R-9.3: налаштування таймера переживає рестарт, відлік починається заново', () => {
    const store = new MemoryRoomStore();
    const before = manager(store);
    const host = unwrap(before.create('Оля'));
    unwrap(before.join(host.code, 'Петро'));
    unwrap(before.join(host.code, 'Марта'));
    unwrap(before.settings(host.code, host.playerId, 20));
    unwrap(before.start(host.code, host.playerId));
    before.close();

    vi.advanceTimersByTime(60_000);
    const after = manager(store, 2);
    const state = after.roomState(host.code, host.playerId);
    expect(state.turnTimerSec).toBe(20);
    expect(state.turnDeadline).toBe(Date.now() + 20_000);
    after.close();
  });
});
