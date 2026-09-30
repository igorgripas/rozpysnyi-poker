import { type Card, type JokerCall, cardId, createSchedule } from '@poker/engine';
import type { RoomState, WireAction, WirePlayerView } from '@poker/protocol';
import { useLayoutEffect, useRef, useState } from 'react';
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
import { type TrickPause, useTrickPause } from './trickPause';

export interface GameTableProps {
  room: RoomState;
  view: WirePlayerView;
}

type PlayAction = Extract<WireAction, { type: 'play' }>;

/**
 * Що показати на час паузи взятки: лічильники «Взято» оновлюються, коли карти забирають.
 * Якщо взятка завершила роздачу, до кінця паузи показуємо стару роздачу з порожніми руками.
 */
function pausedView(shown: WirePlayerView, pause: TrickPause, handOver: boolean): WirePlayerView {
  const { before, trick, phase } = pause;
  const base: WirePlayerView = handOver
    ? {
        ...before,
        turn: null,
        hand: [],
        handSizes: before.handSizes.map(() => 0),
        legalActions: [],
      }
    : shown;
  const taken =
    phase === 'show'
      ? before.taken
      : before.taken.map((n, seat) => (seat === trick.winner ? n + 1 : n));
  return { ...base, taken, trick: [] };
}

/** Ігровий стіл: роздача, гравці, взятка на столі й рука. */
export function GameTable({ room, view: latest }: GameTableProps) {
  const { shown, pause, stale } = useTrickPause(latest);
  const handOver =
    pause !== null && (shown.status === 'finished' || shown.spec.index !== pause.before.spec.index);
  const view = pause === null ? shown : pausedView(shown, pause, handOver);
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
    view.status === 'playing' && view.turn === view.seat && !stale
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

  // Карти завершеної взятки їдуть до картки переможця.
  const trickRef = useRef<HTMLDivElement>(null);
  const seatRefs = useRef(new Map<number, HTMLLIElement>());
  useLayoutEffect(() => {
    if (pause?.phase !== 'collect') return;
    const target = seatRefs.current.get(pause.trick.winner)?.getBoundingClientRect();
    if (target === undefined) return;
    for (const card of trickRef.current?.querySelectorAll<HTMLElement>('.felt__card') ?? []) {
      const box = card.getBoundingClientRect();
      const dx = target.left + target.width / 2 - (box.left + box.width / 2);
      const dy = target.top + target.height / 2 - (box.top + box.height / 2);
      card.style.setProperty('--collect-x', `${dx}px`);
      card.style.setProperty('--collect-y', `${dy}px`);
    }
  }, [pause]);

  if (view.status === 'finished') return <Results view={view} names={names} />;

  // Суперники за годинниковою стрілкою від вас, ви — останні.
  const order = Array.from(
    { length: view.playerCount },
    (_, i) => (view.seat + 1 + i) % view.playerCount,
  );

  // У роздачі вже є взятки: наступну починає той, хто взяв попередню (R-5.1).
  const tricksTaken = view.taken.some((n) => n > 0);
  const lastTaker = pause !== null ? pause.trick.winner : tricksTaken ? view.leader : null;

  // R-9.2: остання взятка роздачі лишається на столі (згорнутою), поки не покладуть першу
  // карту наступної; у новій роздачі стіл чистий.
  const lastTrick =
    pause === null && view.trick.length === 0 && tricksTaken ? view.lastTrick : null;
  const shownTrick = pause?.trick ?? lastTrick;
  const trick = shownTrick?.cards ?? view.trick;
  const trickLeader = shownTrick?.leader ?? view.leader;
  let caption: string | null = null;
  if (pause !== null) {
    caption =
      pause.trick.winner === view.seat
        ? uk.game.youTake
        : uk.game.takes(nameOf(pause.trick.winner));
  } else if (lastTrick !== null) {
    caption = uk.game.lastTrick(nameOf(lastTrick.winner));
  }

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
        {handOver ? uk.game.handOver : turnText(view, nameOf)}
      </p>

      <ul className="players" aria-label={uk.game.players}>
        {order.map((seat) => (
          <li
            key={seat}
            ref={(item) => {
              if (item === null) seatRefs.current.delete(seat);
              else seatRefs.current.set(seat, item);
            }}
            className="player"
            aria-current={view.turn === seat ? 'true' : undefined}
            data-you={seat === view.seat || undefined}
            data-last-taker={seat === lastTaker || undefined}
          >
            <span className="player__name">{nameOf(seat)}</span>
            <span className="player__badges">
              {seat === view.seat && <span className="badge badge--accent">{uk.game.you}</span>}
              {seat === view.dealer && <span className="badge">{uk.game.dealer}</span>}
              {seat === lastTaker && (
                <span className="badge badge--taker">{uk.game.lastTaker}</span>
              )}
              {room.seats[seat]?.connected === false && (
                <span className="badge badge--muted">{uk.game.offline}</span>
              )}
            </span>
            {view.spec.bidding && <PlayerBid bid={view.bids[seat] ?? null} />}
            <span className="player__stats">
              <span>{uk.game.taken(view.taken[seat] ?? 0)}</span>
              {seat !== view.seat && <span>{uk.game.cardsLeft(view.handSizes[seat] ?? 0)}</span>}
            </span>
          </li>
        ))}
      </ul>

      {view.status === 'bidding' && (
        <Bidding
          view={view}
          nameOf={nameOf}
          onBid={(bid) => void send(() => client.send('game:bid', { bid }))}
        />
      )}

      <section className="felt" aria-label={uk.game.table}>
        {caption !== null && (
          <p
            className={['felt__caption', pause !== null && 'felt__caption--takes']
              .filter(Boolean)
              .join(' ')}
          >
            {caption}
          </p>
        )}
        <div
          ref={trickRef}
          className={[
            'felt__trick',
            lastTrick !== null && 'felt__trick--last',
            pause !== null && 'felt__trick--taken',
            pause?.phase === 'collect' && 'felt__trick--collect',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {trick.map((played, position) => {
            const seat = (trickLeader + position) % view.playerCount;
            const winner = pause !== null && seat === pause.trick.winner;
            return (
              <figure
                key={cardId(played)}
                className={['felt__card', winner && 'felt__card--winner'].filter(Boolean).join(' ')}
                data-winner={winner || undefined}
              >
                <CardFace card={played} {...(lastTrick !== null && { className: 'card--small' })} />
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

/** Замовлення в картці гравця: велика цифра; до замовлення — порожній стан, не схожий на нуль. */
function PlayerBid({ bid }: { bid: number | null }) {
  return (
    <span className="player__bid" data-empty={bid === null || undefined}>
      <span className="player__bid-label">{uk.game.bid}</span>
      <span className="player__bid-value" aria-hidden={bid === null || undefined}>
        {bid ?? '—'}
      </span>
      {bid === null && <span className="sr-only">{uk.game.noBid}</span>}
    </span>
  );
}

function turnText(view: WirePlayerView, nameOf: (seat: number) => string): string {
  if (view.status === 'finished' || view.turn === null) return uk.game.finished;
  if (view.turn !== view.seat) return uk.game.turnOf(nameOf(view.turn));
  return view.status === 'bidding' ? uk.game.yourBid : uk.game.yourTurn;
}
