import type { WirePlayerView } from '@poker/protocol';
import { useId } from 'react';
import { uk } from '../i18n';

export interface BiddingProps {
  view: WirePlayerView;
  nameOf: (seat: number) => string;
  onBid: (bid: number) => void;
}

type QueueState = 'bid' | 'turn' | 'waiting';

/**
 * Замовлення (R-4.2–R-4.5): черга замовлень у порядку ходу з уже зробленими замовленнями,
 * сума й заборонене для роздаючого значення; на своєму ході — кнопки 0…K, де заборонене
 * значення вимкнене й пояснене.
 */
export function Bidding({ view, nameOf, onBid }: BiddingProps) {
  const hintId = useId();
  const cards = view.spec.cards;
  const legal = new Set(
    view.legalActions.flatMap((action) => (action.type === 'bid' ? [action.bid] : [])),
  );
  const myTurn = view.turn === view.seat && legal.size > 0;
  const forbidden = view.turn === view.dealer ? view.forbiddenBid : null;

  // R-4.2: першим замовляє лівий сусіда роздаючого, роздаючий — останній.
  const queue = Array.from(
    { length: view.playerCount },
    (_, i) => (view.dealer + 1 + i) % view.playerCount,
  );

  return (
    <section className="bidding panel" aria-label={uk.bidding.title}>
      <ol className="bid-queue" aria-label={uk.bidding.queue}>
        {queue.map((seat) => {
          const bid = view.bids[seat] ?? null;
          const state: QueueState = bid !== null ? 'bid' : view.turn === seat ? 'turn' : 'waiting';
          return (
            <li
              key={seat}
              className="bid-queue__item"
              data-state={state}
              data-dealer={seat === view.dealer || undefined}
              aria-current={state === 'turn' ? 'true' : undefined}
            >
              <span className="bid-queue__name">{nameOf(seat)}</span>
              <span className="bid-queue__value" aria-hidden="true">
                {bid !== null ? bid : state === 'turn' ? '?' : '—'}
              </span>
              <span className="sr-only">
                {bid !== null
                  ? uk.bidding.made(bid)
                  : state === 'turn'
                    ? uk.bidding.turn
                    : uk.bidding.waiting}
              </span>
              {seat === view.dealer && <span className="bid-queue__dealer">{uk.game.dealer}</span>}
            </li>
          );
        })}
      </ol>
      <p className="bidding__summary">
        <span>{uk.bidding.queueSum(view.bidSum, cards)}</span>
        {forbidden !== null && (
          <strong className="bidding__forbidden">{uk.bidding.dealerCannot(forbidden)}</strong>
        )}
      </p>
      {myTurn && forbidden !== null && (
        <p id={hintId} className="bidding__hint">
          {uk.bidding.forbidden(forbidden, cards)}
        </p>
      )}
      {myTurn && (
        <div role="group" aria-label={uk.bidding.yours} className="bidding__options">
          {Array.from({ length: cards + 1 }, (_, bid) => (
            <button
              key={bid}
              type="button"
              className="button bidding__option"
              disabled={!legal.has(bid)}
              aria-describedby={bid === forbidden ? hintId : undefined}
              onClick={() => onBid(bid)}
            >
              {bid}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
