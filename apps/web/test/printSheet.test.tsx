import { createSchedule } from '@poker/engine';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { PokerClient } from '../src/net/client';
import { PrintSheet, buildPrintRows } from '../src/print/PrintSheet';
import { FakeConnection } from './support/fakeConnection';

/** Кількість роздач за R-2.1 (без «Темної»). */
const HANDS: Record<number, number> = { 3: 23, 4: 22, 5: 22, 6: 23 };

describe('рядки порожньої таблиці для друку (T64)', () => {
  for (const n of [3, 4, 5, 6]) {
    for (const dark of [false, true]) {
      it(`R-2.1, R-10.2: N = ${n}${dark ? ' з «Темною»' : ''} — роздачі за розкладом рушія й підсумки на своїх місцях`, () => {
        const rows = buildPrintRows(n, dark);
        const hands = rows.filter((row) => row.kind === 'hand');
        expect(hands).toHaveLength((HANDS[n] ?? 0) + (dark ? 1 : 0));
        const schedule = createSchedule(n, { dark, zeroLimit: false });
        expect(hands.map((row) => [row.number, row.phase, row.cards])).toEqual(
          schedule.map((spec) => [spec.index + 1, spec.phase, spec.cards]),
        );

        const kinds = rows.map((row) => (row.kind === 'hand' ? row.phase : row.kind));
        const max = Math.floor(38 / n);
        expect(kinds).toEqual([
          ...Array<string>(max - 1).fill('ascending'),
          ...Array<string>(n).fill('maximum'),
          'subtotalMain',
          ...Array<string>(4).fill('suits'),
          'subtotalSuits',
          ...Array<string>(n).fill('noTrump'),
          'subtotalNoTrump',
          ...(dark ? ['dark'] : []),
          'misere',
          'comeback',
          'jokers',
          'final',
        ]);
      });
    }
  }

  it('R-3.1, R-3.3, R-3.4: козир — масть у «Мастях», «б/к» у безкозирці, порожньо там, де відкрита карта', () => {
    const hands = buildPrintRows(4, true).filter((row) => row.kind === 'hand');
    const trumpOf = (phase: string) =>
      hands.filter((row) => row.phase === phase).map((row) => row.trump);
    expect(trumpOf('suits')).toEqual(['spades', 'clubs', 'diamonds', 'hearts']);
    expect(trumpOf('noTrump')).toEqual(['none', 'none', 'none', 'none']);
    for (const phase of ['ascending', 'maximum', 'dark', 'misere', 'comeback']) {
      expect(trumpOf(phase).every((trump) => trump === null)).toBe(true);
    }
  });
});

describe('екран «Таблиця для друку» (T64)', () => {
  const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(2);

  it('R-1.2, R-8.2: за замовчуванням — 3 гравці без «Темної», на гравця порожні «Замовлення» і «Бали»', () => {
    render(<PrintSheet onBack={() => {}} />);
    expect(screen.getByRole('radio', { name: '3' })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Темною/ })).not.toBeChecked();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader', { name: 'Замовлення' })).toHaveLength(3);
    expect(within(table).getAllByRole('columnheader', { name: 'Бали' })).toHaveLength(3);
    // 23 роздачі + 3 підсумки + джокери + разом.
    expect(bodyRows()).toHaveLength(28);
    const [firstRow] = bodyRows();
    if (firstRow === undefined) throw new Error('Немає рядків');
    const first = within(firstRow).getAllByRole('cell');
    expect(first.slice(-6).every((cell) => cell.textContent === '')).toBe(true);
  });

  it('R-10.2, R-7.7: вибір N і «Темної» перебудовує рядки, внизу — джокери й «Разом»', async () => {
    const user = userEvent.setup();
    render(<PrintSheet onBack={() => {}} />);
    await user.click(screen.getByRole('radio', { name: '6' }));
    await user.click(screen.getByRole('switch', { name: /Темною/ }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader', { name: 'Бали' })).toHaveLength(6);
    expect(bodyRows()).toHaveLength(23 + 1 + 5);
    const labels = bodyRows().map((row) => within(row).getAllByRole('rowheader')[0]?.textContent);
    expect(labels).toContain('Разом після основних');
    expect(labels).toContain('Разом після мастей');
    expect(labels).toContain('Разом після безкозирки');
    expect(labels.slice(-2)).toEqual(['Джокери (−10 за кожен)', 'Разом']);
    expect(within(table).getByText('Тем')).toBeInTheDocument();
  });

  it('T66: службова колонка одна — «Карти» поруч із «№», підсумки займають обидві', () => {
    render(<PrintSheet onBack={() => {}} />);
    const table = screen.getByRole('table');
    const [names] = within(table).getAllByRole('row');
    if (names === undefined) throw new Error('Немає шапки');
    expect(
      within(names)
        .getAllByRole('columnheader')
        .slice(0, 2)
        .map((cell) => cell.textContent),
    ).toEqual(['№', 'Карти']);
    expect(within(table).queryByRole('columnheader', { name: 'Роздача' })).toBeNull();
    expect(within(table).queryByRole('columnheader', { name: 'Козир' })).toBeNull();
    expect(table.querySelectorAll('col')).toHaveLength(2 + 3 * 2);
    for (const row of bodyRows()) {
      // На кожного з 3 гравців — «Замовлення» і «Бали».
      expect(row.children).toHaveLength(row.dataset.kind === undefined ? 2 + 6 : 1 + 6);
    }
    const total = table.querySelector('tr[data-kind="final"] th');
    expect(total?.getAttribute('colspan')).toBe('2');
  });

  it('R-2.1, R-3.3, R-10.2: клітинка «Карти» — як у таблиці гри: кількість, масть або літера етапу', async () => {
    const user = userEvent.setup();
    render(<PrintSheet onBack={() => {}} />);
    await user.click(screen.getByRole('radio', { name: '4' }));
    await user.click(screen.getByRole('switch', { name: /Темною/ }));
    const cardsOf = (phase: string) =>
      [...screen.getByRole('table').querySelectorAll(`tr[data-phase="${phase}"]`)].map(
        (row) => row.children[1]?.textContent,
      );
    expect(cardsOf('ascending')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(cardsOf('maximum')).toEqual(['9', '9', '9', '9']);
    expect(cardsOf('suits').map((text) => text?.replace('\uFE0E', ''))).toEqual([
      '9 ♠',
      '9 ♣',
      '9 ♦',
      '9 ♥',
    ]);
    expect(cardsOf('noTrump')).toEqual(['Б', 'Б', 'Б', 'Б']);
    expect(cardsOf('dark')).toEqual(['Тем']);
    expect(cardsOf('misere')).toEqual(['М']);
    expect(cardsOf('comeback')).toEqual(['В']);
  });

  it('R-3.3: масті козиря — через спільний значок масті, ♦ ♥ червоні', () => {
    const { container } = render(<PrintSheet onBack={() => {}} />);
    const marks = [...container.querySelectorAll('table .suit-mark')];
    expect(marks.map((mark) => mark.getAttribute('data-suit'))).toEqual([
      'spades',
      'clubs',
      'diamonds',
      'hearts',
    ]);
    expect(marks.map((mark) => mark.getAttribute('data-color'))).toEqual([
      'black',
      'black',
      'red',
      'red',
    ]);
  });

  it('R-10.2: легенда під таблицею розшифровує лише літери, що є в таблиці', async () => {
    const user = userEvent.setup();
    const { container } = render(<PrintSheet onBack={() => {}} />);
    const legend = () => container.querySelector('.print-legend')?.textContent;
    expect(legend()).toBe('Б — безкозирка · М — мізер · В — відіграш');
    await user.click(screen.getByRole('switch', { name: /Темною/ }));
    expect(legend()).toBe('Б — безкозирка · Тем — темна (бали ×2) · М — мізер · В — відіграш');
  });

  it('друкує через браузер і повертається на головну', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const onBack = vi.fn();
    render(<PrintSheet onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: 'Друкувати' }));
    expect(print).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(onBack).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it('відкривається з головного екрана без кімнати', async () => {
    const user = userEvent.setup();
    render(<App client={new PokerClient(new FakeConnection())} />);
    await user.click(screen.getByRole('button', { name: 'Таблиця для друку' }));
    expect(screen.getByRole('heading', { name: 'Таблиця для друку' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('button', { name: 'Таблиця для друку' })).toBeInTheDocument();
  });
});
