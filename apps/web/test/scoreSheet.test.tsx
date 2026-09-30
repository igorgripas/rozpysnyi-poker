import { type GameState, createGame, formatScore } from '@poker/engine';
import type { WirePlayerView } from '@poker/protocol';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoreSheet } from '../src/game/ScoreSheet';
import { defined, renderAt } from './support/render';
import { PLAYER_NAMES, advanceUntil, findState, wireView } from './support/views';

type Table = WirePlayerView['table'];

/** Завершена гра на 3 гравців. */
function finishedGame(seed = 1, playerCount = 3): GameState {
  return advanceUntil(createGame(seed, playerCount), (s) => s.status === 'finished');
}

/** Завершена гра, у якій хтось отримав двох джокерів в одній роздачі. */
function gameWithDoubleJoker(): GameState {
  for (let seed = 1; seed < 100; seed++) {
    const state = finishedGame(seed);
    if (wireView(state, 0).table.rows.some((row) => row.players.some((c) => c.circles === 2))) {
      return state;
    }
  }
  throw new Error('Не знайшли гри з двома джокерами в одній руці');
}

function renderSheet(table: Table, playerCount = 3) {
  const user = userEvent.setup();
  render(<ScoreSheet table={table} names={PLAYER_NAMES.slice(0, playerCount)} />);
  return { user };
}

/** Імітує вузький екран телефона (≤720px). */
function mockNarrowScreen(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string): Partial<MediaQueryList> => ({
    matches: query.includes('max-width: 720px') ? narrow : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function sheet() {
  return screen.getByRole('table', { name: 'Таблиця гри' });
}

/** Рядки тіла таблиці (без заголовків і підсумку). */
function bodyRows() {
  const [, body] = within(sheet()).getAllByRole('rowgroup');
  return within(defined(body)).getAllByRole('row');
}

function footRows() {
  const [, , foot] = within(sheet()).getAllByRole('rowgroup');
  return within(defined(foot)).getAllByRole('row');
}

/** Текст клітинок рядка (без заголовка рядка). */
function cellTexts(row: HTMLElement) {
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
}

describe('таблиця гри (розписка)', () => {
  it('R-8.1: кожна роздача — рядок з номером, типом, картами, козирем і роздаючим', () => {
    const state = finishedGame();
    const table = wireView(state, 0).table;
    renderSheet(table);
    const rows = bodyRows();
    expect(rows).toHaveLength(23);
    table.rows.forEach((row, i) => {
      const header = within(defined(rows[i])).getByRole('rowheader');
      expect(header).toHaveAccessibleName(
        expect.stringContaining(`Роздача ${row.number}`) as string,
      );
      expect(header).toHaveAccessibleName(
        expect.stringContaining(`роздає ${PLAYER_NAMES[row.dealer]}`) as string,
      );
    });
  });

  it('R-8.1: колонка роздачі компактна — 9♥, Б, М, В, «б/к» без козиря; легенда під таблицею', () => {
    const table = wireView(finishedGame(), 0).table;
    const rows = table.rows.map((row, i) => (i === 0 ? { ...row, trump: null } : row));
    renderSheet({ ...table, rows });
    const labels = bodyRows().map((row) => row.querySelector('.sheet__deal')?.textContent ?? '');
    const symbols = { spades: '♠', clubs: '♣', diamonds: '♦', hearts: '♥' } as const;
    rows.forEach((row, i) => {
      const expected =
        row.phase === 'noTrump'
          ? 'Б'
          : row.phase === 'misere'
            ? 'М'
            : row.phase === 'comeback'
              ? 'В'
              : `${row.cards}${row.trump === null ? 'б/к' : `${symbols[row.trump]}\uFE0E`}`;
      expect(labels[i]).toBe(expected);
    });
    // Масть у колонці роздачі — спільний значок масті: ♦ ♥ червоні, ♠ ♣ — ні.
    bodyRows().forEach((element, i) => {
      const row = defined(rows[i]);
      const mark = element.querySelector('.sheet__deal .suit-mark');
      if (
        row.trump === null ||
        row.phase === 'noTrump' ||
        row.phase === 'misere' ||
        row.phase === 'comeback'
      ) {
        expect(mark).toBeNull();
        return;
      }
      expect(mark).toHaveAttribute('data-suit', row.trump);
      expect(mark?.getAttribute('data-color') === 'red').toBe(
        row.trump === 'diamonds' || row.trump === 'hearts',
      );
    });
    expect(labels[0]).toBe('1б/к');
    // Текстових назв етапів у таблиці немає — лише легенда.
    expect(sheet()).not.toHaveTextContent(/Зростання|Безкозирка|Мізер/);
    const legend = screen.getByRole('note');
    expect(legend).toHaveTextContent('Б — безкозирка');
    expect(legend).toHaveTextContent('М — мізер');
    expect(legend).toHaveTextContent('В — відіграш');
    expect(legend.querySelector('.suit-mark[data-suit="hearts"]')).toHaveAttribute(
      'data-color',
      'red',
    );
  });

  it('R-8.2: для кожного гравця — замовлення, взято, бали й наростаючий підсумок', () => {
    mockNarrowScreen(false);
    const table = wireView(finishedGame(), 0).table;
    renderSheet(table);
    for (const name of PLAYER_NAMES.slice(0, 3)) {
      expect(within(sheet()).getByRole('columnheader', { name })).toHaveAttribute('colspan', '4');
    }
    const row = defined(table.rows[4]);
    const cells = cellTexts(defined(bodyRows()[4]));
    expect(cells).toHaveLength(12);
    row.players.forEach((cell, seat) => {
      expect(cells[seat * 4]).toContain(String(cell.bid));
      expect(cells[seat * 4 + 1]).toBe(String(cell.taken));
      expect(cells[seat * 4 + 2]).toBe(formatScore(defined(cell.points)));
      expect(cells[seat * 4 + 3]).toBe(String(cell.total).replace('-', '−'));
    });
    // На широкому екрані перемикач не потрібен.
    expect(screen.queryByRole('button', { name: /взяті/ })).toBeNull();
  });

  it('R-8.2: на телефоні в гравця лише замовлення й бали, перемикач показує «взяв» і «разом»', async () => {
    mockNarrowScreen(true);
    const table = wireView(finishedGame(), 0).table;
    const { user } = renderSheet(table);
    const name = defined(PLAYER_NAMES[0]);
    expect(within(sheet()).getByRole('columnheader', { name })).toHaveAttribute('colspan', '2');
    const row = defined(table.rows[4]);
    const cells = cellTexts(defined(bodyRows()[4]));
    expect(cells).toHaveLength(6);
    expect(cells[1]).toBe(formatScore(defined(row.players[0]?.points)));
    expect(within(sheet()).queryByRole('columnheader', { name: 'разом' })).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Показати взяті й підсумок' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet()).getByRole('columnheader', { name })).toHaveAttribute('colspan', '4');
    expect(cellTexts(defined(bodyRows()[4]))).toHaveLength(12);
  });

  it('R-8.3: після роздачі замовлення обведене кружечками за джокерів (1 або 2)', () => {
    const table = wireView(gameWithDoubleJoker(), 0).table;
    renderSheet(table);
    const rows = bodyRows();
    let seen = 0;
    table.rows.forEach((row, i) => {
      row.players.forEach((cell, seat) => {
        const bid = defined(defined(rows[i]).querySelectorAll<HTMLElement>('.sheet__bid')[seat]);
        expect(bid.dataset.circles).toBe(String(cell.circles));
        if (cell.circles === 2) {
          seen++;
          expect(bid).toHaveTextContent('2 джокери');
        }
      });
    });
    expect(seen).toBeGreaterThan(0);
  });

  it('R-8.3: під час розіграшу кружечків у поточній роздачі немає', () => {
    const state = findState(
      3,
      (s) => s.status === 'playing' && s.hand.spec.index > 0 && s.hand.dealt.some(hasJoker),
    );
    const table = wireView(state, 0).table;
    renderSheet(table);
    const current = defined(bodyRows().at(-1));
    for (const bid of current.querySelectorAll<HTMLElement>('.sheet__bid')) {
      expect(bid.dataset.circles).toBeUndefined();
      expect(bid).not.toHaveTextContent('джокер');
    }
  });

  it('R-8.4: під таблицею — джокери × −10 і фінальний підсумок кожного гравця', () => {
    const table = wireView(gameWithDoubleJoker(), 0).table;
    renderSheet(table);
    const [jokers, final] = footRows();
    expect(within(defined(jokers)).getByRole('rowheader')).toHaveTextContent('Джокери × −10');
    expect(within(defined(final)).getByRole('rowheader')).toHaveTextContent('Рахунок');
    table.summary.forEach((summary, seat) => {
      const jokerCell = defined(within(defined(jokers)).getAllByRole('cell')[seat]);
      expect(jokerCell).toHaveTextContent(String(summary.circles));
      if (summary.circles > 0) expect(jokerCell).toHaveTextContent(formatScore(summary.penalty));
      expect(within(defined(final)).getAllByRole('cell')[seat]).toHaveTextContent(
        String(summary.final).replace('-', '−'),
      );
    });
  });

  it('R-8.5: таблицю можна відкрити будь-коли під час гри', async () => {
    for (const state of [
      createGame(3, 3),
      findState(3, (s) => s.status === 'playing' && s.hand.spec.index === 3),
    ]) {
      const { user, unmount } = renderAt(state, 0);
      await user.click(screen.getByRole('button', { name: 'Таблиця' }));
      const dialog = screen.getByRole('dialog', { name: 'Таблиця гри' });
      expect(within(dialog).getByRole('table', { name: 'Таблиця гри' })).toBeInTheDocument();
      expect(within(dialog).getAllByRole('rowheader').length).toBeGreaterThanOrEqual(
        state.hand.spec.index + 1,
      );
      await user.click(within(dialog).getByRole('button', { name: 'Закрити' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      unmount();
    }
  });

  it('фінальний екран показує результати й таблицю', () => {
    const state = finishedGame();
    renderAt(state, 0);
    const summary = wireView(state, 0).table.summary;
    const results = screen.getByRole('region', { name: 'Результати' });
    const items = within(results).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Від найбільшого фінального підсумку до найменшого.
    const finals = summary.map((s) => s.final).sort((a, b) => b - a);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(String(finals[i]).replace('-', '−'));
    });
    expect(screen.getByRole('table', { name: 'Таблиця гри' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Ваші карти' })).toBeNull();
  });
});

function hasJoker(hand: readonly { kind: string }[]) {
  return hand.some((card) => card.kind === 'joker');
}
