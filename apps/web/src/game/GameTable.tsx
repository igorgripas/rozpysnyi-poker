import { type Card, type JokerCall, cardId, createSchedule } from '@poker/engine';
import type { RoomState, WireAction, WirePlayerView } from '@poker/protocol';
import { useRef, useState } from 'react';
import { jokerCallLabel, phaseName, plural, trumpLabel, uk } from '../i18n';
import type { ClientError } from '../net/connection';
import { useClient } from '../net/react';
import { CardFace } from '../ui/Card';
import { useTurnVibration } from '../ui/vibration';
import { Bidding } from './Bidding';
import { Hand } from './Hand';
import { JokerDialog } from './JokerDialog';
import { Results } from './Results';
import { SheetDialog } from './SheetDialog';

export interface GameTableProps {
  room: RoomState;
  view: WirePlayerView;
}

type PlayAction = Extract<WireAction, { type: 'play' }>;

/** Ігровий стіл: роздача, гравці, взятка на столі й рука. */
export function GameTable({ room, view }: GameTableProps) {
  const client = useClient();
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pending = useRef(false);
  const names = room.seats.map((seat) => seat.name);
  const nameOf = (seat: number) => names[seat] ?? `#${seat + 1}`;
  const total = createSchedule(view.playerCount).length;

  const yourTurn = view.status !== 'finished' && view.turn === view.seat;
  useTurnVibration(yourTurn);

  const plays = view.legalActions.filter((action): action is PlayAction => action.type === 'play');
  const legal =
    view.status === 'playing' && view.turn === view.seat
      ? new Set(plays.map((action) => cardId(action.card)))
      : null;

  /** Надсилає дію гравця; повторна дія, поки сервер не відповів, ігнорується. */
  async function send(request: () => Promise<ClientError | null>) {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    const failure = await request();
    pending.current = false;
    if (failure !== null) setError(failure.message);
  }

  function play(card: Card, call?: JokerCall) {
    setJoker(null);
    void send(() => client.send('game:play', { card, ...(call !== undefined && { call }) }));
  }

  // Джокер спершу відкриває діалог оголошення (§6).
  const [joker, setJoker] = useState<Card | null>(null);
  const jokerCalls =
    legal === null || joker === null
      ? []
      : plays.flatMap((action) =>
          cardId(action.card) === cardId(joker) && action.call !== undefined ? [action.call] : [],
        );

  if (view.status === 'finished') return <Results view={view} names={names} />;

  // Суперники за годинниковою стрілкою від вас, ви — останні.
  const order = Array.from(
    { length: view.playerCount },
    (_, i) => (view.seat + 1 + i) % view.playerCount,
  );

  // R-9.2: остання взятка лишається на столі, поки не покладуть першу карту наступної.
  const showLast = view.trick.length === 0 && view.lastTrick !== null;
  const trick = showLast ? (view.lastTrick?.cards ?? []) : view.trick;
  const trickLeader = showLast ? (view.lastTrick?.leader ?? 0) : view.leader;

  return (
    <div className="game">
      <section className="game__info panel" aria-label={uk.game.hand}>
        <div className="game__facts">
          <span>{uk.game.handOf(view.spec.index + 1, total)}</span>
          <span>{phaseName(view.spec.phase)}</span>
          <span>
            {view.spec.cards} {plural(view.spec.cards, uk.plural.card)}
          </span>
          <strong>{uk.game.trump(trumpLabel(view.trump))}</strong>
          {view.spec.bidding && <span>{uk.bidding.sum(view.bidSum, view.spec.cards)}</span>}
        </div>
        <button
          type="button"
          className="button game__sheet"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
        >
          {uk.sheet.open}
        </button>
        {view.revealed !== null && (
          <figure className="game__revealed">
            <CardFace card={view.revealed} className="card--small" />
            <figcaption className="muted">{uk.game.revealed}</figcaption>
          </figure>
        )}
      </section>

      <p role="status" className="game__turn">
        {turnText(view, nameOf)}
      </p>

      <ul className="players" aria-label={uk.game.players}>
        {order.map((seat) => (
          <li
            key={seat}
            className="player"
            aria-current={view.turn === seat ? 'true' : undefined}
            data-you={seat === view.seat || undefined}
          >
            <span className="player__name">{nameOf(seat)}</span>
            <span className="player__badges">
              {seat === view.seat && <span className="badge badge--accent">{uk.game.you}</span>}
              {seat === view.dealer && <span className="badge">{uk.game.dealer}</span>}
              {room.seats[seat]?.connected === false && (
                <span className="badge badge--muted">{uk.game.offline}</span>
              )}
            </span>
            <span className="player__stats">
              {view.spec.bidding && <span>{uk.game.bid(view.bids[seat] ?? null)}</span>}
              <span>{uk.game.taken(view.taken[seat] ?? 0)}</span>
              {seat !== view.seat && <span>{uk.game.cardsLeft(view.handSizes[seat] ?? 0)}</span>}
            </span>
          </li>
        ))}
      </ul>

      {view.status === 'bidding' && (
        <Bidding view={view} onBid={(bid) => void send(() => client.send('game:bid', { bid }))} />
      )}

      <section className="felt" aria-label={uk.game.table}>
        {showLast && view.lastTrick !== null && (
          <p className="felt__caption">{uk.game.lastTrick(nameOf(view.lastTrick.winner))}</p>
        )}
        <div className={['felt__trick', showLast && 'felt__trick--last'].filter(Boolean).join(' ')}>
          {trick.map((played, position) => {
            const seat = (trickLeader + position) % view.playerCount;
            return (
              <figure key={cardId(played)} className="felt__card">
                <CardFace card={played} />
                <figcaption>
                  {nameOf(seat)}
                  {played.kind === 'joker' && (
                    <span className="felt__call"> · {jokerCallLabel(played.call)}</span>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <Hand
        cards={view.hand}
        legal={legal}
        onPlay={(card) => (card.kind === 'joker' ? setJoker(card) : play(card))}
      />

      {sheetOpen && (
        <SheetDialog table={view.table} names={names} onClose={() => setSheetOpen(false)} />
      )}

      {joker !== null && jokerCalls.length > 0 && (
        <JokerDialog
          calls={jokerCalls}
          onChoose={(call) => play(joker, call)}
          onCancel={() => setJoker(null)}
        />
      )}
    </div>
  );
}

function turnText(view: WirePlayerView, nameOf: (seat: number) => string): string {
  if (view.status === 'finished' || view.turn === null) return uk.game.finished;
  if (view.turn !== view.seat) return uk.game.turnOf(nameOf(view.turn));
  return view.status === 'bidding' ? uk.game.yourBid : uk.game.yourTurn;
}
