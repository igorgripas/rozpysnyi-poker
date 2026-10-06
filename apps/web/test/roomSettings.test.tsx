import { createGame } from '@poker/engine';
import type { RoomState } from '@poker/protocol';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { PokerClient } from '../src/net/client';
import { FakeConnection, human, roomState, session } from './support/fakeConnection';
import { renderTable } from './support/render';
import { gameRoom, wireView } from './support/views';

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

function timerSelect() {
  return screen.getByRole('combobox', { name: 'Таймер ходу' });
}

function playerItem(name: string) {
  return within(screen.getByRole('list', { name: 'Гравці за столом' }))
    .getAllByRole('listitem')
    .find((item) =>
      item.querySelector('.player__name')?.textContent?.startsWith(name),
    ) as HTMLElement;
}

/** Стіл на 3 гравців очима місця 0 (хост), де Петро (місце 1) — людина з заданим станом. */
function tableWith(petro: Partial<RoomState['seats'][number]>, overrides: Partial<RoomState> = {}) {
  const room = gameRoom(3, 0);
  const seats = room.seats.map((seat, i) =>
    i === 1 ? { ...human('p1', 'Петро'), ...petro } : seat,
  );
  return renderTable({ ...room, seats, ...overrides }, wireView(createGame(1, 3), 0));
}

describe('таймер ходу в кімнаті очікування (R-9.3)', () => {
  it('R-9.3: таймер за замовчуванням вимкнений; хост вмикає й вимикає його', async () => {
    const { connection, user } = await inRoom(roomState());
    expect(timerSelect()).toHaveValue('off');
    expect(
      within(timerSelect())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Вимкнено', '15 с', '30 с', '60 с']);
    await user.selectOptions(timerSelect(), '30');
    expect(connection.requests).toEqual([
      { event: 'room:settings', payload: { turnTimerSec: 30 } },
    ]);
    act(() => connection.pushRoom(roomState({ turnTimerSec: 30 })));
    expect(timerSelect()).toHaveValue('30');
    connection.requests.length = 0;
    await user.selectOptions(timerSelect(), 'off');
    expect(connection.requests).toEqual([
      { event: 'room:settings', payload: { turnTimerSec: null } },
    ]);
  });

  it('R-9.3: гравець бачить таймер хоста, але змінити не може; нестандартне значення теж видно', async () => {
    await inRoom(
      roomState({ you: 'p2', seats: [human('p1', 'Оля'), human('p2', 'Петро')], turnTimerSec: 45 }),
    );
    expect(timerSelect()).toBeDisabled();
    expect(timerSelect()).toHaveValue('45');
    expect(screen.getByRole('option', { name: '45 с' })).toBeInTheDocument();
  });
});

describe('віддати місце боту (R-9.3)', () => {
  it('R-9.3: хост віддає боту місце відключеного гравця', async () => {
    const { connection, user } = tableWith({ connected: false });
    await user.click(
      within(playerItem('Петро')).getByRole('button', { name: 'Віддати місце боту: Петро' }),
    );
    expect(connection.requests).toEqual([{ event: 'room:replaceWithBot', payload: { seat: 1 } }]);
  });

  it('R-9.3: кнопки немає для гравця в мережі, для місця, за яке вже ходить бот, і для не-хоста', () => {
    const { unmount } = tableWith({ connected: true });
    expect(screen.queryByRole('button', { name: /Віддати місце/ })).not.toBeInTheDocument();
    unmount();

    const away = tableWith({ connected: false, away: true });
    expect(screen.queryByRole('button', { name: /Віддати місце/ })).not.toBeInTheDocument();
    expect(playerItem('Петро')).toHaveTextContent('Петро (бот)');
    away.unmount();

    tableWith({ connected: false }, { hostId: 'p2' });
    expect(screen.queryByRole('button', { name: /Віддати місце/ })).not.toBeInTheDocument();
  });
});

describe('відлік часу ходу (R-9.3)', () => {
  afterEach(() => vi.useRealTimers());

  it('R-9.3: під час гри видно, скільки секунд лишилося на хід', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(1_700_000_000_000);
    tableWith({ connected: true }, { turnTimerSec: 30, turnDeadline: Date.now() + 30_000 });
    const timer = screen.getByRole('timer', { name: 'Час на хід' });
    expect(timer).toHaveTextContent('30 с');
    act(() => vi.advanceTimersByTime(5_000));
    expect(timer).toHaveTextContent('25 с');
    act(() => vi.advanceTimersByTime(60_000));
    expect(timer).toHaveTextContent('0 с');
  });

  it('R-9.3: без таймера відліку немає', () => {
    tableWith({ connected: true });
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});
