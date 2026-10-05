import { useId } from 'react';
import { uk } from '../i18n';
import type { UnfinishedGame } from '../net/client';
import { useClient, useClientState } from '../net/react';

/** Ігри, з яких гравець вийшов посеред гри (T180): за нього ходить бот, повернутися можна. */
export function UnfinishedGames() {
  const { unfinished } = useClientState();
  if (unfinished.length === 0) return null;
  return (
    <section className="unfinished panel" aria-label={uk.home.unfinished}>
      <h2 className="unfinished__title">{uk.home.unfinished}</h2>
      <ul className="unfinished__list">
        {unfinished.map((game) => (
          <UnfinishedItem key={game.code} game={game} />
        ))}
      </ul>
    </section>
  );
}

function UnfinishedItem({ game }: { game: UnfinishedGame }) {
  const client = useClient();
  const titleId = useId();
  const playersId = useId();
  return (
    <li className="unfinished__item" aria-labelledby={titleId} aria-describedby={playersId}>
      <span className="unfinished__text">
        <strong id={titleId}>{uk.home.unfinishedGame(game.code)}</strong>
        <span id={playersId} className="unfinished__players muted">
          {game.players.join(', ')}
        </span>
      </span>
      <button
        type="button"
        className="button button--primary"
        aria-describedby={titleId}
        onClick={() => void client.resume(game.code)}
      >
        {uk.home.returnToGame}
      </button>
    </li>
  );
}
