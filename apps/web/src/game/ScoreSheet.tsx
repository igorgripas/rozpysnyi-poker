import { type HandPhase, formatScore } from '@poker/engine';
import type { WirePlayerView } from '@poker/protocol';
import { useState } from 'react';
import { phaseName, plural, suitSymbol, trumpLabel, uk } from '../i18n';
import { useMediaQuery } from '../ui/useMediaQuery';

type Table = WirePlayerView['table'];
type Row = Table['rows'][number];
type Cell = Row['players'][number];

/** Телефон: у кожного гравця лише замовлення й бали. */
export const NARROW_SCREEN = '(max-width: 720px)';

type Column = 'bid' | 'taken' | 'points' | 'total';
const ALL_COLUMNS: readonly Column[] = ['bid', 'taken', 'points', 'total'];
const COMPACT_COLUMNS: readonly Column[] = ['bid', 'points'];

/** Етапи, які позначаються літерою замість кількості карт і козиря. */
const PHASE_MARKS: Partial<Record<HandPhase, string>> = {
  noTrump: uk.sheet.marks.noTrump,
  misere: uk.sheet.marks.misere,
  comeback: uk.sheet.marks.comeback,
};

export interface ScoreSheetProps {
  table: Table;
  /** Імена гравців за місцями. */
  names: readonly string[];
}

/**
 * Таблиця гри — розписка (R-8.1–R-8.4). Колонка роздачі компактна: «9♥», «Б», «М», «В».
 * На телефоні в гравця лише замовлення й бали; решту показує перемикач.
 */
export function ScoreSheet({ table, names }: ScoreSheetProps) {
  const narrow = useMediaQuery(NARROW_SCREEN);
  const [showAll, setShowAll] = useState(false);
  const columns = narrow && !showAll ? COMPACT_COLUMNS : ALL_COLUMNS;
  const nameOf = (seat: number) => names[seat] ?? `#${seat + 1}`;
  const seats = table.summary.map((_, seat) => seat);

  return (
    <div className="sheet">
      {narrow && (
        <button
          type="button"
          className="button sheet__toggle"
          aria-pressed={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {uk.sheet.showAll}
        </button>
      )}
      <div className="sheet__scroll">
        <table className="sheet__table" aria-label={uk.sheet.title}>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="sheet__corner" aria-label={uk.sheet.deal} />
              {seats.map((seat) => (
                <th key={seat} scope="colgroup" colSpan={columns.length} className="sheet__name">
                  {nameOf(seat)}
                </th>
              ))}
            </tr>
            <tr>
              {seats.flatMap((seat) =>
                columns.map((column) => (
                  <th
                    key={`${seat}-${column}`}
                    scope="col"
                    className={`sheet__sub sheet__sub--${column}`}
                    aria-label={uk.sheet.columns[column]}
                    title={uk.sheet.columns[column]}
                  >
                    {uk.sheet.short[column]}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.number}>
                <th
                  scope="row"
                  className="sheet__row"
                  aria-label={describeRow(row, nameOf)}
                  title={describeRow(row, nameOf)}
                >
                  <span className="sheet__deal">{dealLabel(row)}</span>
                </th>
                {row.players.flatMap((cell, seat) =>
                  columns.map((column) => (
                    <td
                      key={`${seat}-${column}`}
                      className={`sheet__cell sheet__cell--${column}`}
                      data-dealer={(column === 'bid' && seat === row.dealer) || undefined}
                    >
                      {cellContent(row, cell, column)}
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="sheet__row">
                {uk.sheet.jokers}
              </th>
              {table.summary.map((summary, seat) => (
                <td key={seat} colSpan={columns.length} className="sheet__cell">
                  {summary.circles}
                  {summary.circles > 0 && (
                    <span className="sheet__penalty"> {formatScore(summary.penalty)}</span>
                  )}
                </td>
              ))}
            </tr>
            <tr className="sheet__final">
              <th scope="row" className="sheet__row">
                {uk.sheet.final}
              </th>
              {table.summary.map((summary, seat) => (
                <td key={seat} colSpan={columns.length} className="sheet__cell">
                  {formatTotal(summary.final)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p role="note" className="sheet__legend muted">
        {uk.sheet.legend}
      </p>
    </div>
  );
}

/** Компактне позначення роздачі: «9♥», «9б/к» (відкрито джокера), «Б», «М», «В». */
function dealLabel(row: Row): string {
  const mark = PHASE_MARKS[row.phase];
  if (mark !== undefined) return mark;
  return `${row.cards}${row.trump === null ? uk.noTrump : suitSymbol(row.trump)}`;
}

/** Повний опис роздачі для доступності й підказки (R-8.1). */
function describeRow(row: Row, nameOf: (seat: number) => string): string {
  return uk.sheet.row(
    row.number,
    phaseName(row.phase),
    `${row.cards} ${plural(row.cards, uk.plural.card)}`,
    trumpLabel(row.trump),
    nameOf(row.dealer),
  );
}

function cellContent(row: Row, cell: Cell, column: Column) {
  switch (column) {
    case 'bid': {
      const noBids = row.phase === 'misere' || row.phase === 'comeback';
      return (
        <span className="sheet__bid" data-circles={cell.circles ?? undefined}>
          {cell.bid ?? (noBids ? '—' : '')}
          {cell.circles !== null && cell.circles > 0 && (
            <span className="sr-only">
              , {cell.circles} {plural(cell.circles, uk.plural.joker)}
            </span>
          )}
        </span>
      );
    }
    case 'taken':
      return cell.taken;
    case 'points':
      return cell.points === null ? '' : formatScore(cell.points);
    case 'total':
      return cell.total === null ? '' : formatTotal(cell.total);
  }
}

/** Підсумок із типографським мінусом: `312`, `−40`. */
function formatTotal(total: number): string {
  return total < 0 ? formatScore(total) : String(total);
}
