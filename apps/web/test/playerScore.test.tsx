import { createGame } from '@poker/engine';
import type { WirePlayerView } from '@poker/protocol';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameTable } from '../src/game/GameTable';
import { PokerClient } from '../src/net/client';
import { ClientProvider } from '../src/net/react';
import { FakeConnection } from './support/fakeConnection';
import { gameRoom, wireView } from './support/views';

// T65: у панелі гравця одне значення «взяв / замовив» зі станом кольором і значком.

function renderView(patch: Partial<WirePlayerView>) {
  const view = { ...wireView(createGame(1, 3), 0), ...patch };
  render(
    <ClientProvider client={new PokerClient(new FakeConnection())}>
      <GameTable room={gameRoom(3, 0)} view={view} />
    </ClientProvider>,
  );
}

/** Розіграш роздачі із замовленням: гравці «Бот 1», «Бот 2», «Оля» на місцях 1, 2, 0. */
function playing(bids: (number | null)[], taken: number[]) {
  renderView({ status: 'playing', bids, taken });
}

function score(name: string): HTMLElement {
  const item = within(screen.getByRole('list', { name: 'Гравці за столом' }))
    .getAllByRole('listitem')
    .find((li) => li.querySelector('.player__name')?.textContent === name);
  const box = item?.querySelector<HTMLElement>('.player__score');
  if (box === null || box === undefined) throw new Error(`Немає «взяв / замовив» у ${name}`);
  return box;
}

const value = (box: HTMLElement) => box.querySelector('.player__score-value')?.textContent;
const mark = (box: HTMLElement) => box.querySelector('.player__score-mark')?.textContent ?? '';

describe('взяв / замовив у панелі гравця', () => {
  it('R-4.5: недобір — «M / N» без значка, нейтральний стан', () => {
    playing([2, 3, 1], [1, 0, 0]);
    const box = score('Оля');
    expect(value(box)).toBe('1 / 2');
    expect(box).toHaveAttribute('data-state', 'under');
    expect(mark(box)).toBe('');
    expect(box.querySelector('.player__score-label')).toHaveTextContent('взяв/зам');
    expect(box).toHaveTextContent('взяв 1, замовив 2');
  });

  it('R-4.5: рівно (зокрема 0 / 0) — зелений стан і значок ✓', () => {
    playing([2, 0, 1], [2, 0, 0]);
    for (const [name, shown] of [
      ['Оля', '2 / 2'],
      ['Бот 1', '0 / 0'],
    ] as const) {
      const box = score(name);
      expect(value(box)).toBe(shown);
      expect(box).toHaveAttribute('data-state', 'exact');
      expect(mark(box)).toBe('✓');
      expect(box).toHaveTextContent('рівно');
    }
  });

  it('R-4.5: перебір — помаранчевий стан і значок ↑', () => {
    playing([0, 1, 2], [1, 2, 0]);
    for (const [name, shown] of [
      ['Оля', '1 / 0'],
      ['Бот 1', '2 / 1'],
    ] as const) {
      const box = score(name);
      expect(value(box)).toBe(shown);
      expect(box).toHaveAttribute('data-state', 'over');
      expect(mark(box)).toBe('↑');
      expect(box).toHaveTextContent('перебір');
    }
  });

  it('R-4.5: окремих «замовлення N» і «Взято: M» більше немає', () => {
    playing([2, 3, 1], [1, 0, 0]);
    const list = screen.getByRole('list', { name: 'Гравці за столом' });
    expect(list).not.toHaveTextContent('Взято');
    expect(list).not.toHaveTextContent(/замовлення/);
  });

  it('R-4.5: поки гравець не замовив — «—», не нуль', () => {
    renderView({ status: 'bidding', bids: [null, 1, null], taken: [0, 0, 0] });
    const box = score('Оля');
    expect(value(box)).toBe('—');
    expect(box).toHaveAttribute('data-empty');
    expect(box).not.toHaveAttribute('data-state');
    expect(box).toHaveTextContent('ще не замовив');
    expect(value(score('Бот 1'))).toBe('0 / 1');
  });

  it('R-4.1: у мізері й відіграші — лише «взяв M»', () => {
    const base = wireView(createGame(1, 3), 0);
    for (const phase of ['misere', 'comeback'] as const) {
      const { unmount } = render(
        <ClientProvider client={new PokerClient(new FakeConnection())}>
          <GameTable
            room={gameRoom(3, 0)}
            view={{
              ...base,
              status: 'playing',
              spec: { ...base.spec, phase, bidding: false, trump: { kind: 'none' } },
              bids: [null, null, null],
              taken: [3, 0, 1],
              trump: null,
              revealed: null,
            }}
          />
        </ClientProvider>,
      );
      const box = score('Оля');
      expect(box.querySelector('.player__score-label')).toHaveTextContent('взяв');
      expect(value(box)).toBe('3');
      expect(box).not.toHaveTextContent('/');
      expect(box).not.toHaveTextContent(/зам/);
      expect(box).not.toHaveAttribute('data-state');
      expect(mark(box)).toBe('');
      unmount();
    }
  });
});
