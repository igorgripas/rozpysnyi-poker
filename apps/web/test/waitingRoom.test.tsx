import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { PokerClient } from '../src/net/client';
import type { RoomState } from '@poker/protocol';
import { FakeConnection, bot, human, roomState, session } from './support/fakeConnection';

async function inRoom(room: RoomState) {
  window.history.replaceState(null, '', '/');
  const connection = new FakeConnection();
  connection.on('room:create', () => ({ ok: true, data: session(room.code, room.you) }));
  const client = new PokerClient(connection);
  const user = userEvent.setup();
  render(<App client={client} />);
  await user.type(screen.getByLabelText('Ваше імʼя'), 'Оля');
  await user.click(screen.getByRole('button', { name: 'Створити кімнату' }));
  act(() => connection.pushRoom(room));
  connection.requests.length = 0;
  return { connection, user };
}

function seatNames(): string[] {
  const list = screen.getByRole('list', { name: 'Гравці' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.seat__name')?.textContent ?? '');
}

describe('кімната очікування', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('R-9.1: показує гравців у порядку місць, позначає хоста, ботів і вас', async () => {
    await inRoom(
      roomState({
        you: 'p2',
        seats: [human('p1', 'Оля'), human('p2', 'Петро', false), bot('b1', 'Бот 1')],
      }),
    );
    expect(seatNames()).toEqual(['Оля', 'Петро', 'Бот 1']);
    const [first, second, third] = within(
      screen.getByRole('list', { name: 'Гравці' }),
    ).getAllByRole('listitem');
    expect(first).toHaveTextContent('хост');
    expect(second).toHaveTextContent('ви');
    expect(second).toHaveTextContent('не в мережі');
    expect(third).toHaveTextContent('бот');
  });

  it('R-1.2: хост додає бота, а на 6 місцях кнопка вимкнена', async () => {
    const { connection, user } = await inRoom(roomState());
    await user.click(screen.getByRole('button', { name: 'Додати бота' }));
    expect(connection.requests).toEqual([{ event: 'room:addBot', payload: {} }]);
    act(() =>
      connection.pushRoom(
        roomState({
          seats: [human('p1', 'Оля'), ...[1, 2, 3, 4, 5].map((n) => bot(`b${n}`, `Бот ${n}`))],
        }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Додати бота' })).toBeDisabled();
  });

  it('R-1.2: хост прибирає бота з місця', async () => {
    const { connection, user } = await inRoom(
      roomState({ seats: [human('p1', 'Оля'), bot('b1', 'Бот 1'), bot('b2', 'Бот 2')] }),
    );
    await user.click(screen.getByRole('button', { name: 'Прибрати Бот 2' }));
    expect(connection.requests).toEqual([{ event: 'room:removeBot', payload: { seat: 2 } }]);
  });

  it('R-1.2: почати гру можна лише з 3–6 гравцями', async () => {
    const { connection, user } = await inRoom(
      roomState({ seats: [human('p1', 'Оля'), bot('b1', 'Бот 1')] }),
    );
    expect(screen.getByRole('button', { name: 'Почати гру' })).toBeDisabled();
    expect(screen.getByText('Потрібно щонайменше 3 гравці')).toBeInTheDocument();
    act(() =>
      connection.pushRoom(
        roomState({ seats: [human('p1', 'Оля'), bot('b1', 'Бот 1'), bot('b2', 'Бот 2')] }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Почати гру' }));
    expect(connection.requests).toEqual([{ event: 'room:start', payload: {} }]);
  });

  it('R-9.1: хост може перемішати місця до старту', async () => {
    const { connection, user } = await inRoom(
      roomState({ seats: [human('p1', 'Оля'), bot('b1', 'Бот 1')] }),
    );
    await user.click(screen.getByRole('button', { name: 'Перемішати місця' }));
    expect(connection.requests).toEqual([{ event: 'room:shuffle', payload: {} }]);
  });

  it('гравець, що не хост, не бачить керування і чекає на старт', async () => {
    await inRoom(roomState({ you: 'p2', seats: [human('p1', 'Оля'), human('p2', 'Петро')] }));
    expect(screen.queryByRole('button', { name: 'Почати гру' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Додати бота' })).toBeNull();
    expect(screen.getByText('Чекаємо, поки хост почне гру')).toBeInTheDocument();
  });

  it('показує помилку, якщо сервер відхилив дію', async () => {
    const { connection, user } = await inRoom(roomState());
    connection.on('room:addBot', () => ({
      ok: false,
      error: { code: 'roomFull', message: 'У кімнаті вже 6 гравців (R-1.2)' },
    }));
    await user.click(screen.getByRole('button', { name: 'Додати бота' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('У кімнаті вже 6 гравців');
  });

  it('«Поділитися» відкриває системне меню з посиланням на кімнату', async () => {
    const { user } = await inRoom(roomState());
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { share });
    await user.click(screen.getByRole('button', { name: 'Поділитися' }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${window.location.origin}/r/ABCDE` }),
    );
  });

  it('«Поділитися» без системного меню копіює посилання', async () => {
    const { user } = await inRoom(roomState());
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await user.click(screen.getByRole('button', { name: 'Поділитися' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/r/ABCDE`);
    expect(await screen.findByRole('status')).toHaveTextContent('Посилання скопійовано');
  });

  it('R-10.1: опції за замовчуванням вимкнені; хост вмикає «Темну», надсилаючи обидві опції', async () => {
    const { connection, user } = await inRoom(roomState());
    const dark = screen.getByRole('switch', { name: /Темна/ });
    const zeros = screen.getByRole('switch', { name: /трьох нулів/ });
    expect(dark).not.toBeChecked();
    expect(zeros).not.toBeChecked();
    await user.click(dark);
    expect(connection.requests).toEqual([
      { event: 'room:options', payload: { dark: true, zeroLimit: false } },
    ]);
    act(() => connection.pushRoom(roomState({ options: { dark: true, zeroLimit: false } })));
    expect(screen.getByRole('switch', { name: /Темна/ })).toBeChecked();
    await user.click(screen.getByRole('switch', { name: /трьох нулів/ }));
    expect(connection.requests.at(-1)).toEqual({
      event: 'room:options',
      payload: { dark: true, zeroLimit: true },
    });
  });

  it('R-10.1: гість бачить, які опції ввімкнено, але не може їх змінити', async () => {
    await inRoom(
      roomState({
        you: 'p2',
        seats: [human('p1', 'Оля'), human('p2', 'Петро')],
        options: { dark: false, zeroLimit: true },
      }),
    );
    const dark = screen.getByRole('switch', { name: /Темна/ });
    const zeros = screen.getByRole('switch', { name: /трьох нулів/ });
    expect(dark).not.toBeChecked();
    expect(zeros).toBeChecked();
    expect(dark).toBeDisabled();
    expect(zeros).toBeDisabled();
  });
});
