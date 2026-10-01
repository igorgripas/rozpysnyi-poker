import { type GameState, apply, legalActions } from '@poker/engine';
import type { WirePlayerView } from '@poker/protocol';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTable } from '../src/game/GameTable';
import { COLLECT_MS, TRICK_PAUSE_MS, trickPauseFromSearch } from '../src/game/trickPause';
import { PokerClient } from '../src/net/client';
import { ClientProvider } from '../src/net/react';
import { FakeConnection } from './support/fakeConnection';
import { PLAYER_NAMES, findState, gameRoom, wireView } from './support/views';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Стіл гравця `seat`, якому можна надсилати нові стани гри, як це робить сервер. */
function renderLive(state: GameState, seat: number) {
  const client = new PokerClient(new FakeConnection());
  const room = gameRoom(state.playerCount, seat);
  const table = (view: WirePlayerView) => (
    <ClientProvider client={client}>
      <GameTable room={room} view={view} />
    </ClientProvider>
  );
  const result = render(table(wireView(state, seat)));
  return {
    push(next: GameState) {
      act(() => result.rerender(table(wireView(next, seat))));
    },
  };
}

/** Перша допустима дія. */
function step(state: GameState): GameState {
  const [action] = legalActions(state);
  if (action === undefined) throw new Error('Немає допустимих дій');
  return apply(state, action);
}

function wait(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

/** Пауза взятки й анімація збору карт (кожен таймер ставиться після рендера). */
function finishPause() {
  wait(TRICK_PAUSE_MS);
  wait(COLLECT_MS);
}

const felt = () => screen.getByRole('region', { name: 'Стіл' });
// Карти взятки (окремо від відкритої карти-козиря, що теж лежить на столі).
const feltCards = () =>
  within(within(felt()).getByRole('group', { name: 'Взятка' })).queryAllByRole('figure');
const nameAt = (seat: number) => PLAYER_NAMES[seat] as string;

function seatItem(name: string) {
  return within(screen.getByRole('list', { name: 'Гравці за столом' }))
    .getAllByRole('listitem')
    .find((item) => item.querySelector('.player__name')?.textContent === name) as HTMLElement;
}

/** Остання карта взятки, після якої роздача триває. */
const beforeTrickEnd = (s: GameState) =>
  s.status === 'playing' &&
  s.hand.trick.length === s.playerCount - 1 &&
  (s.hand.hands[s.turn as number]?.length ?? 0) >= 2;

/** Остання карта роздачі, після якої йде наступна з замовленнями. */
const beforeHandEnd = (s: GameState) =>
  s.status === 'playing' &&
  s.hand.trick.length === s.playerCount - 1 &&
  s.hand.hands[s.turn as number]?.length === 1 &&
  s.hand.spec.index >= 1 &&
  s.hand.spec.index < 5;

describe('пауза після взятки', () => {
  it('завершена взятка лежить на столі з переможцем, нова карта — лише після паузи', () => {
    const before = findState(3, beforeTrickEnd);
    const done = step(before);
    const winner = done.lastTrick?.winner as number;
    const seat = (winner + 1) % 3;
    const live = renderLive(before, seat);
    const takenBefore = before.hand.taken[winner] as number;

    live.push(done);
    expect(felt()).toHaveTextContent(`Бере: ${nameAt(winner)}`);
    expect(feltCards()).toHaveLength(3);
    const winning = feltCards().filter((figure) => figure.dataset.winner === 'true');
    expect(winning).toHaveLength(1);
    expect(winning[0]).toHaveTextContent(nameAt(winner));
    // Лічильник «Взято» оновлюється, лише коли карти забирають.
    expect(seatItem(nameAt(winner))).toHaveTextContent(`Взято: ${takenBefore}`);

    // Переможець уже зайшов у нову взятку, але попередня ще на столі.
    const next = step(done);
    live.push(next);
    expect(felt()).toHaveTextContent(`Бере: ${nameAt(winner)}`);
    expect(feltCards()).toHaveLength(3);

    wait(TRICK_PAUSE_MS - 1);
    expect(feltCards()).toHaveLength(3);
    wait(1);
    expect(seatItem(nameAt(winner))).toHaveTextContent(`Взято: ${takenBefore + 1}`);
    wait(COLLECT_MS);
    expect(felt()).not.toHaveTextContent('Бере');
    expect(feltCards()).toHaveLength(1);
    expect(feltCards()[0]).toHaveTextContent(nameAt(winner));
  });

  it('свою взятку підписано «Ви берете»', () => {
    const before = findState(3, beforeTrickEnd);
    const done = step(before);
    const live = renderLive(before, done.lastTrick?.winner as number);
    live.push(done);
    expect(felt()).toHaveTextContent('Ви берете');
  });

  it('поки взятка на столі, з руки не ходять: спершу показ, потім хід', () => {
    const before = findState(3, beforeTrickEnd);
    const done = step(before);
    const winner = done.lastTrick?.winner as number;
    const live = renderLive(before, winner);
    live.push(done);
    // Переможець може зайти одразу: рука активна.
    const hand = () =>
      within(screen.getByRole('list', { name: 'Ваші карти' })).getAllByRole('button');
    expect(hand().some((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    // Хід дійшов до сервера: до кінця паузи показаний стан застарів, рука неактивна.
    live.push(step(done));
    expect(hand().every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    finishPause();
    expect(feltCards()).toHaveLength(1);
  });

  it('R-9.2: остання взятка роздачі показується з паузою, потім стіл чистий і замовлення', () => {
    const before = findState(3, beforeHandEnd);
    const done = step(before);
    expect(done.status).toBe('bidding');
    const winner = done.lastTrick?.winner as number;
    const live = renderLive(before, 0);

    live.push(done);
    expect(felt()).toHaveTextContent(winner === 0 ? 'Ви берете' : `Бере: ${nameAt(winner)}`);
    expect(feltCards()).toHaveLength(3);
    // Замовлення нової роздачі ще не показані.
    expect(screen.queryByRole('region', { name: 'Замовлення' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Роздача' })).toHaveTextContent(
      `Роздача ${before.hand.spec.index + 1} з`,
    );

    finishPause();
    expect(screen.getByRole('region', { name: 'Роздача' })).toHaveTextContent(
      `Роздача ${done.hand.spec.index + 1} з`,
    );
    expect(feltCards()).toHaveLength(0);
    expect(felt()).not.toHaveTextContent('Остання взятка');
  });

  it('R-9.2: у новій роздачі остання взятка попередньої не рендериться', () => {
    const bidding = findState(3, (s) => s.status === 'bidding' && s.lastTrick !== null);
    renderLive(bidding, 0);
    expect(feltCards()).toHaveLength(0);
    expect(felt()).not.toHaveTextContent('Остання взятка');
  });

  it('R-9.2: у першій взятці нової роздачі остання взятка попередньої не рендериться', () => {
    const first = findState(
      3,
      (s) =>
        s.status === 'playing' &&
        s.lastTrick !== null &&
        s.hand.trick.length === 0 &&
        s.hand.taken.every((n) => n === 0),
    );
    renderLive(first, 0);
    expect(feltCards()).toHaveLength(0);
    expect(felt()).not.toHaveTextContent('Остання взятка');
  });

  it('R-9.2: після паузи остання взятка роздачі видна згорнутою до першої карти наступної', () => {
    const before = findState(3, beforeTrickEnd);
    const done = step(before);
    const live = renderLive(before, 0);
    live.push(done);
    finishPause();
    expect(felt()).toHaveTextContent(`Остання взятка: ${nameAt(done.lastTrick?.winner as number)}`);
    expect(feltCards()).toHaveLength(3);
    live.push(step(done));
    expect(felt()).not.toHaveTextContent('Остання взятка');
    expect(feltCards()).toHaveLength(1);
  });
});

describe('підсвітка того, хто взяв останню взятку', () => {
  const marked = () =>
    within(screen.getByRole('list', { name: 'Гравці за столом' }))
      .getAllByRole('listitem')
      .filter((item) => item.dataset.lastTaker === 'true');

  it('R-5.1: підсвітка переходить до переможця кожної взятки й зникає в новій роздачі', () => {
    // Роздача з кількома взятками: від її початку до наступної.
    let state = findState(
      3,
      (s) =>
        s.status === 'playing' &&
        s.hand.trick.length === 0 &&
        s.hand.taken.every((n) => n === 0) &&
        s.hand.spec.cards >= 3,
    );
    const hand = state.hand.spec.index;
    const live = renderLive(state, 0);
    expect(marked()).toHaveLength(0);
    let tricks = 0;
    while (state.hand.spec.index === hand) {
      const next = step(state);
      live.push(next);
      if (next.lastTrick !== state.lastTrick && next.lastTrick !== null) {
        finishPause();
        if (next.hand.spec.index === hand) {
          const winner = next.lastTrick.winner;
          expect(marked()).toEqual([seatItem(nameAt(winner))]);
          expect(seatItem(nameAt(winner))).toHaveTextContent('взяв останню');
          tricks++;
        }
      }
      state = next;
    }
    expect(tricks).toBeGreaterThanOrEqual(2);
    // Нова роздача: взяток ще немає — підсвітки немає.
    expect(marked()).toHaveLength(0);
    expect(screen.getByRole('list', { name: 'Гравці за столом' })).not.toHaveTextContent(
      'взяв останню',
    );
  });

  it('підсвітка лишається до завершення наступної взятки й показана на моїй картці', () => {
    const state = findState(
      3,
      (s) =>
        s.status === 'playing' &&
        s.hand.trick.length === 1 &&
        s.hand.taken.some((n) => n > 0) &&
        s.hand.leader === 0,
    );
    renderLive(state, 0);
    const mine = marked();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveAttribute('data-you', 'true');
    expect(mine[0]).toHaveTextContent('взяв останню');
  });
});

describe('налаштування паузи', () => {
  it('?trickPause= діє лише в режимі розробки', () => {
    expect(trickPauseFromSearch('?trickPause=50', true)).toBe(50);
    expect(trickPauseFromSearch('?trickPause=0', true)).toBe(0);
    expect(trickPauseFromSearch('?trickPause=50', false)).toBe(TRICK_PAUSE_MS);
    expect(trickPauseFromSearch('?trickPause=abc', true)).toBe(TRICK_PAUSE_MS);
    expect(trickPauseFromSearch('', true)).toBe(TRICK_PAUSE_MS);
  });
});
