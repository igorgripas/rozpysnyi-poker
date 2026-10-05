import type { Action } from '@poker/engine';
import { roomStateSchema } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from '../src/rooms.js';
import { type PokerServer, createPokerServer } from '../src/server.js';
import { MemoryRoomStore, type RoomStore } from '../src/store.js';
import { TestClient } from './client.js';
import { errorCode, testRandom, unwrap } from './support.js';

const DELAY = 500;

function manager(store: RoomStore = new MemoryRoomStore(), seed = 1) {
  return new RoomManager({ random: testRandom(seed), botDelayMs: DELAY, trickPauseMs: 0, store });
}

/** Кімната з людьми й ботами; гру запущено, якщо `start`. */
async function room(rooms: RoomManager, humans: number, bots = 0, start = true) {
  const host = unwrap(await rooms.create('Гравець 0'));
  const players = [host];
  for (let i = 1; i < humans; i++) players.push(unwrap(rooms.join(host.code, `Гравець ${i}`)));
  for (let i = 0; i < bots; i++) unwrap(rooms.addBot(host.code, host.playerId));
  if (start) unwrap(rooms.start(host.code, host.playerId));
  return { code: host.code, players };
}

function send(rooms: RoomManager, code: string, playerId: string, action: Action) {
  if (action.type === 'bid') return rooms.bid(code, playerId, action.bid);
  return rooms.play(code, playerId, action.card, action.call);
}

/** Ходить людина, чия черга (перший легальний хід), доки не настане хід місця `seat`. */
function playUntilTurn(rooms: RoomManager, code: string, seat: number) {
  for (;;) {
    const current = rooms.get(code);
    const turn = current?.game?.turn as number;
    if (turn === seat) return;
    const member = current?.seats[turn];
    const view = rooms.view(code, member?.id as string);
    unwrap(send(rooms, code, member?.id as string, view?.legalActions[0] as Action));
  }
}

function actions(rooms: RoomManager, code: string): number {
  return rooms.get(code)?.game?.actions.length as number;
}

describe('вихід із кімнати в лобі (T180)', () => {
  it('місце гравця звільняється, токен більше не діє', async () => {
    const rooms = manager();
    const { code, players } = await room(rooms, 3, 0, false);
    const [host, guest] = players;
    unwrap(rooms.leave(code, guest?.playerId as string));
    const state = rooms.roomState(code, host?.playerId as string);
    expect(state.seats.map((s) => s.name)).toEqual(['Гравець 0', 'Гравець 2']);
    expect(errorCode(rooms.resume(code, guest?.token as string))).toBe('badToken');
    expect(errorCode(rooms.leave(code, guest?.playerId as string))).toBe('notInRoom');
  });

  it('хост виходить — хостом стає наступна людина, а не бот', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    const guest = unwrap(rooms.join(host.code, 'Петро'));
    unwrap(rooms.leave(host.code, host.playerId));
    const state = rooms.roomState(host.code, guest.playerId);
    expect(state.hostId).toBe(guest.playerId);
    expect(state.seats.map((s) => s.name)).toEqual(['Бот 1', 'Петро']);
    // Новий хост керує кімнатою.
    unwrap(rooms.addBot(host.code, guest.playerId));
  });

  it('людей не лишилося — кімната закривається й зникає зі сховища', async () => {
    const store = new MemoryRoomStore();
    const rooms = manager(store);
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    await rooms.persisted(host.code);
    expect(await store.has(host.code)).toBe(true);

    unwrap(rooms.leave(host.code, host.playerId));
    expect(rooms.get(host.code)).toBeUndefined();
    await rooms.persisted(host.code);
    expect(await store.has(host.code)).toBe(false);
    expect(await rooms.load(host.code)).toBeUndefined();
    expect(errorCode(rooms.join(host.code, 'Петро'))).toBe('roomNotFound');
  });

  it('невідома кімната — roomNotFound', () => {
    expect(errorCode(manager().leave('ZZZZZ', 'id1'))).toBe('roomNotFound');
  });
});

describe('вихід посеред гри (T180)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('R-9.3: місце позначене away, за гравця одразу ходить бот — без таймера ходу', async () => {
    const rooms = manager();
    const { code, players } = await room(rooms, 3);
    const host = players[0]?.playerId as string;
    const leaving = players[1];
    unwrap(rooms.leave(code, leaving?.playerId as string));

    const seat = rooms.roomState(code, host).seats[1];
    expect(seat).toMatchObject({ kind: 'human', away: true, connected: false });
    expect(roomStateSchema.parse(rooms.roomState(code, host))).toBeTruthy();

    playUntilTurn(rooms, code, 1);
    const count = actions(rooms, code);
    vi.advanceTimersByTime(DELAY);
    expect(actions(rooms, code)).toBe(count + 1);
    rooms.close();
  });

  it('R-9.3: якщо зараз хід того, хто вийшов, бот ходить за нього одразу', async () => {
    const rooms = manager();
    const { code, players } = await room(rooms, 3);
    playUntilTurn(rooms, code, 2);
    const count = actions(rooms, code);
    unwrap(rooms.leave(code, players[2]?.playerId as string));
    vi.advanceTimersByTime(DELAY);
    expect(actions(rooms, code)).toBe(count + 1);
    rooms.close();
  });

  it('гра йде до кінця, навіть коли вийшли всі люди', async () => {
    const rooms = manager();
    const { code, players } = await room(rooms, 3);
    for (const p of players) unwrap(rooms.leave(code, p.playerId));
    for (let i = 0; i < 10_000 && rooms.get(code)?.status !== 'finished'; i++) {
      vi.advanceTimersByTime(DELAY);
    }
    expect(rooms.get(code)?.status).toBe('finished');
  });

  it('R-9.3: гравець повертається за токеном — забирає місце з картами й балами, бот більше не ходить', async () => {
    const rooms = manager();
    const { code, players } = await room(rooms, 3);
    const leaving = players[1];
    const id = leaving?.playerId as string;
    unwrap(rooms.leave(code, id));
    playUntilTurn(rooms, code, 1);
    vi.advanceTimersByTime(DELAY);
    playUntilTurn(rooms, code, 1);
    const before = rooms.view(code, id);

    expect(unwrap(rooms.resume(code, leaving?.token as string))).toEqual(leaving);
    expect(rooms.roomState(code, id).seats[1]?.away).toBe(false);
    expect(rooms.view(code, id)).toEqual(before);
    const count = actions(rooms, code);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(actions(rooms, code)).toBe(count);
    // Гравець знову ходить сам.
    unwrap(send(rooms, code, id, before?.legalActions[0] as Action));
    rooms.close();
  });

  it('позначка «вийшов» переживає перезапуск сервера: бот і далі ходить за гравця', async () => {
    const store = new MemoryRoomStore();
    const before = manager(store);
    const { code, players } = await room(before, 3);
    unwrap(before.leave(code, players[1]?.playerId as string));
    playUntilTurn(before, code, 1);
    await before.flush();
    before.close();

    const after = manager(store, 2);
    await after.load(code);
    const host = players[0]?.playerId as string;
    expect(after.roomState(code, host).seats.map((s) => s.away)).toEqual([false, true, false]);
    const count = actions(after, code);
    vi.advanceTimersByTime(DELAY);
    expect(actions(after, code)).toBe(count + 1);
    // Повернення після рестарту теж забирає місце.
    unwrap(after.resume(code, players[1]?.token as string));
    expect(after.roomState(code, host).seats[1]?.away).toBe(false);
    after.close();
  });

  it('після завершення гри вихід анулює токен', async () => {
    const rooms = manager();
    const { code, players } = await room(rooms, 1, 2);
    unwrap(rooms.leave(code, players[0]?.playerId as string));
    for (let i = 0; i < 10_000 && rooms.get(code)?.status !== 'finished'; i++) {
      vi.advanceTimersByTime(DELAY);
    }
    expect(rooms.get(code)?.status).toBe('finished');
    // Гравець повернувся подивитися результати й вийшов остаточно.
    unwrap(rooms.resume(code, players[0]?.token as string));
    unwrap(rooms.leave(code, players[0]?.playerId as string));
    expect(errorCode(rooms.resume(code, players[0]?.token as string))).toBe('badToken');
  });
});

describe('вихід через сокети (T180)', () => {
  let server: PokerServer;
  let url: string;
  const clients: TestClient[] = [];

  function client(): TestClient {
    const created = new TestClient(url);
    clients.push(created);
    return created;
  }

  beforeEach(async () => {
    server = createPokerServer({ random: testRandom(), botDelayMs: 1, trickPauseMs: 0 });
    url = await server.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await server.close();
  });

  it('інші отримують оновлену кімнату; той, хто вийшов, більше не в кімнаті', async () => {
    const host = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    const guest = client();
    unwrap(await guest.request('room:join', { code: session.code, name: 'Петро' }));
    await host.until((c) => c.room?.seats.length === 2);

    unwrap(await guest.request('room:leave', {}));
    await host.until((c) => c.room?.seats.length === 1);
    expect(errorCode(await guest.request('room:leave', {}))).toBe('notInRoom');
    expect(errorCode(await guest.request('room:addBot', {}))).toBe('notInRoom');
  });

  it('R-9.3: посеред гри інші бачать away, гра йде; повернення за токеном знімає позначку', async () => {
    const host = client();
    const session = unwrap(await host.request('room:create', { name: 'Оля' }));
    const guest = client();
    const guestSession = unwrap(
      await guest.request('room:join', { code: session.code, name: 'Петро' }),
    );
    unwrap(await host.request('room:addBot', {}));
    unwrap(await host.request('room:start', {}));
    await guest.until((c) => c.view !== null);

    unwrap(await guest.request('room:leave', {}));
    await host.until((c) => c.room?.seats[1]?.away === true);
    expect(host.room?.seats[1]?.connected).toBe(false);

    const back = client();
    unwrap(await back.request('room:resume', { code: session.code, token: guestSession.token }));
    await host.until((c) => c.room?.seats[1]?.away === false && c.room.seats[1].connected);
    await back.until((c) => c.view?.seat === 1);
  });
});
