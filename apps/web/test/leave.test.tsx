import { createGame } from '@poker/engine';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { NETWORK_ERROR } from '../src/net/connection';
import { PokerClient, SESSION_STORAGE_KEY, UNFINISHED_STORAGE_KEY } from '../src/net/client';
import { FakeConnection, TOKEN, bot, human, roomState, session } from './support/fakeConnection';
import { renderTable } from './support/render';
import { advanceUntil, gameRoom, wireView } from './support/views';

const OTHER_TOKEN = 'token-fedcba9876543210';

/** Клієнт у кімнаті ABCDE зі збереженою сесією; `status` — стан кімнати. */
function inRoom(status: 'lobby' | 'playing' | 'finished' = 'lobby') {
  const connection = new FakeConnection();
  const client = new PokerClient(connection);
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code: 'ABCDE', token: TOKEN }));
  window.history.replaceState(null, '', '/r/ABCDE');
  connection.pushStatus('online');
  connection.pushRoom(
    roomState({ status, seats: [human('p1', 'Оля'), human('p2', 'Петро'), bot('b1', 'Бот 1')] }),
  );
  return { connection, client };
}

const leaves = (connection: FakeConnection) =>
  connection.requests.filter((request) => request.event === 'room:leave');
const resumes = (connection: FakeConnection) =>
  connection.requests.filter((request) => request.event === 'room:resume');

function storedUnfinished(): unknown {
  return JSON.parse(localStorage.getItem(UNFINISHED_STORAGE_KEY) ?? '[]');
}

beforeEach(() => window.history.replaceState(null, '', '/'));

describe('PokerClient.leave (T180)', () => {
  it('з лобі: надсилає room:leave, забуває сесію, повертає на головну', async () => {
    const { connection, client } = inRoom('lobby');
    await client.leave();
    expect(leaves(connection)).toEqual([{ event: 'room:leave', payload: {} }]);
    expect(client.getState()).toMatchObject({ room: null, view: null });
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(client.getState().unfinished).toEqual([]);
    expect(window.location.pathname).toBe('/');
  });

  it('повертає на головну, не губячи параметри запиту (?server=)', async () => {
    const { client } = inRoom('lobby');
    window.history.replaceState(null, '', '/r/ABCDE?server=http%3A%2F%2Flocalhost%3A3101');
    await client.leave();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?server=http%3A%2F%2Flocalhost%3A3101');
  });

  it('без мережі теж веде в лобі', async () => {
    const { connection, client } = inRoom('lobby');
    connection.on('room:leave', () => ({ ok: false, error: NETWORK_ERROR }));
    await client.leave();
    expect(client.getState().room).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(window.location.pathname).toBe('/');
  });

  it('із гри, що триває: сесія переходить у «мої незавершені ігри»', async () => {
    const { client } = inRoom('playing');
    await client.leave();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    const unfinished = [{ code: 'ABCDE', token: TOKEN, players: ['Оля', 'Петро', 'Бот 1'] }];
    expect(client.getState().unfinished).toEqual(unfinished);
    expect(storedUnfinished()).toEqual(unfinished);
    // Новий запуск застосунку памʼятає незавершені ігри.
    expect(new PokerClient(new FakeConnection()).getState().unfinished).toEqual(unfinished);
  });

  it('із завершеної гри: сесію забуто, у незавершених її немає', async () => {
    const { client } = inRoom('finished');
    await client.leave();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(client.getState().unfinished).toEqual([]);
  });

  it('стан кімнати, що прийшов уже після виходу, не повертає в неї', async () => {
    const { connection, client } = inRoom('playing');
    await client.leave();
    connection.pushRoom(roomState({ status: 'playing' }));
    connection.pushView(wireView(createGame(1, 3), 0));
    expect(client.getState()).toMatchObject({ room: null, view: null });
  });
});

describe('повернення в незавершену гру (T180)', () => {
  function withUnfinished() {
    localStorage.setItem(
      UNFINISHED_STORAGE_KEY,
      JSON.stringify([{ code: 'FGHJK', token: OTHER_TOKEN, players: ['Оля', 'Петро', 'Бот 1'] }]),
    );
    const connection = new FakeConnection();
    connection.pushStatus('online');
    const client = new PokerClient(connection);
    return { connection, client };
  }

  it('після виходу застосунок не повертає в гру автоматично', async () => {
    const { connection, client } = withUnfinished();
    render(<App client={client} />);
    await act(() => Promise.resolve());
    expect(resumes(connection)).toEqual([]);
    expect(screen.getByLabelText('Ваше імʼя')).toBeInTheDocument();
  });

  it('головна показує незавершену гру; «Повернутися в гру» повертає на своє місце', async () => {
    const { connection, client } = withUnfinished();
    connection.on('room:resume', () => ({ ok: true, data: session('FGHJK') }));
    const user = userEvent.setup();
    render(<App client={client} />);
    const game = screen.getByRole('listitem', { name: /FGHJK/ });
    expect(game).toHaveTextContent('Оля, Петро, Бот 1');
    await user.click(within(game).getByRole('button', { name: 'Повернутися в гру' }));
    expect(resumes(connection)).toEqual([
      { event: 'room:resume', payload: { code: 'FGHJK', token: OTHER_TOKEN } },
    ]);
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null')).toEqual({
      code: 'FGHJK',
      token: OTHER_TOKEN,
    });
    expect(client.getState().unfinished).toEqual([]);
    expect(storedUnfinished()).toEqual([]);
  });

  it('гра зникла — запис прибирається', async () => {
    const { connection, client } = withUnfinished();
    connection.on('room:resume', () => ({
      ok: false,
      error: { code: 'roomNotFound', message: 'Кімнати FGHJK немає' },
    }));
    expect(await client.resume('FGHJK')).toBe(false);
    expect(client.getState().unfinished).toEqual([]);
    expect(storedUnfinished()).toEqual([]);
  });

  it('без мережі запис лишається', async () => {
    const { connection, client } = withUnfinished();
    connection.on('room:resume', () => ({ ok: false, error: NETWORK_ERROR }));
    expect(await client.resume('FGHJK')).toBe(false);
    expect(client.getState().unfinished).toHaveLength(1);
  });

  it('посилання /r/КОД на незавершену гру повертає на своє місце', async () => {
    window.history.replaceState(null, '', '/r/FGHJK');
    const { connection, client } = withUnfinished();
    connection.on('room:resume', () => ({ ok: true, data: session('FGHJK') }));
    render(<App client={client} />);
    await act(() => Promise.resolve());
    expect(resumes(connection)).toEqual([
      { event: 'room:resume', payload: { code: 'FGHJK', token: OTHER_TOKEN } },
    ]);
  });
});

describe('кнопки виходу (T180)', () => {
  it('у кімнаті очікування — «Вийти з кімнати»', async () => {
    const { connection, client } = inRoom('lobby');
    const user = userEvent.setup();
    render(<App client={client} />);
    await user.click(screen.getByRole('button', { name: 'Вийти з кімнати' }));
    expect(leaves(connection)).toHaveLength(1);
    expect(screen.getByLabelText('Ваше імʼя')).toBeInTheDocument();
  });

  it('під час гри — «Вийти з гри» з підтвердженням', async () => {
    const { connection, user } = renderTable(gameRoom(3, 0), wireView(createGame(1, 3), 0));
    await user.click(screen.getByRole('button', { name: 'Вийти з гри' }));
    const dialog = screen.getByRole('dialog', { name: 'Вийти з гри?' });
    expect(dialog).toHaveTextContent(
      'Поки вас немає, за вас ходитиме бот. Повернутися можна з головної.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Залишитися' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(leaves(connection)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Вийти з гри' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Вийти' }));
    expect(leaves(connection)).toHaveLength(1);
  });

  it('після завершення гри — «Нова гра» без підтвердження веде на головну', async () => {
    const { connection, client } = inRoom('finished');
    const finished = advanceUntil(createGame(1, 3), (s) => s.status === 'finished');
    connection.pushView(wireView(finished, 0));
    const user = userEvent.setup();
    render(<App client={client} />);
    await user.click(screen.getByRole('button', { name: 'Нова гра' }));
    expect(leaves(connection)).toHaveLength(1);
    expect(screen.getByLabelText('Ваше імʼя')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /код/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('інші бачать «(бот)» біля імені гравця, що вийшов', () => {
    const room = gameRoom(3, 0);
    const seats = room.seats.map((seat, i) =>
      i === 1 ? { ...human('p1', 'Петро', false), away: true } : seat,
    );
    renderTable({ ...room, seats }, wireView(createGame(1, 3), 0));
    const players = screen.getByRole('list', { name: 'Гравці за столом' });
    expect(within(players).getByText(/Петро/).closest('li')).toHaveTextContent('Петро (бот)');
  });
});
