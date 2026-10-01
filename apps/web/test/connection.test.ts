import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerUpdate } from '../src/net/connection';

type Handler = (...args: unknown[]) => void;

/** Мінімальна підміна сокета Socket.IO: події й ручне підключення. */
const socket = {
  options: undefined as unknown,
  handlers: new Map<string, Handler>(),
  active: true,
  connect: vi.fn(),
  close: vi.fn(),
  on(event: string, handler: Handler) {
    this.handlers.set(event, handler);
    return this;
  },
  fire(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args);
  },
};

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => {
    socket.options = args.at(-1);
    return socket;
  },
}));

const { createSocketConnection } = await import('../src/net/connection');

function statuses() {
  const updates: ServerUpdate[] = [];
  createSocketConnection().subscribe((update) => updates.push(update));
  return () => updates.flatMap((update) => (update.type === 'status' ? [update.status] : []));
}

describe('зʼєднання Socket.IO: стан', () => {
  beforeEach(() => {
    socket.handlers.clear();
    socket.connect.mockClear();
    socket.active = true;
  });

  it('підключення, обрив і перепідключення змінюють стан', () => {
    const seen = statuses();
    socket.fire('connect');
    socket.fire('disconnect', 'transport close');
    socket.fire('connect');
    expect(seen()).toEqual(['online', 'offline', 'online']);
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('якщо сервер сам розірвав зʼєднання, клієнт підключається знову', () => {
    const seen = statuses();
    socket.fire('connect');
    socket.active = false;
    socket.fire('disconnect', 'io server disconnect');
    expect(seen()).toEqual(['online', 'offline']);
    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it('невдала спроба підключення — немає звʼязку', () => {
    const seen = statuses();
    socket.fire('connect_error', new Error('xhr poll error'));
    expect(seen()).toEqual(['offline']);
  });

  it('несумісна версія протоколу — клієнт застарів', () => {
    const seen = statuses();
    const error = Object.assign(new Error('Потрібна версія протоколу 2'), {
      data: { code: 'versionMismatch', protocolVersion: 2 },
    });
    socket.active = false;
    socket.fire('connect_error', error);
    expect(seen()).toEqual(['outdated']);
    expect(socket.connect).not.toHaveBeenCalled();
  });
});

describe('зʼєднання Socket.IO: перезапуск сервера (T55)', () => {
  beforeEach(() => {
    socket.handlers.clear();
    socket.connect.mockClear();
    socket.active = true;
  });

  it('перепідключається без ліміту спроб, затримка між спробами — до 5 с', () => {
    createSocketConnection('http://server.test');
    expect(socket.options).toMatchObject({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000,
    });
  });

  it('після server:restarting сервер «прокидається», доки звʼязок не відновиться', () => {
    const seen = statuses();
    socket.fire('connect');
    socket.fire('server:restarting', {});
    socket.fire('disconnect', 'io server disconnect');
    socket.fire('connect_error', new Error('xhr poll error'));
    socket.fire('connect_error', new Error('websocket error'));
    socket.fire('connect');
    expect(seen()).toEqual(['online', 'waking', 'waking', 'waking', 'waking', 'online']);
    // Після відновлення звичайний обрив — знову «немає звʼязку».
    socket.fire('disconnect', 'transport close');
    expect(seen().at(-1)).toBe('offline');
  });

  it('сервер зупиняється й відхиляє підключення (unavailable) — теж «прокидається»', () => {
    const seen = statuses();
    const error = Object.assign(new Error('Сервер перезапускається'), {
      data: { code: 'unavailable' },
    });
    socket.fire('connect_error', error);
    socket.fire('connect_error', new Error('xhr poll error'));
    expect(seen()).toEqual(['waking', 'waking']);
  });

  it('відмову сервера, що зупиняється, Socket.IO не повторює сам: клієнт пробує знову з затримкою до 5 с', () => {
    vi.useFakeTimers();
    try {
      statuses();
      const error = Object.assign(new Error('Сервер перезапускається'), {
        data: { code: 'unavailable' },
      });
      const delays: number[] = [];
      for (let i = 0; i < 5; i++) {
        socket.active = false;
        socket.connect.mockClear();
        socket.fire('connect_error', error);
        let waited = 0;
        while (socket.connect.mock.calls.length === 0) {
          vi.advanceTimersByTime(100);
          waited += 100;
        }
        delays.push(waited);
      }
      expect(delays).toEqual([1000, 2000, 4000, 5000, 5000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
