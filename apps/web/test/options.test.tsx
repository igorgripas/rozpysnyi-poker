import { type Action, type GameState, apply, createGame, legalActions } from '@poker/engine';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreSheet } from '../src/game/ScoreSheet';
import { renderAt } from './support/render';
import { PLAYER_NAMES, advanceUntil, wireView } from './support/views';

/** Початок «Темної» на 3 гравців (R-10.2). */
function darkHand(options = { dark: true, zeroLimit: false }): GameState {
  return advanceUntil(createGame(4, 3, options), (s) => s.hand.spec.phase === 'dark');
}

function handList() {
  return screen.getByRole('list', { name: 'Ваші карти' });
}

describe('опції кімнати на ігровому столі (§10)', () => {
  it('R-10.2: під час темних замовлень рука показана сорочками, карт не видно', () => {
    const state = darkHand();
    const seat = state.turn as number;
    renderAt(state, seat);
    const hand = handList();
    expect(within(hand).getAllByRole('img', { name: 'Сорочка карти' })).toHaveLength(12);
    expect(within(hand).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/Темна: замовляйте наосліп/)).toBeInTheDocument();
    expect(screen.getByText('Роздача 22 з 24')).toBeInTheDocument();
    expect(screen.getAllByText('Темна').length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole('group', { name: 'Ваше замовлення' })).getAllByRole('button'),
    ).toHaveLength(13);
  });

  it('R-10.2: після замовлення роздаючого карти відкриваються', () => {
    let state = darkHand();
    while (state.status === 'bidding') state = apply(state, legalActions(state)[0] as Action);
    renderAt(state, 0);
    const hand = handList();
    expect(within(hand).queryAllByRole('img', { name: 'Сорочка карти' })).toHaveLength(0);
    expect(within(hand).getAllByRole('button')).toHaveLength(12);
    expect(screen.queryByText(/Темна: замовляйте наосліп/)).not.toBeInTheDocument();
  });

  it('R-10.3: четвертий нуль поспіль вимкнений і пояснений', () => {
    const state = advanceUntil(
      createGame(21, 3, { dark: false, zeroLimit: true }),
      (s) => s.hand.spec.index === 3,
    );
    const seat = state.turn as number;
    expect(wireView(state, seat).zeroForbidden).toBe(true);
    renderAt(state, seat);
    const zero = screen.getByRole('button', { name: '0' });
    expect(zero).toBeDisabled();
    expect(zero).toHaveAccessibleDescription(/0 не можна замовити четвертий раз поспіль/);
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled();
  });

  it('R-10.2: «Темна» в розписці позначена окремо', () => {
    let state = darkHand();
    state = advanceUntil(state, (s) => s.hand.spec.phase === 'misere');
    const table = wireView(state, 0).table;
    render(<ScoreSheet table={table} names={PLAYER_NAMES.slice(0, 3)} />);
    const row = screen.getByRole('rowheader', { name: /Роздача 22: Темна/ });
    expect(row.closest('tr')).toHaveAttribute('data-phase', 'dark');
    expect(row).toHaveTextContent(/^Тем/);
    expect(screen.getByRole('note')).toHaveTextContent('Тем — темна (бали ×2)');
  });
});
