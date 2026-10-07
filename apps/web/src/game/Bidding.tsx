import type { WirePlayerView } from '@poker/protocol';
import { useId } from 'react';
import { uk } from '../i18n';

export interface BiddingProps {
  view: WirePlayerView;
  nameOf: (seat: number) => string;
  /** Замовлення надіслано, сервер ще не надіслав новий стан: кнопки вимкнені. */
  disabled?: boolean;
  onBid: (bid: number) => void;
}

type QueueState = 'bid' | 'turn' | 'waiting';

/**
 * Замовлення (R-4.2–R-4.5): черга замовлень у порядку ходу з уже зробленими замовленнями,
 * сума й заборонене для роздаючого значення; на своєму ході — кнопки 0…K, де заборонене
 * значення вимкнене й пояснене. У роздачах з 1–3 картами заборони немає (R-4.6).
 * Четвертий нуль поспіль (опція R-10.3) теж вимкнений і пояснений.
 */
export function Bidding({ view, nameOf, disabled = false, onBid }: BiddingProps) {
  const hintId = useId();
  const zeroHintId = useId();
  const cards = view.spec.cards;
  const legal = new Set(
    view.legalActions.flatMap((action) => (action.type === 'bid' ? [action.bid] : [])),
  );
  const myTurn = view.turn === view.seat && legal.size > 0;
  const forbidden = view.turn === view.dealer ? view.forbiddenBid : null;

  /** Пояснення вимкненого значення: R-4.4 для роздаючого, R-10.3 для нуля. */
  function describedBy(bid: number): string | undefined {
    const ids = [bid === forbidden && hintId, bid === 0 && view.zeroForbidden && zeroHintId].filter(
      Boolean,
    );
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

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
              <span className="bid-queue__line">
                <span className="bid-queue__value" aria-hidden="true">
                  {bid !== null ? bid : state === 'turn' ? '?' : '—'}
                </span>
                {seat === view.dealer && <DealerMark />}
              </span>
              <span className="sr-only">
                {bid !== null
                  ? uk.bidding.made(bid)
                  : state === 'turn'
                    ? uk.bidding.turn
                    : uk.bidding.waiting}
              </span>
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
      {myTurn && view.zeroForbidden && (
        <p id={zeroHintId} className="bidding__hint">
          {uk.bidding.zeroForbidden}
        </p>
      )}
      {myTurn && (
        <div role="group" aria-label={uk.bidding.yours} className="bidding__options">
          {Array.from({ length: cards + 1 }, (_, bid) => (
            <button
              key={bid}
              type="button"
              className="button bidding__option"
              disabled={disabled || !legal.has(bid)}
              aria-describedby={describedBy(bid)}
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

/**
 * Компактна позначка роздаючого в черзі: колода з двох карт поруч зі значенням замовлення.
 * Текст «роздає» не вміщується в клітинку на 360px при 6 гравцях, тож він — доступна назва.
 */
function DealerMark() {
  return (
    <svg className="bid-queue__dealer" viewBox="0 0 16 16" role="img" aria-label={uk.game.dealer}>
      <title>{uk.game.dealer}</title>
      <rect x="1.5" y="3.5" width="8" height="11" rx="1.5" />
      <rect x="6.5" y="1.5" width="8" height="11" rx="1.5" />
    </svg>
  );
}
