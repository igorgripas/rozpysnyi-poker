import { ROOM_CODE_LENGTH, roomCodeSchema, roomStateSchema, sessionSchema } from '@poker/protocol';
import { describe, expect, it, vi } from 'vitest';
import { RoomManager } from '../src/rooms.js';
import { errorCode, testRandom, unwrap } from './support.js';

function manager(seed = 1) {
  return new RoomManager({ random: testRandom(seed), publicUrl: 'https://poker.test' });
}

describe('створення кімнати', () => {
  it('повертає код, посилання й токен; творець — хост', async () => {
    const rooms = manager();
    const session = unwrap(await rooms.create('Оля'));
    expect(sessionSchema.parse(session)).toEqual(session);
    expect(session.code).toHaveLength(ROOM_CODE_LENGTH);
    expect(roomCodeSchema.parse(session.code)).toBe(session.code);
    expect(session.link).toBe(`https://poker.test/r/${session.code}`);

    const state = rooms.roomState(session.code, session.playerId);
    expect(roomStateSchema.parse(state)).toEqual(state);
    expect(state).toMatchObject({
      code: session.code,
      link: session.link,
      status: 'lobby',
      hostId: session.playerId,
      you: session.playerId,
      seats: [{ id: session.playerId, name: 'Оля', kind: 'human', connected: false }],
    });
  });

  it('коди різних кімнат не повторюються', async () => {
    const rooms = manager();
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add(unwrap(await rooms.create('Гравець')).code);
    expect(codes.size).toBe(200);
  });
});

describe('вхід у кімнату', () => {
  it('R-9.1: місця йдуть у порядку входу в кімнату', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    const petro = unwrap(rooms.join(host.code, 'Петро'));
    const ira = unwrap(rooms.join(host.code.toLowerCase(), 'Іра'));
    expect(petro.code).toBe(host.code);
    expect(rooms.roomState(host.code, ira.playerId).seats.map((s) => s.name)).toEqual([
      'Оля',
      'Петро',
      'Іра',
    ]);
  });

  it('невідомий код — roomNotFound', async () => {
    expect(errorCode(manager().join('ZZZZZ', 'Петро'))).toBe('roomNotFound');
  });

  it('R-1.2: у кімнаті не більше 6 місць', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    for (let i = 0; i < 5; i++) unwrap(rooms.join(host.code, `Гравець ${i}`));
    expect(errorCode(rooms.join(host.code, 'Зайвий'))).toBe('roomFull');
  });

  it('повернення за токеном дає ту саму сесію, чужий токен відхиляється', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    expect(unwrap(rooms.resume(host.code, host.token))).toEqual(host);
    expect(errorCode(rooms.resume(host.code, 'x'.repeat(32)))).toBe('badToken');
    expect(errorCode(rooms.resume('ZZZZZ', host.token))).toBe('roomNotFound');
  });

  it('після старту новий гравець не може увійти', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.start(host.code, host.playerId));
    expect(errorCode(rooms.join(host.code, 'Петро'))).toBe('alreadyStarted');
  });
});

describe('керування кімнатою хостом', () => {
  it('R-1.2: будь-яке місце може зайняти бот; хост додає й прибирає ботів', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.addBot(host.code, host.playerId));
    let seats = rooms.roomState(host.code, host.playerId).seats;
    expect(seats.map((s) => [s.name, s.kind])).toEqual([
      ['Оля', 'human'],
      ['Бот 1', 'bot'],
      ['Бот 2', 'bot'],
    ]);
    unwrap(rooms.removeBot(host.code, host.playerId, 1));
    unwrap(rooms.addBot(host.code, host.playerId));
    seats = rooms.roomState(host.code, host.playerId).seats;
    expect(seats.map((s) => s.name)).toEqual(['Оля', 'Бот 2', 'Бот 1']);
    expect(errorCode(rooms.removeBot(host.code, host.playerId, 0))).toBe('badRequest');
    expect(errorCode(rooms.removeBot(host.code, host.playerId, 5))).toBe('badRequest');
  });

  it('R-1.2: бота не можна додати, коли вже 6 місць', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    for (let i = 0; i < 5; i++) unwrap(rooms.addBot(host.code, host.playerId));
    expect(errorCode(rooms.addBot(host.code, host.playerId))).toBe('roomFull');
  });

  it('лише хост керує кімнатою', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    const petro = unwrap(rooms.join(host.code, 'Петро'));
    unwrap(rooms.join(host.code, 'Іра'));
    expect(errorCode(rooms.addBot(host.code, petro.playerId))).toBe('notHost');
    expect(errorCode(rooms.shuffle(host.code, petro.playerId))).toBe('notHost');
    expect(errorCode(rooms.start(host.code, petro.playerId))).toBe('notHost');
    expect(errorCode(rooms.addBot(host.code, 'чужий'))).toBe('notInRoom');
  });

  it('R-9.1: хост перемішує місця до старту — склад той самий, порядок інший', async () => {
    const rooms = manager(3);
    const host = unwrap(await rooms.create('Оля'));
    for (const name of ['Петро', 'Іра', 'Тарас', 'Марта', 'Богдан']) {
      unwrap(rooms.join(host.code, name));
    }
    const names = () => rooms.roomState(host.code, host.playerId).seats.map((s) => s.name);
    const before = names();
    const orders = new Set<string>();
    for (let i = 0; i < 10; i++) {
      unwrap(rooms.shuffle(host.code, host.playerId));
      orders.add(names().join());
      expect([...names()].sort()).toEqual([...before].sort());
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('R-9.1: після старту перемішувати місця не можна', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.start(host.code, host.playerId));
    expect(errorCode(rooms.shuffle(host.code, host.playerId))).toBe('alreadyStarted');
    expect(errorCode(rooms.addBot(host.code, host.playerId))).toBe('alreadyStarted');
    expect(errorCode(rooms.start(host.code, host.playerId))).toBe('alreadyStarted');
  });

  it('R-1.2: гра стартує лише з 3–6 гравцями', async () => {
    const rooms = manager();
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    expect(errorCode(rooms.start(host.code, host.playerId))).toBe('notEnoughPlayers');
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.start(host.code, host.playerId));
    expect(rooms.roomState(host.code, host.playerId).status).toBe('playing');
  });
});

describe('сповіщення про зміни', () => {
  it('кожна зміна кімнати сповіщає підписників кодом кімнати', async () => {
    const rooms = manager();
    const changes: string[] = [];
    const unsubscribe = rooms.subscribe((code) => changes.push(code));
    const host = unwrap(await rooms.create('Оля'));
    unwrap(rooms.join(host.code, 'Петро'));
    unwrap(rooms.addBot(host.code, host.playerId));
    rooms.setConnected(host.code, host.playerId, true);
    expect(rooms.roomState(host.code, host.playerId).seats[0]?.connected).toBe(true);
    expect(changes).toEqual([host.code, host.code, host.code, host.code]);
    unsubscribe();
    unwrap(rooms.shuffle(host.code, host.playerId));
    expect(changes).toHaveLength(4);
  });
});

describe('прибирання кімнат і ліміти', () => {
  function timed(options: { maxRooms?: number; idleTtlMs?: number } = {}) {
    const clock = { now: 0 };
    const rooms = new RoomManager({ random: testRandom(1), now: () => clock.now, ...options });
    return { rooms, clock };
  }

  it('кімната без підключених людей прибирається після TTL', async () => {
    const { rooms, clock } = timed({ idleTtlMs: 1000 });
    const host = unwrap(await rooms.create('Оля'));
    clock.now = 999;
    expect(rooms.sweep()).toBe(0);
    expect(rooms.get(host.code)).toBeDefined();
    clock.now = 1000;
    expect(rooms.sweep()).toBe(1);
    expect(rooms.get(host.code)).toBeUndefined();
    expect(errorCode(rooms.resume(host.code, host.token))).toBe('roomNotFound');
  });

  it('кімнату з підключеною людиною не прибирають; TTL рахується від останнього відключення', async () => {
    const { rooms, clock } = timed({ idleTtlMs: 1000 });
    const host = unwrap(await rooms.create('Оля'));
    rooms.setConnected(host.code, host.playerId, true);
    clock.now = 5000;
    expect(rooms.sweep()).toBe(0);
    rooms.setConnected(host.code, host.playerId, false);
    clock.now = 5999;
    expect(rooms.sweep()).toBe(0);
    clock.now = 6000;
    expect(rooms.sweep()).toBe(1);
  });

  it('прибрана гра скасовує заплановані ходи ботів', async () => {
    vi.useFakeTimers();
    try {
      const { rooms, clock } = timed({ idleTtlMs: 1000 });
      const host = unwrap(await rooms.create('Оля'));
      unwrap(rooms.addBot(host.code, host.playerId));
      unwrap(rooms.addBot(host.code, host.playerId));
      unwrap(rooms.settings(host.code, host.playerId, 60));
      unwrap(rooms.start(host.code, host.playerId));
      expect(vi.getTimerCount()).toBe(1);
      clock.now = 1000;
      expect(rooms.sweep()).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('кімнат у памʼяті не більше ліміту: далі створення — unavailable', async () => {
    const { rooms, clock } = timed({ maxRooms: 2, idleTtlMs: 1000 });
    unwrap(await rooms.create('Оля'));
    unwrap(await rooms.create('Петро'));
    expect(errorCode(await rooms.create('Іра'))).toBe('unavailable');
    // Покинуті кімнати звільняють місце.
    clock.now = 1000;
    unwrap(await rooms.create('Іра'));
  });
});
