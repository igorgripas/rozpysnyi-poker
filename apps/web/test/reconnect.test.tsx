import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { PokerClient, RESUME_RETRY_MS, SESSION_STORAGE_KEY } from '../src/net/client';
import { FakeConnection, TOKEN, roomState, session } from './support/fakeConnection';

function setup() {
  const connection = new FakeConnection();
  const client = new PokerClient(connection);
  return { connection, client };
}

/** Клієнт, що вже в кімнаті ABCDE зі збереженою сесією. */
function inRoom() {
  const { connection, client } = setup();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code: 'ABCDE', token: TOKEN }));
  connection.pushStatus('online');
  connection.pushRoom(roomState());
  return { connection, client };
}

const resumes = (connection: FakeConnection) =>
  connection.requests.filter((request) => request.event === 'room:resume');

describe('стан зʼєднання й перепідключення', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('клієнт відстежує стан зʼєднання', () => {
    const { connection, client } = setup();
    expect(client.getState().connection).toBe('connecting');
    connection.pushStatus('online');
    expect(client.getState().connection).toBe('online');
    connection.pushStatus('offline');
    expect(client.getState().connection).toBe('offline');
  });

  it('після перепідключення автоматично повертається в кімнату за токеном', async () => {
    const { connection } = inRoom();
    connection.pushStatus('offline');
    expect(resumes(connection)).toEqual([]);
    connection.pushStatus('online');
    await Promise.resolve();
    expect(resumes(connection)).toEqual([
      { event: 'room:resume', payload: { code: 'ABCDE', token: TOKEN } },
    ]);
  });

  it('перше підключення без кімнати не надсилає resume', () => {
    const { connection } = setup();
    connection.pushStatus('online');
    expect(resumes(connection)).toEqual([]);
  });

  it('якщо кімнати вже немає, після перепідключення повертає в лобі', async () => {
    const { connection, client } = inRoom();
    connection.on('room:resume', () => ({
      ok: false,
      error: { code: 'roomNotFound', message: 'Кімнати ABCDE немає' },
    }));
    connection.pushStatus('offline');
    connection.pushStatus('online');
    await new Promise((resolve) => setTimeout(resolve));
    expect(client.getState().room).toBeNull();
    expect(client.getState().view).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('R-2.3: гра несумісної версії після передеплою — гравець бачить пояснення в лобі', async () => {
    const { connection, client } = inRoom();
    const message =
      'Гру збережено новішою версією рушія (лог версії 2, підтримується до 1). Продовжити цю гру неможливо — створіть нову кімнату.';
    connection.on('room:resume', () => ({ ok: false, error: { code: 'roomNotFound', message } }));
    render(<App client={client} />);
    await act(async () => {
      connection.pushStatus('offline');
      connection.pushStatus('online');
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(client.getState().room).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('пояснення невдалого повернення показується й під час автоповернення при запуску', async () => {
    const { connection, client } = setup();
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code: 'ABCDE', token: TOKEN }));
    connection.on('room:resume', () => ({
      ok: false,
      error: { code: 'roomNotFound', message: 'Кімнати ABCDE немає' },
    }));
    connection.pushStatus('online');
    await act(async () => {
      render(<App client={client} />);
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Кімнати ABCDE немає');
  });

  it('пояснення невдалого повернення зникає, коли гравець входить у нову кімнату', async () => {
    const { connection, client } = inRoom();
    connection.on('room:resume', () => ({
      ok: false,
      error: { code: 'roomNotFound', message: 'Кімнати ABCDE немає' },
    }));
    expect(await client.resume()).toBe(false);
    expect(client.getState().resumeError).toBe('Кімнати ABCDE немає');
    connection.on('room:create', () => ({ ok: true, data: session('QWERT') }));
    await client.create('Оля');
    expect(client.getState().resumeError).toBeNull();
  });

  it('без звʼязку дії в кімнаті не надсилаються, а повертають мережеву помилку', async () => {
    const { connection, client } = inRoom();
    connection.pushStatus('offline');
    const error = await client.send('game:bid', { bid: 1 });
    expect(error?.code).toBe('network');
    expect(connection.requests.filter((r) => r.event === 'game:bid')).toEqual([]);
  });

  it('показує на екрані, що звʼязку немає, і ховає повідомлення після перепідключення', () => {
    const { connection, client } = setup();
    render(<App client={client} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Підключення до сервера…' })).toBeInTheDocument();

    act(() => connection.pushStatus('online'));
    expect(screen.getByRole('img', { name: 'Звʼязок є' })).toBeInTheDocument();

    act(() => connection.pushStatus('offline'));
    expect(screen.getByRole('alert')).toHaveTextContent('Немає звʼязку з сервером');
    expect(screen.getByRole('alert')).toHaveTextContent('Перепідключаємося');
    expect(screen.getByRole('img', { name: 'Немає звʼязку' })).toBeInTheDocument();

    act(() => connection.pushStatus('online'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('стара версія клієнта: просить оновити сторінку', () => {
    const { connection, client } = setup();
    render(<App client={client} />);
    act(() => connection.pushStatus('outdated'));
    expect(screen.getByRole('alert')).toHaveTextContent('Вийшла нова версія гри');
    expect(screen.getByRole('button', { name: 'Оновити' })).toBeInTheDocument();
  });

  it('повторний resume під час повернення не дублюється', async () => {
    const { connection } = inRoom();
    connection.pushStatus('offline');
    connection.pushStatus('online');
    connection.pushStatus('online');
    await Promise.resolve();
    expect(resumes(connection)).toHaveLength(1);
  });

  it('перезапуск сервера: показує, що сервер прокидається, і сам повертається в кімнату', async () => {
    const { connection, client } = inRoom();
    render(<App client={client} />);
    act(() => connection.pushStatus('waking'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Сервер прокидається, зачекайте до хвилини…',
    );
    expect(screen.getByRole('img', { name: 'Сервер прокидається…' })).toBeInTheDocument();
    // Поки сервер прокидається, дії не надсилаються.
    expect((await client.send('game:bid', { bid: 1 }))?.code).toBe('network');
    expect(connection.requests.filter((r) => r.event === 'game:bid')).toEqual([]);

    // Під час монтування App уже повертався в кімнату; після перепідключення — ще раз.
    const before = resumes(connection).length;
    await act(async () => {
      connection.pushStatus('online');
      await Promise.resolve();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(resumes(connection).slice(before)).toEqual([
      { event: 'room:resume', payload: { code: 'ABCDE', token: TOKEN } },
    ]);
  });

  it('сервер ще не готовий (unavailable): сесія не забувається', async () => {
    const { connection, client } = inRoom();
    connection.on('room:resume', () => ({
      ok: false,
      error: { code: 'unavailable', message: 'Сервер перезапускається' },
    }));
    expect(await client.resume()).toBe(false);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it('після перезапуску база ще прокидається: повернення в кімнату повторюється', async () => {
    vi.useFakeTimers();
    try {
      const { connection, client } = inRoom();
      let attempts = 0;
      connection.on('room:resume', () => {
        attempts++;
        if (attempts < 3) {
          return { ok: false, error: { code: 'unavailable', message: 'Сервер перезапускається' } };
        }
        return {
          ok: true,
          data: { code: 'ABCDE', token: TOKEN, playerId: 'p1', link: '/r/ABCDE' },
        };
      });
      connection.pushStatus('waking');
      connection.pushStatus('online');
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(RESUME_RETRY_MS);
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(RESUME_RETRY_MS);
      expect(attempts).toBe(3);
      await vi.advanceTimersByTimeAsync(RESUME_RETRY_MS * 5);
      expect(attempts).toBe(3);
      expect(client.getState().room?.code).toBe('ABCDE');
    } finally {
      vi.useRealTimers();
    }
  });
});
