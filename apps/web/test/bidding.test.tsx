import { type GameState, createGame } from '@poker/engine';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { defined, renderAt, renderTable } from './support/render';
import { findState, gameRoom, wireView } from './support/views';

/** Хід роздаючого в замовленні: він замовляє останнім (R-4.2). */
const dealerBids = (state: GameState) =>
  state.status === 'bidding' && state.turn === state.hand.dealer && state.hand.spec.cards >= 2;

/** Хід не-роздаючого в замовленні. */
const otherBids = (state: GameState) =>
  state.status === 'bidding' && state.turn !== state.hand.dealer && state.hand.spec.cards >= 2;

function bidButtons() {
  return within(screen.getByRole('group', { name: 'Ваше замовлення' })).getAllByRole('button');
}

describe('замовлення', () => {
  it('R-4.3: на своєму ході кнопки 0…K, натискання надсилає замовлення', async () => {
    const state = findState(3, otherBids);
    const seat = state.turn as number;
    const { connection, user } = renderAt(state, seat);
    const cards = state.hand.spec.cards;
    const buttons = bidButtons();
    expect(buttons.map((b) => b.textContent)).toEqual(
      Array.from({ length: cards + 1 }, (_, bid) => String(bid)),
    );
    for (const button of buttons) expect(button).toBeEnabled();
    await user.click(screen.getByRole('button', { name: String(cards) }));
    expect(connection.requests).toEqual([{ event: 'game:bid', payload: { bid: cards } }]);
  });

  it('R-4.4: роздаючому заборонене значення вимкнене й пояснене', async () => {
    const state = findState(3, dealerBids);
    const seat = state.hand.dealer;
    const { connection, user } = renderAt(state, seat);
    const view = wireView(state, seat);
    const forbidden = defined(view.forbiddenBid);
    const cards = state.hand.spec.cards;
    const button = screen.getByRole('button', { name: String(forbidden) });
    expect(button).toBeDisabled();
    const explanation = `Роздаючому не можна замовити ${forbidden}: сума замовлень не може дорівнювати кількості карт (${cards})`;
    expect(button).toHaveAccessibleDescription(explanation);
    expect(screen.getByText(explanation)).toBeVisible();
    expect(bidButtons().filter((b) => b.hasAttribute('disabled'))).toHaveLength(1);
    await user.click(button);
    expect(connection.requests).toEqual([]);
  });

  it('R-4.5: сума замовлень і заборонене значення видні всім', () => {
    const state = findState(3, dealerBids);
    const seat = (state.hand.dealer + 1) % 3;
    renderAt(state, seat);
    const view = wireView(state, seat);
    const info = screen.getByRole('region', { name: 'Роздача' });
    expect(info).toHaveTextContent(`Замовлено: ${view.bidSum} з ${state.hand.spec.cards}`);
    expect(screen.getByRole('region', { name: 'Замовлення' })).toHaveTextContent(
      `Роздаючому не можна замовити ${defined(view.forbiddenBid)}`,
    );
    // Не мій хід — кнопок немає.
    expect(screen.queryByRole('group', { name: 'Ваше замовлення' })).toBeNull();
  });

  it('R-4.5: сума замовлень лишається на екрані під час розіграшу', () => {
    const state = findState(3, (s) => s.status === 'playing' && s.hand.spec.cards >= 2);
    renderAt(state, 0);
    const sum = state.hand.bids.reduce<number>((acc, bid) => acc + (bid ?? 0), 0);
    expect(screen.getByRole('region', { name: 'Роздача' })).toHaveTextContent(
      `Замовлено: ${sum} з ${state.hand.spec.cards}`,
    );
    expect(screen.queryByRole('group', { name: 'Ваше замовлення' })).toBeNull();
  });

  it('R-4.1: у мізері суми замовлень і кнопок немає', () => {
    const view = wireView(createGame(1, 3), 0);
    renderTable(gameRoom(3, 0), {
      ...view,
      status: 'playing',
      spec: { ...view.spec, phase: 'misere', bidding: false, trump: { kind: 'none' } },
      bids: [null, null, null],
      trump: null,
      revealed: null,
    });
    expect(screen.getByRole('region', { name: 'Роздача' })).not.toHaveTextContent('Замовлено');
    expect(screen.queryByRole('group', { name: 'Ваше замовлення' })).toBeNull();
  });

  it('повторне натискання, поки сервер не відповів, не надсилає замовлення вдруге', async () => {
    const state = findState(3, otherBids);
    const { connection, user } = renderAt(state, state.turn as number);
    connection.request = (event, payload) => {
      connection.requests.push({ event, payload });
      return new Promise(() => {});
    };
    await user.click(screen.getByRole('button', { name: '0' }));
    await user.click(screen.getByRole('button', { name: '1' }));
    expect(connection.requests).toHaveLength(1);
  });

  it('помилка сервера показана гравцю', async () => {
    const state = findState(3, otherBids);
    const { connection, user } = renderAt(state, state.turn as number);
    connection.on('game:bid', () => ({
      ok: false,
      error: { code: 'illegalAction', message: 'Недопустиме замовлення' },
    }));
    await user.click(screen.getByRole('button', { name: '0' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Недопустиме замовлення');
  });
});
