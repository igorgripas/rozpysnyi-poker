import { createGame } from '@poker/engine';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { GameTable } from '../src/game/GameTable';
import { PokerClient } from '../src/net/client';
import { ClientProvider } from '../src/net/react';
import { VIBRATION_STORAGE_KEY } from '../src/ui/vibration';
import { FakeConnection } from './support/fakeConnection';
import { advanceUntil, gameRoom, wireView } from './support/views';

const vibrate = vi.fn(() => true);

/** Стіл, де спершу ходить суперник, а потім — ви. */
function renderTurnChange() {
  const start = createGame(1, 3);
  const seat = ((start.turn ?? 0) + 1) % 3;
  const room = gameRoom(3, seat);
  const client = new PokerClient(new FakeConnection());
  const table = (state: typeof start) => (
    <ClientProvider client={client}>
      <GameTable room={room} view={wireView(state, seat)} />
    </ClientProvider>
  );
  const { rerender } = render(table(start));
  return () => rerender(table(advanceUntil(start, (state) => state.turn === seat)));
}

describe('вібрація на свій хід', () => {
  beforeEach(() => {
    vibrate.mockClear();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('телефон вібрує, коли настає ваш хід', () => {
    const yourTurn = renderTurnChange();
    expect(vibrate).not.toHaveBeenCalled();
    yourTurn();
    expect(screen.getByRole('status')).toHaveTextContent('Ваш хід');
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it('вимкнена вібрація не спрацьовує', () => {
    localStorage.setItem(VIBRATION_STORAGE_KEY, 'off');
    renderTurnChange()();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('перемикач у меню налаштувань вмикає й вимикає вібрацію та запамʼятовує вибір', async () => {
    render(<App client={new PokerClient(new FakeConnection())} />);
    await userEvent.click(screen.getByRole('button', { name: 'Налаштування' }));
    const toggle = screen.getByRole('button', { name: 'Вібрація на свій хід' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(toggle).getByText('увімкнено')).toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(within(toggle).getByText('вимкнено')).toBeVisible();
    expect(localStorage.getItem(VIBRATION_STORAGE_KEY)).toBe('off');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(VIBRATION_STORAGE_KEY)).toBe('on');
  });

  it('без підтримки вібрації перемикача немає', async () => {
    Reflect.deleteProperty(navigator, 'vibrate');
    render(<App client={new PokerClient(new FakeConnection())} />);
    await userEvent.click(screen.getByRole('button', { name: 'Налаштування' }));
    expect(screen.queryByRole('button', { name: 'Вібрація на свій хід' })).not.toBeInTheDocument();
  });
});
