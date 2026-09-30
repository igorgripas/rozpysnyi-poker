import type { GameState } from '@poker/engine';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { defined, renderAt } from './support/render';
import { PLAYER_NAMES, findState, wireView } from './support/views';

const COUNTS = [3, 4, 5, 6] as const;

/** Замовлення, коли вже замовили `made` гравців (роздаючий — останній). */
const biddingAfter = (made: number, dealer?: number) => (state: GameState) =>
  state.status === 'bidding' &&
  state.hand.spec.cards >= 2 &&
  state.hand.bids.filter((bid) => bid !== null).length === made &&
  (dealer === undefined || state.hand.dealer === dealer);

function queueItems() {
  return within(screen.getByRole('list', { name: 'Черга замовлень' })).getAllByRole('listitem');
}

const nameOf = (item: HTMLElement) => item.querySelector('.bid-queue__name')?.textContent;
const valueOf = (item: HTMLElement) => item.querySelector('.bid-queue__value')?.textContent;

describe('черга замовлень', () => {
  for (const n of COUNTS) {
    for (let dealer = 0; dealer < n; dealer++) {
      it(`R-4.2: ${n} гравців, роздає місце ${dealer + 1} — черга від лівого сусіда, роздаючий останній`, () => {
        const state = findState(n, biddingAfter(1, dealer));
        renderAt(state, 0);
        const expected = Array.from({ length: n }, (_, i) => PLAYER_NAMES[(dealer + 1 + i) % n]);
        const items = queueItems();
        expect(items.map(nameOf)).toEqual(expected);
        const last = defined(items.at(-1));
        expect(last).toHaveAttribute('data-dealer');
        expect(within(last).getByText('роздає')).toBeVisible();
        for (const item of items.slice(0, -1)) expect(item).not.toHaveAttribute('data-dealer');
      });
    }
  }

  for (const n of COUNTS) {
    it(`R-4.5: ${n} гравців — стани «замовив / хід / чекає»`, () => {
      const made = n - 2;
      const state = findState(n, biddingAfter(made));
      const seat = (state.hand.dealer + 1) % n;
      renderAt(state, seat);
      const items = queueItems();
      items.forEach((item, i) => {
        const at = (state.hand.dealer + 1 + i) % n;
        if (i < made) {
          expect(valueOf(item)).toBe(String(state.hand.bids[at]));
          expect(item).toHaveAttribute('data-state', 'bid');
          expect(item).not.toHaveAttribute('aria-current');
        } else if (i === made) {
          expect(at).toBe(state.turn);
          expect(valueOf(item)).toBe('?');
          expect(item).toHaveAttribute('data-state', 'turn');
          expect(item).toHaveAttribute('aria-current', 'true');
        } else {
          expect(valueOf(item)).toBe('—');
          expect(item).toHaveAttribute('data-state', 'waiting');
        }
      });
    });
  }

  it('R-4.5: під чергою — сума замовлень з K', () => {
    const state = findState(4, biddingAfter(2));
    renderAt(state, 0);
    const view = wireView(state, 0);
    expect(screen.getByRole('region', { name: 'Замовлення' })).toHaveTextContent(
      `Сума: ${view.bidSum} з ${state.hand.spec.cards}`,
    );
  });

  it('R-4.4: заборонене роздаючому значення показано лише на його ході', () => {
    for (const n of COUNTS) {
      const before = findState(n, biddingAfter(n - 2));
      const { unmount } = renderAt(before, 0);
      expect(screen.getByRole('region', { name: 'Замовлення' })).not.toHaveTextContent(
        'Роздаючому не можна',
      );
      unmount();

      const dealerTurn = findState(n, biddingAfter(n - 1));
      const seat = (dealerTurn.hand.dealer + 1) % n;
      const forbidden = defined(wireView(dealerTurn, seat).forbiddenBid);
      const second = renderAt(dealerTurn, seat);
      expect(screen.getByRole('region', { name: 'Замовлення' })).toHaveTextContent(
        `Роздаючому не можна: ${forbidden}`,
      );
      second.unmount();
    }
  });

  it('R-4.5: замовлення видно в черзі, навіть коли це не мій хід', () => {
    const state = findState(5, biddingAfter(2));
    const seat = state.hand.dealer;
    renderAt(state, seat);
    expect(screen.queryByRole('group', { name: 'Ваше замовлення' })).toBeNull();
    expect(queueItems()).toHaveLength(5);
  });
});

describe('картки гравців', () => {
  for (const n of COUNTS) {
    it(`R-4.2: ${n} гравців — за годинниковою стрілкою від мене, я останній`, () => {
      const state = findState(n, biddingAfter(0));
      for (let seat = 0; seat < n; seat++) {
        const { unmount } = renderAt(state, seat);
        const names = within(screen.getByRole('list', { name: 'Гравці за столом' }))
          .getAllByRole('listitem')
          .map((item) => item.querySelector('.player__name')?.textContent);
        expect(names).toEqual(
          Array.from({ length: n }, (_, i) => PLAYER_NAMES[(seat + 1 + i) % n]),
        );
        unmount();
      }
    });
  }

  it('R-4.5: замовлення — велика цифра, до замовлення — порожній стан, не нуль', () => {
    const state = findState(3, (s) => biddingAfter(1)(s) && s.hand.bids.includes(0));
    renderAt(state, 0);
    for (const item of within(screen.getByRole('list', { name: 'Гравці за столом' })).getAllByRole(
      'listitem',
    )) {
      const seat = PLAYER_NAMES.indexOf(defined(item.querySelector('.player__name')?.textContent));
      const bid = state.hand.bids[seat] ?? null;
      const value = defined(item.querySelector('.player__bid-value'));
      const box = defined(item.querySelector('.player__bid'));
      if (bid === null) {
        expect(value.textContent).toBe('—');
        expect(box).toHaveAttribute('data-empty');
      } else {
        expect(value.textContent).toBe(String(bid));
        expect(box).not.toHaveAttribute('data-empty');
      }
    }
  });
});
