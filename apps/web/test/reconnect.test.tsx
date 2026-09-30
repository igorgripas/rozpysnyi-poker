import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { PokerClient, SESSION_STORAGE_KEY } from '../src/net/client';
import { FakeConnection, TOKEN, roomState } from './support/fakeConnection';

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
});
