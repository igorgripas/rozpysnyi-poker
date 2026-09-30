import { type GameState, type Suit, cardId, legalActions } from '@poker/engine';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { defined, renderAt } from './support/render';
import { findState } from './support/views';

const SUIT_NAMES: Record<Suit, string> = {
  spades: 'піка',
  clubs: 'трефа',
  diamonds: 'бубна',
  hearts: 'чирва',
};

const canPlayJoker = (state: GameState) =>
  state.status === 'playing' &&
  legalActions(state).some((a) => a.type === 'play' && a.card.kind === 'joker');

/** Мій захід джокером у роздачі з козирем. */
const jokerLeadWithTrump = (state: GameState) =>
  canPlayJoker(state) && state.hand.trick.length === 0 && state.hand.trump !== null;

/** Захід джокером без козиря. */
const jokerLeadNoTrump = (state: GameState) =>
  canPlayJoker(state) && state.hand.trick.length === 0 && state.hand.trump === null;

/** Джокер не на заході. */
const jokerFollow = (state: GameState) => canPlayJoker(state) && state.hand.trick.length > 0;

/** Двічі тапає по джокеру в руці (вибір і хід). */
async function tapJoker(user: ReturnType<typeof renderAt>['user']) {
  const hand = screen.getByRole('list', { name: 'Ваші карти' });
  const joker = defined(
    within(hand)
      .getAllByRole('button', { name: 'Джокер' })
      .find((b) => b.hasAttribute('disabled') === false),
  );
  await user.click(joker);
  await user.click(joker);
}

function dialogButtons() {
  return within(screen.getByRole('dialog', { name: 'Оголошення джокера' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent);
}

function jokerOf(state: GameState) {
  const action = legalActions(state).find((a) => a.type === 'play' && a.card.kind === 'joker');
  if (action?.type !== 'play') throw new Error('немає джокера');
  return action.card;
}

describe('діалоги джокера', () => {
  it('R-6.1, R-6.2, R-6.3: на заході з козирем — старший козир, старша некозирна, маленька будь-яка', async () => {
    const state = findState(3, jokerLeadWithTrump);
    const trump = defined(state.hand.trump);
    const { connection, user } = renderAt(state, state.turn as number);
    await tapJoker(user);
    expect(connection.requests).toEqual([]);
    const suits: Suit[] = ['spades', 'clubs', 'diamonds', 'hearts'];
    expect(dialogButtons()).toEqual([
      'Старший козир',
      ...suits.filter((s) => s !== trump).map((s) => `Старша ${SUIT_NAMES[s]}`),
      ...suits.map((s) => `Маленька ${SUIT_NAMES[s]}`),
      'Скасувати',
    ]);
    // Масті в кнопках — спільним значком масті: ♦ ♥ червоні.
    const dialog = screen.getByRole('dialog', { name: 'Оголошення джокера' });
    for (const suit of suits) {
      const mark = within(dialog)
        .getByRole('button', { name: `Маленька ${SUIT_NAMES[suit]}` })
        .querySelector('.suit-mark');
      expect(mark).toHaveAttribute('data-suit', suit);
      expect(mark?.getAttribute('data-color') === 'red').toBe(
        suit === 'diamonds' || suit === 'hearts',
      );
    }
    await user.click(screen.getByRole('button', { name: `Маленька ${SUIT_NAMES[trump]}` }));
    expect(connection.requests).toEqual([
      {
        event: 'game:play',
        payload: { card: jokerOf(state), call: { type: 'low', suit: trump } },
      },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('R-6.1: без козиря «старшого козиря» немає, старша — будь-якої масті', async () => {
    const state = findState(3, jokerLeadNoTrump);
    const { connection, user } = renderAt(state, state.turn as number);
    await tapJoker(user);
    const buttons = dialogButtons();
    expect(buttons).not.toContain('Старший козир');
    expect(buttons.filter((name) => name?.startsWith('Старша '))).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Старша піка' }));
    expect(connection.requests).toEqual([
      {
        event: 'game:play',
        payload: { card: jokerOf(state), call: { type: 'high', suit: 'spades' } },
      },
    ]);
  });

  it('R-6.4, R-6.5, R-6.6: не на заході — лише «беру» або «скидаю»', async () => {
    const state = findState(3, jokerFollow);
    const { connection, user } = renderAt(state, state.turn as number);
    await tapJoker(user);
    expect(dialogButtons()).toEqual(['Беру', 'Скидаю', 'Скасувати']);
    await user.click(screen.getByRole('button', { name: 'Скидаю' }));
    expect(connection.requests).toEqual([
      { event: 'game:play', payload: { card: jokerOf(state), call: { type: 'discard' } } },
    ]);
  });

  it('R-6.4: «беру» надсилає джокер, що бере взятку', async () => {
    const state = findState(3, jokerFollow);
    const { connection, user } = renderAt(state, state.turn as number);
    await tapJoker(user);
    await user.click(screen.getByRole('button', { name: 'Беру' }));
    expect(connection.requests).toEqual([
      { event: 'game:play', payload: { card: jokerOf(state), call: { type: 'take' } } },
    ]);
  });

  it('«Скасувати» і Escape закривають діалог без ходу', async () => {
    const state = findState(3, jokerFollow);
    const { connection, user } = renderAt(state, state.turn as number);
    await tapJoker(user);
    await user.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await tapJoker(user);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(connection.requests).toEqual([]);
  });

  it('звичайна карта грається без діалогу', async () => {
    const state = findState(3, (s) =>
      legalActions(s).some((a) => a.type === 'play' && a.card.kind === 'standard'),
    );
    const { connection, user } = renderAt(state, state.turn as number);
    const action = defined(
      legalActions(state).find((a) => a.type === 'play' && a.card.kind === 'standard'),
    );
    if (action.type !== 'play') throw new Error('очікували хід картою');
    const button = defined(
      screen
        .getAllByRole('button')
        .find((b) => b.getAttribute('data-card') === cardId(action.card)),
    );
    await user.click(button);
    await user.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(connection.requests).toEqual([{ event: 'game:play', payload: { card: action.card } }]);
  });
});
