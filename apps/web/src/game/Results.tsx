import type { WirePlayerView } from '@poker/protocol';
import { formatScore } from '@poker/engine';
import { uk } from '../i18n';
import { ScoreSheet } from './ScoreSheet';

export interface ResultsProps {
  view: WirePlayerView;
  names: readonly string[];
  /** Відкрити звіт про баг (T52). */
  onReportBug: () => void;
  /** «Нова гра»: вийти з кімнати на головну (T180). */
  onNewGame: () => void;
}

/**
 * Фінальний екран: привітання переможця (за рівних підсумків — усіх, R-9.4), підсумки
 * гравців від найбільшого (R-8.4) і вся таблиця гри.
 */
export function Results({ view, names, onReportBug, onNewGame }: ResultsProps) {
  const ranking = view.table.summary
    .map((summary, seat) => ({ seat, final: summary.final }))
    .sort((a, b) => b.final - a.final);
  const best = ranking[0]?.final ?? 0;
  const winners = ranking
    .filter(({ final }) => final === best)
    .map(({ seat }) => names[seat] ?? `#${seat + 1}`);

  return (
    <div className="results">
      <section className="results__summary panel" aria-label={uk.sheet.results}>
        <h2 className="results__title">{uk.game.finished}</h2>
        <h3 className="results__winner">
          <span className="results__trophy" aria-hidden="true">
            🏆
          </span>{' '}
          {uk.results.winner(winners, best < 0 ? formatScore(best) : String(best), best)}
        </h3>
        <ul className="results__list">
          {ranking.map(({ seat, final }) => (
            <li key={seat} className="results__item" data-you={seat === view.seat || undefined}>
              <span className="results__name">{names[seat] ?? `#${seat + 1}`}</span>
              <strong>{final < 0 ? formatScore(final) : final}</strong>
            </li>
          ))}
        </ul>
        <button type="button" className="button button--primary results__new" onClick={onNewGame}>
          {uk.results.newGame}
        </button>
      </section>
      <ScoreSheet table={view.table} names={names} />
      <button type="button" className="button bug-report-button" onClick={onReportBug}>
        {uk.bugReport.open}
      </button>
    </div>
  );
}
