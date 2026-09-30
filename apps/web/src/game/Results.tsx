import type { WirePlayerView } from '@poker/protocol';
import { formatScore } from '@poker/engine';
import { uk } from '../i18n';
import { ScoreSheet } from './ScoreSheet';

export interface ResultsProps {
  view: WirePlayerView;
  names: readonly string[];
}

/** Фінальний екран: підсумки гравців від найбільшого (R-8.4) і вся таблиця гри. */
export function Results({ view, names }: ResultsProps) {
  const ranking = view.table.summary
    .map((summary, seat) => ({ seat, final: summary.final }))
    .sort((a, b) => b.final - a.final);

  return (
    <div className="results">
      <section className="results__summary panel" aria-label={uk.sheet.results}>
        <h2 className="results__title">{uk.game.finished}</h2>
        <ul className="results__list">
          {ranking.map(({ seat, final }) => (
            <li key={seat} className="results__item" data-you={seat === view.seat || undefined}>
              <span className="results__name">{names[seat] ?? `#${seat + 1}`}</span>
              <strong>{final < 0 ? formatScore(final) : final}</strong>
            </li>
          ))}
        </ul>
      </section>
      <ScoreSheet table={view.table} names={names} />
    </div>
  );
}
