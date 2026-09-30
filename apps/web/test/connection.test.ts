import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerUpdate } from '../src/net/connection';

type Handler = (...args: unknown[]) => void;

/** Мінімальна підміна сокета Socket.IO: події й ручне підключення. */
const socket = {
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

vi.mock('socket.io-client', () => ({ io: () => socket }));

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
