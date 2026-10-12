import { type HandPhase, MAX_PLAYERS, MIN_PLAYERS, type Suit, createSchedule } from '@poker/engine';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { phaseName, uk } from '../i18n';
import { SuitMark } from '../ui/SuitMark';

/** Підсумкові рядки таблиці, що не є роздачами. */
type TotalKind = 'subtotalMain' | 'subtotalSuits' | 'subtotalNoTrump' | 'jokers' | 'final';

/** Рядок порожньої таблиці: роздача або підсумок. */
export type PrintRow =
  | {
      readonly kind: 'hand';
      /** Номер роздачі в грі, від 1. */
      readonly number: number;
      readonly phase: HandPhase;
      readonly cards: number;
      /** Масть («Масті»), `none` — «б/к», `null` — відкрита карта: клітинку заповнюють ручкою. */
      readonly trump: Suit | 'none' | null;
    }
  | { readonly kind: TotalKind };

/** Після якого етапу — рядок наростаючого підсумку. */
const SUBTOTAL_AFTER: Partial<Record<HandPhase, TotalKind>> = {
  maximum: 'subtotalMain',
  suits: 'subtotalSuits',
  noTrump: 'subtotalNoTrump',
};

/**
 * Рядки порожньої розписки для N гравців: роздачі — з розкладу рушія (R-2.1, R-10.2),
 * між етапами — наростаючі підсумки, внизу — джокери (R-7.7, R-8.4) і фінальний «Разом».
 */
export function buildPrintRows(playerCount: number, dark: boolean): PrintRow[] {
  const schedule = createSchedule(playerCount, { dark, zeroLimit: false });
  const rows: PrintRow[] = [];
  schedule.forEach((spec, index) => {
    rows.push({
      kind: 'hand',
      number: spec.index + 1,
      phase: spec.phase,
      cards: spec.cards,
      trump:
        spec.trump.kind === 'fixed' ? spec.trump.suit : spec.trump.kind === 'none' ? 'none' : null,
    });
    const subtotal = SUBTOTAL_AFTER[spec.phase];
    if (subtotal !== undefined && schedule[index + 1]?.phase !== spec.phase) {
      rows.push({ kind: subtotal });
    }
  });
  rows.push({ kind: 'jokers' }, { kind: 'final' });
  return rows;
}

const PLAYER_COUNTS = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, i) => MIN_PLAYERS + i,
);

/** Ширина аркуша A4 без полів (210 − 2 × 10 мм) у CSS-пікселях. */
const PAGE_WIDTH_PX = (190 * 96) / 25.4;

/**
 * Порожня таблиця для гри на папері (T64): вибір N і «Темної», прев'ю аркуша й друк
 * через браузер (`window.print`, можна зберегти в PDF). Кімната не потрібна.
 */
export function PrintSheet({ onBack }: { onBack: () => void }) {
  const [playerCount, setPlayerCount] = useState(MIN_PLAYERS);
  const [dark, setDark] = useState(false);
  const darkHint = useId();
  const preview = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  // На вузькому екрані прев'ю аркуша зменшується, а не прокручується вбік.
  useEffect(() => {
    const element = preview.current;
    if (element === null || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      setZoom(Math.min(1, element.clientWidth / PAGE_WIDTH_PX));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="print-sheet">
      <div className="print-setup">
        <h2 className="print-setup__title">{uk.print.title}</h2>
        <p className="print-setup__hint muted">{uk.print.hint}</p>
        <fieldset className="print-setup__count">
          <legend>{uk.print.players}</legend>
          {PLAYER_COUNTS.map((n) => (
            <label key={n} className="print-setup__radio">
              <input
                type="radio"
                name="print-players"
                value={n}
                checked={playerCount === n}
                onChange={() => setPlayerCount(n)}
              />
              <span>{n}</span>
            </label>
          ))}
        </fieldset>
        <label className="option">
          <input
            type="checkbox"
            role="switch"
            className="option__input"
            checked={dark}
            aria-describedby={darkHint}
            onChange={(event) => setDark(event.target.checked)}
          />
          <span className="option__text">
            <span className="option__label">{uk.print.dark}</span>
            <span id={darkHint} className="option__hint muted">
              {uk.room.darkHint}
            </span>
          </span>
        </label>
        <div className="print-setup__actions">
          <button type="button" className="button" onClick={onBack}>
            {uk.print.back}
          </button>
          <button type="button" className="button button--primary" onClick={() => window.print()}>
            {uk.print.print}
          </button>
        </div>
      </div>
      <div ref={preview} className="print-preview">
        <div className="print-page" style={{ zoom }}>
          <PrintTable playerCount={playerCount} dark={dark} />
        </div>
      </div>
    </div>
  );
}

/** Етапи, які позначаються літерою замість кількості карт — як у таблиці гри (`ScoreSheet`). */
const PHASE_MARKS = ['noTrump', 'dark', 'misere', 'comeback'] as const;
type MarkedPhase = (typeof PHASE_MARKS)[number];

function isMarked(phase: HandPhase): phase is MarkedPhase {
  return (PHASE_MARKS as readonly HandPhase[]).includes(phase);
}

/** Клітинка «Карти»: кількість, у «Мастях» — з мастю козиря, інакше — літера етапу. */
function cardsLabel(row: Extract<PrintRow, { kind: 'hand' }>): ReactNode {
  if (isMarked(row.phase)) return uk.sheet.marks[row.phase];
  if (row.trump === null || row.trump === 'none') return row.cards;
  return (
    <>
      {row.cards} <SuitMark suit={row.trump} />
    </>
  );
}

function PrintTable({ playerCount, dark }: { playerCount: number; dark: boolean }) {
  const rows = buildPrintRows(playerCount, dark);
  const seats = Array.from({ length: playerCount }, (_, seat) => seat);
  const playerCells = (key: string) =>
    seats.flatMap((seat) => [
      <td key={`${key}-${seat}-bid`} className="print-table__cell" />,
      <td key={`${key}-${seat}-points`} className="print-table__cell" />,
    ]);
  // Легенда — лише для літер, що є в таблиці (R-10.2: «Темна» — тільки з опцією).
  const marks = PHASE_MARKS.filter((phase) =>
    rows.some((row) => row.kind === 'hand' && row.phase === phase),
  );

  return (
    <>
      <table className="print-table" aria-label={uk.print.title} data-players={playerCount}>
        <colgroup>
          <col className="print-table__col--number" />
          <col className="print-table__col--cards" />
          {seats.flatMap((seat) => [
            <col key={`${seat}-bid`} className="print-table__col--player" />,
            <col key={`${seat}-points`} className="print-table__col--player" />,
          ])}
        </colgroup>
        <thead>
          <tr className="print-table__names">
            <th scope="col" rowSpan={2}>
              {uk.print.number}
            </th>
            <th scope="col" rowSpan={2}>
              {uk.print.cards}
            </th>
            {seats.map((seat) => (
              <th
                key={seat}
                scope="colgroup"
                colSpan={2}
                className="print-table__name"
                aria-label={uk.print.name(seat + 1)}
              />
            ))}
          </tr>
          <tr>
            {seats.flatMap((seat) => [
              <th key={`${seat}-bid`} scope="col" aria-label={uk.print.bid}>
                {uk.print.bidText}
              </th>,
              <th key={`${seat}-points`} scope="col">
                {uk.print.points}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) =>
            row.kind === 'hand' ? (
              <tr key={index} className="print-table__hand" data-phase={row.phase}>
                <td className="print-table__number">{row.number}</td>
                <th scope="row" className="print-table__cards" title={phaseName(row.phase)}>
                  {cardsLabel(row)}
                </th>
                {playerCells(String(index))}
              </tr>
            ) : (
              <tr key={index} className="print-table__total" data-kind={row.kind}>
                <th scope="row" colSpan={2} className="print-table__label">
                  {uk.print[row.kind]}
                </th>
                {playerCells(String(index))}
              </tr>
            ),
          )}
        </tbody>
      </table>
      <p className="print-legend">{marks.map((phase) => uk.print.legend[phase]).join(' · ')}</p>
    </>
  );
}
