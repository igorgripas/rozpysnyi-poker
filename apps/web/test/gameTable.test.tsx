import { type GameState, cardId, createGame, legalActions } from '@poker/engine';
import type { RoomState, WirePlayerView } from '@poker/protocol';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { App } from '../src/App';
import { GameTable } from '../src/game/GameTable';
import { cardName } from '../src/i18n';
import { PokerClient } from '../src/net/client';
import { ClientProvider } from '../src/net/react';
import { FakeConnection, session } from './support/fakeConnection';
import { PLAYER_NAMES, advanceUntil, findState, gameRoom, wireView } from './support/views';

function renderTable(room: RoomState, view: WirePlayerView) {
  const connection = new FakeConnection();
  const client = new PokerClient(connection);
  const user = userEvent.setup();
  const result = render(
    <ClientProvider client={client}>
      <GameTable room={room} view={view} />
    </ClientProvider>,
  );
  return { connection, user, ...result };
}

/** Рендерить стіл очима гравця на місці `seat`. */
function renderAt(state: GameState, seat: number) {
  return renderTable(gameRoom(state.playerCount, seat), wireView(state, seat));
}

/** Значення, яке точно є (замість `!`). */
function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Очікували значення');
  return value;
}

const nameAt = (seat: number | null) => defined(PLAYER_NAMES[defined(seat)]);

function handButtons() {
  return within(screen.getByRole('list', { name: 'Ваші карти' })).getAllByRole('button');
}

function seatItem(name: string) {
  return within(screen.getByRole('list', { name: 'Гравці за столом' }))
    .getAllByRole('listitem')
    .find((item) => item.querySelector('.player__name')?.textContent === name) as HTMLElement;
}

/** Мій хід у розіграші, і частина карт у руці нелегальна (треба йти в масть). */
const mustFollow = (state: GameState) =>
  state.status === 'playing' &&
  state.hand.trick.length > 0 &&
  new Set(legalActions(state).map((a) => (a.type === 'play' ? cardId(a.card) : ''))).size <
    (state.hand.hands[state.turn as number]?.length ?? 0);

describe('ігровий стіл', () => {
  it('R-5.2: нелегальні карти в руці приглушені, легальні — ні', () => {
    const state = findState(3, mustFollow);
    const seat = state.turn as number;
    renderAt(state, seat);
    const legal = new Set(
      legalActions(state).map((a) => (a.type === 'play' ? cardId(a.card) : '')),
    );
    const hand = state.hand.hands[seat] ?? [];
    const buttons = handButtons();
    expect(buttons).toHaveLength(hand.length);
    for (const card of hand) {
      const button = buttons.find((b) => b.dataset.card === cardId(card)) as HTMLElement;
      expect(button).toHaveAccessibleName(cardName(card));
      expect(button).toHaveAttribute('data-legal', String(legal.has(cardId(card))));
      if (!legal.has(cardId(card))) expect(button).toBeDisabled();
    }
    expect(buttons.some((b) => b.dataset.legal === 'false')).toBe(true);
  });

  it('тап вибирає карту, другий тап по ній грає', async () => {
    const state = findState(3, mustFollow);
    const seat = state.turn as number;
    const { connection, user } = renderAt(state, seat);
    const [first, second] = legalActions(state).filter((a) => a.type === 'play');
    const firstButton = screen.getByRole('button', { name: cardName(defined(first).card) });
    await user.click(firstButton);
    expect(firstButton).toHaveAttribute('aria-pressed', 'true');
    expect(connection.requests).toEqual([]);
    if (second !== undefined) {
      // Тап по іншій карті переносить вибір.
      const secondButton = screen.getByRole('button', { name: cardName(second.card) });
      await user.click(secondButton);
      expect(secondButton).toHaveAttribute('aria-pressed', 'true');
      expect(firstButton).toHaveAttribute('aria-pressed', 'false');
      await user.click(firstButton);
    }
    await user.click(firstButton);
    expect(connection.requests).toEqual([
      { event: 'game:play', payload: { card: defined(first).card } },
    ]);
  });

  it('повторний тап, поки сервер не відповів, не надсилає хід удруге', async () => {
    const state = findState(3, mustFollow);
    const seat = state.turn as number;
    const { connection, user } = renderAt(state, seat);
    // Сервер «думає»: відповідь не приходить.
    connection.request = (event, payload) => {
      connection.requests.push({ event, payload });
      return new Promise(() => {});
    };
    const [first] = legalActions(state).filter((a) => a.type === 'play');
    const button = screen.getByRole('button', { name: cardName(defined(first).card) });
    await user.click(button);
    await user.click(button);
    await user.click(button);
    expect(connection.requests).toHaveLength(1);
  });

  it('не на своєму ході карти не грають', async () => {
    const state = findState(3, (s) => s.status === 'playing' && s.hand.spec.cards >= 2);
    const seat = ((state.turn as number) + 1) % 3;
    const { connection, user } = renderAt(state, seat);
    for (const button of handButtons()) {
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(connection.requests).toEqual([]);
  });

  it('R-3.1: показані козир і відкрита карта', () => {
    const state = findState(
      3,
      (s) => s.hand.spec.phase === 'ascending' && s.hand.revealed?.kind === 'standard',
    );
    renderAt(state, 0);
    const revealed = defined(state.hand.revealed);
    const info = screen.getByRole('region', { name: 'Роздача' });
    expect(info).toHaveTextContent(/Козир: [♠♣♦♥]\uFE0E? (піка|трефа|бубна|чирва)/);
    // Козир — спільним значком масті: ♦ ♥ червоні.
    const trump = defined(state.hand.trump);
    const mark = info.querySelector('.game__trump .suit-mark');
    expect(mark).toHaveAttribute('data-suit', trump);
    expect(mark?.getAttribute('data-color') === 'red').toBe(
      trump === 'diamonds' || trump === 'hearts',
    );
    // Відкрита карта — прямо на столі, щоб на телефоні її було видно разом із рукою.
    const table = screen.getByRole('region', { name: 'Стіл' });
    expect(within(table).getByRole('img', { name: cardName(revealed) })).toBeInTheDocument();
    expect(within(info).queryByRole('img', { name: cardName(revealed) })).toBeNull();
  });

  it('R-3.1: відкрита карта на столі без видимого підпису, але з доступною назвою й не зменшена', () => {
    const state = findState(
      3,
      (s) => s.hand.spec.phase === 'ascending' && s.hand.revealed?.kind === 'standard',
    );
    renderAt(state, 0);
    const table = screen.getByRole('region', { name: 'Стіл' });
    expect(table).not.toHaveTextContent('Відкрита карта');
    const figure = within(table).getByRole('figure', { name: 'Відкрита карта' });
    const card = within(figure).getByRole('img', { name: cardName(defined(state.hand.revealed)) });
    // Розмір — як у карти в руці (спільна --card-w), а не окремо зменшений.
    expect(card).not.toHaveClass('card--small');
  });

  it('R-3.1: значок козиря в заголовку роздачі збільшений', () => {
    const state = findState(
      3,
      (s) => s.hand.spec.phase === 'ascending' && s.hand.revealed?.kind === 'standard',
    );
    renderAt(state, 0);
    const info = screen.getByRole('region', { name: 'Роздача' });
    expect(info.querySelector('.game__trump .game__trump-mark .suit-mark')).toHaveAttribute(
      'data-suit',
      defined(state.hand.trump),
    );
  });

  it('R-3.3: у роздачі «масті» без відкритої карти на столі — великий значок козиря', () => {
    const view = wireView(createGame(1, 3), 0);
    renderTable(gameRoom(3, 0), {
      ...view,
      spec: { ...view.spec, phase: 'suits', trump: { kind: 'fixed', suit: 'hearts' } },
      trump: 'hearts',
      revealed: null,
    });
    const table = screen.getByRole('region', { name: 'Стіл' });
    const slot = within(table).getByRole('img', { name: 'Козир: чирва' });
    expect(slot).toHaveClass('game__revealed');
    expect(slot.querySelector('.suit-mark')).toHaveAttribute('data-color', 'red');
  });

  it('R-3.4: у безкозирці на столі — «Без козиря»', () => {
    const view = wireView(createGame(1, 3), 0);
    renderTable(gameRoom(3, 0), {
      ...view,
      spec: { ...view.spec, phase: 'noTrump', trump: { kind: 'none' } },
      trump: null,
      revealed: null,
    });
    const table = screen.getByRole('region', { name: 'Стіл' });
    const slot = defined(table.querySelector('.game__revealed'));
    expect(slot).toHaveTextContent('Без козиря');
  });

  it('R-3.2: відкритий джокер — роздача без козиря («б/к»)', () => {
    const view = wireView(createGame(1, 3), 0);
    renderTable(gameRoom(3, 0), {
      ...view,
      trump: null,
      revealed: { kind: 'joker', index: 0 },
    });
    const info = screen.getByRole('region', { name: 'Роздача' });
    expect(info).toHaveTextContent('Козир: б/к');
    const table = screen.getByRole('region', { name: 'Стіл' });
    expect(within(table).getByRole('img', { name: 'Джокер' })).toBeInTheDocument();
  });

  it('R-3.4: у безкозирці козиря й відкритої карти немає', () => {
    const view = wireView(createGame(1, 3), 0);
    renderTable(gameRoom(3, 0), {
      ...view,
      spec: { ...view.spec, phase: 'noTrump', trump: { kind: 'none' } },
      trump: null,
      revealed: null,
    });
    const info = screen.getByRole('region', { name: 'Роздача' });
    expect(info).toHaveTextContent('Безкозирка');
    expect(info).toHaveTextContent('Козир: б/к');
    expect(within(info).queryByRole('img')).toBeNull();
  });

  it('R-2.1: показані номер роздачі, етап і кількість карт', () => {
    const state = advanceUntil(createGame(7, 4), (s) => s.hand.spec.index === 2);
    renderAt(state, 0);
    const info = screen.getByRole('region', { name: 'Роздача' });
    expect(info).toHaveTextContent('Роздача 3 з 22');
    expect(info).toHaveTextContent('Зростання');
    expect(info).toHaveTextContent('3 карти');
  });

  it('R-4.5: замовлення та взяті взятки кожного гравця відкриті', () => {
    const state = findState(
      3,
      (s) => s.status === 'playing' && s.hand.taken.some((n) => n > 0) && s.hand.spec.cards >= 3,
    );
    renderAt(state, 0);
    state.hand.bids.forEach((bid, seat) => {
      const item = seatItem(nameAt(seat));
      expect(item.querySelector('.player__bid-value')).toHaveTextContent(String(bid));
      expect(item).toHaveTextContent(`Взято: ${state.hand.taken[seat]}`);
    });
  });

  it('R-4.1: у мізері й відіграші замовлень немає', () => {
    const view = wireView(createGame(1, 3), 0);
    renderTable(gameRoom(3, 0), {
      ...view,
      status: 'playing',
      spec: { ...view.spec, phase: 'misere', bidding: false, trump: { kind: 'none' } },
      bids: [null, null, null],
      trump: null,
      revealed: null,
    });
    expect(seatItem('Оля')).not.toHaveTextContent(/замовлення/i);
    expect(seatItem('Оля').querySelector('.player__bid')).toBeNull();
    expect(seatItem('Оля')).toHaveTextContent('Взято: 0');
  });

  it('позначає, чий хід', () => {
    const state = createGame(3, 3);
    const turn = state.turn as number;
    renderAt(state, turn);
    expect(screen.getByRole('status')).toHaveTextContent('Ваш хід');
    expect(seatItem(nameAt(turn))).toHaveAttribute('aria-current', 'true');
  });

  it('показує імʼя гравця, чий зараз хід', () => {
    const state = createGame(3, 3);
    const other = ((state.turn as number) + 1) % 3;
    renderAt(state, other);
    expect(screen.getByRole('status')).toHaveTextContent(
      `Хід: ${['Оля', 'Бот 1', 'Бот 2'][state.turn as number]}`,
    );
  });

  it('R-2.2: роздаючий позначений', () => {
    const state = createGame(5, 3);
    renderAt(state, 0);
    const dealer = seatItem(nameAt(state.hand.dealer));
    expect(dealer).toHaveTextContent('роздає');
  });

  it('R-5.1: карти поточної взятки лежать на столі з іменами гравців', () => {
    const state = findState(3, (s) => s.status === 'playing' && s.hand.trick.length === 2);
    renderAt(state, 0);
    const table = screen.getByRole('region', { name: 'Стіл' });
    const played = within(within(table).getByRole('group', { name: 'Взятка' })).getAllByRole(
      'figure',
    );
    expect(played).toHaveLength(2);
    const leader = nameAt(state.hand.leader);
    expect(played[0]).toHaveTextContent(leader);
    expect(
      within(defined(played[0])).getByRole('img', { name: cardName(defined(state.hand.trick[0])) }),
    ).toBeInTheDocument();
  });

  it('R-9.2: остання взятка роздачі видна, поки не покладуть першу карту наступної', () => {
    const state = findState(
      3,
      (s) =>
        s.status === 'playing' &&
        s.hand.trick.length === 0 &&
        s.lastTrick !== null &&
        s.hand.taken.some((n) => n > 0),
    );
    renderAt(state, 0);
    const table = screen.getByRole('region', { name: 'Стіл' });
    const winner = nameAt(defined(state.lastTrick).winner);
    expect(table).toHaveTextContent(`Остання взятка: ${winner}`);
    expect(
      within(within(table).getByRole('group', { name: 'Взятка' })).getAllByRole('figure'),
    ).toHaveLength(3);
  });

  it('R-6.2: оголошення джокера на столі показує масть значком масті', () => {
    const state = findState(
      3,
      (s) =>
        s.status === 'playing' &&
        s.hand.trick.some(
          (c) => c.kind === 'joker' && (c.call.type === 'high' || c.call.type === 'low'),
        ),
    );
    renderAt(state, 0);
    const played = defined(
      state.hand.trick.find(
        (c) => c.kind === 'joker' && (c.call.type === 'high' || c.call.type === 'low'),
      ),
    );
    const call = played.kind === 'joker' ? played.call : null;
    const suit = call !== null && 'suit' in call ? call.suit : null;
    const mark = screen
      .getByRole('region', { name: 'Стіл' })
      .querySelector('.felt__call .suit-mark');
    expect(mark).toHaveAttribute('data-suit', defined(suit));
  });

  it('рука впорядкована: джокери, далі масті ♠ ♣ ♦ ♥ від старшої карти', () => {
    const state = findState(3, (s) => s.hand.spec.cards >= 6);
    renderAt(state, 0);
    const order = handButtons().map((b) => b.dataset.card ?? '');
    const key = (id: string) => {
      const [suit, rank] = id.split('-');
      return suit === 'joker'
        ? -1
        : ['spades', 'clubs', 'diamonds', 'hearts'].indexOf(defined(suit)) * 100 - Number(rank);
    };
    expect(order).toEqual([...order].sort((a, b) => key(a) - key(b)));
  });

  it('суперники показані з кількістю карт у руці, а їхні карти приховані', () => {
    const state = findState(3, (s) => s.status === 'playing' && s.hand.spec.cards >= 2);
    renderAt(state, 0);
    const bot = seatItem('Бот 1');
    expect(bot).toHaveTextContent(`Карт: ${defined(state.hand.hands[1]).length}`);
    // Кнопки — лише власні карти (і кнопка таблиці гри).
    const sheetButton = screen.getByRole('button', { name: 'Таблиця' });
    const buttons = screen.getAllByRole('button').filter((button) => button !== sheetButton);
    expect(buttons.length).toBe(defined(state.hand.hands[0]).length);
  });

  it('після старту гри застосунок показує стіл із рукою гравця', async () => {
    window.history.replaceState(null, '', '/');
    const connection = new FakeConnection();
    connection.on('room:create', () => ({ ok: true, data: session('ABCDE', 'p0') }));
    const client = new PokerClient(connection);
    const user = userEvent.setup();
    render(<App client={client} />);
    await user.type(screen.getByLabelText('Ваше імʼя'), 'Оля');
    await user.click(screen.getByRole('button', { name: 'Створити кімнату' }));
    act(() => connection.pushRoom(gameRoom(3, 0)));
    expect(screen.getByText('Роздаємо карти…')).toBeInTheDocument();
    act(() => connection.pushView(wireView(createGame(1, 3), 0)));
    expect(screen.getByRole('list', { name: 'Ваші карти' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Роздача' })).toHaveTextContent('Роздача 1 з 23');
  });
});
