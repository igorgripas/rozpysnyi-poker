import { type Card, type JokerCall, type Suit, cardId, createSchedule } from '@poker/engine';
import type { RoomState, WireAction, WirePlayerView } from '@poker/protocol';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { phaseName, plural, suitName, uk } from '../i18n';
import type { ClientError } from '../net/connection';
import { useClient } from '../net/react';
import { CardFace } from '../ui/Card';
import { JokerCallLabel, SuitMark } from '../ui/SuitMark';
import { useGameSounds } from '../ui/sound';
import { useTurnVibration } from '../ui/vibration';
import { VoiceControls, useVoiceState } from '../voice/VoiceControls';
import { Bidding } from './Bidding';
import { BugReportDialog } from './BugReportDialog';
import { BlindHand, Hand } from './Hand';
import { JokerDialog } from './JokerDialog';
import { LeaveDialog } from './LeaveDialog';
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

/**
 * Місце відкритої карти в кутку столу (R-3.1), щоб на телефоні козир було видно разом із рукою:
 * сама карта розміром як у руці, а без неї — великий значок козиря (R-3.3) чи «Без козиря» (R-3.4),
 * щоб макет не стрибав між роздачами.
 */
function TrumpSlot({ revealed, trump }: { revealed: Card | null; trump: Suit | null }) {
  if (revealed !== null) {
    return (
      <figure className="game__revealed" aria-label={uk.game.revealed}>
        <CardFace card={revealed} />
      </figure>
    );
  }
  if (trump !== null) {
    return (
      <span
        className="game__revealed game__revealed--suit"
        role="img"
        aria-label={`${uk.game.trump} ${suitName(trump)}`}
      >
        <SuitMark suit={trump} />
      </span>
    );
  }
  return <span className="game__revealed game__revealed--none">{uk.game.noTrump}</span>;
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
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const pending = useRef(false);
  const names = room.seats.map((seat) => seat.name);
  const nameOf = (seat: number) => names[seat] ?? `#${seat + 1}`;
  const total = createSchedule(view.playerCount, view.options).length;

  const speaking = useVoiceState()?.speaking;
  const isHost = room.hostId === room.you;

  const yourTurn = view.status !== 'finished' && view.turn === view.seat;
  useTurnVibration(yourTurn);
  useGameSounds(latest, yourTurn);

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
  // Скасування оголошення джокера знімає вибір карти в руці.
  const [handReset, setHandReset] = useState(0);
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

  const bugReport = bugReportOpen && <BugReportDialog onClose={() => setBugReportOpen(false)} />;

  if (view.status === 'finished') {
    return (
      <>
        <Results
          view={view}
          names={names}
          onReportBug={() => setBugReportOpen(true)}
          onNewGame={() => void client.leave()}
        />
        {bugReport}
      </>
    );
  }

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
          <strong className="game__trump">
            {uk.game.trump}{' '}
            {view.trump === null ? (
              uk.noTrump
            ) : (
              <>
                <span className="game__trump-mark">
                  <SuitMark suit={view.trump} />
                </span>{' '}
                {suitName(view.trump)}
              </>
            )}
          </strong>
          {view.spec.bidding && <span>{uk.bidding.sum(view.bidSum, view.spec.cards)}</span>}
        </div>
        <div className="game__tools">
          <button
            type="button"
            className="button game__sheet"
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
          >
            {uk.sheet.open}
          </button>
          <VoiceControls />
        </div>
      </section>

      <div className="game__turn-row">
        <p role="status" className="game__turn">
          {handOver ? uk.game.handOver : turnText(view, nameOf)}
        </p>
        {!handOver && room.turnTimerSec !== null && room.turnDeadline !== null && (
          <TurnCountdown
            key={room.turnDeadline}
            deadline={room.turnDeadline}
            limitSec={room.turnTimerSec}
          />
        )}
      </div>

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
            data-speaking={speaking?.has(room.seats[seat]?.id ?? '') || undefined}
          >
            <span className="player__name">
              {nameOf(seat)}
              {room.seats[seat]?.away === true && (
                <span className="player__away"> {uk.game.away}</span>
              )}
              {speaking?.has(room.seats[seat]?.id ?? '') && (
                <span className="sr-only">, {uk.voice.speaking}</span>
              )}
            </span>
            <span className="player__badges">
              {seat === view.seat && <span className="badge badge--accent">{uk.game.you}</span>}
              {seat === view.dealer && <span className="badge">{uk.game.dealer}</span>}
              {seat === lastTaker && (
                <span className="badge badge--taker">{uk.game.lastTaker}</span>
              )}
              {room.seats[seat]?.connected === false && room.seats[seat].away !== true && (
                <span className="badge badge--muted">{uk.game.offline}</span>
              )}
            </span>
            {isHost && canReplace(room, seat) && (
              <button
                type="button"
                className="button player__replace"
                aria-label={uk.game.replaceWithBotLabel(nameOf(seat))}
                onClick={() => void send(() => client.send('room:replaceWithBot', { seat }))}
              >
                {uk.game.replaceWithBot}
              </button>
            )}
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
        <TrumpSlot revealed={view.revealed} trump={view.trump} />
        <div className="felt__play">
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
            role="group"
            aria-label={uk.game.trick}
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
                  className={['felt__card', winner && 'felt__card--winner']
                    .filter(Boolean)
                    .join(' ')}
                  data-winner={winner || undefined}
                >
                  <CardFace
                    card={played}
                    {...(lastTrick !== null && { className: 'card--small' })}
                  />
                  <figcaption>
                    {nameOf(seat)}
                    {played.kind === 'joker' && ' '}
                    {played.kind === 'joker' && (
                      <span className="felt__call">
                        <JokerCallLabel call={played.call} />
                      </span>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      </section>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {view.blind ? (
        <BlindHand count={view.handSizes[view.seat] ?? 0} />
      ) : (
        <Hand
          cards={view.hand}
          legal={legal}
          resetKey={handReset}
          onPlay={(card) => (card.kind === 'joker' ? setJoker(card) : play(card))}
        />
      )}

      <button type="button" className="button game__leave" onClick={() => setLeaveOpen(true)}>
        {uk.game.leave}
      </button>

      {leaveOpen && (
        <LeaveDialog onLeave={() => void client.leave()} onCancel={() => setLeaveOpen(false)} />
      )}

      {sheetOpen && (
        <SheetDialog
          table={view.table}
          names={names}
          onClose={() => setSheetOpen(false)}
          onReportBug={() => {
            setSheetOpen(false);
            setBugReportOpen(true);
          }}
        />
      )}

      {bugReport}

      {joker !== null && jokerCalls.length > 0 && (
        <JokerDialog
          calls={jokerCalls}
          onChoose={(call) => play(joker, call)}
          onCancel={() => {
            setJoker(null);
            setHandReset((n) => n + 1);
          }}
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

/** Хост може віддати боту місце іншого відключеного гравця-людини (R-9.3). */
function canReplace(room: RoomState, seat: number): boolean {
  const member = room.seats[seat];
  return member?.kind === 'human' && member.id !== room.hostId && !member.connected && !member.away;
}

/**
 * Відлік часу ходу (R-9.3). Годинник клієнта може розходитися із сервером, тому від дедлайну
 * береться лише залишок, і він не більший за сам таймер; далі відлік іде за локальним часом.
 */
function TurnCountdown({ deadline, limitSec }: { deadline: number; limitSec: number }) {
  // Новий дедлайн — новий екземпляр (`key`), тож кінець відліку рахується один раз.
  const [end] = useState(() => localDeadline(deadline, limitSec));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  return (
    <span
      role="timer"
      aria-label={uk.game.timeLeft}
      className="game__countdown"
      data-urgent={left <= 5 || undefined}
    >
      {uk.game.seconds(left)}
    </span>
  );
}

function localDeadline(deadline: number, limitSec: number): number {
  const now = Date.now();
  return now + Math.min(Math.max(0, deadline - now), limitSec * 1000);
}

function turnText(view: WirePlayerView, nameOf: (seat: number) => string): string {
  if (view.status === 'finished' || view.turn === null) return uk.game.finished;
  if (view.turn !== view.seat) return uk.game.turnOf(nameOf(view.turn));
  return view.status === 'bidding' ? uk.game.yourBid : uk.game.yourTurn;
}
