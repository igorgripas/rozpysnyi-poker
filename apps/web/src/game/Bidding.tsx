import type { WirePlayerView } from '@poker/protocol';
import { useId } from 'react';
import { uk } from '../i18n';

export interface BiddingProps {
  view: WirePlayerView;
  onBid: (bid: number) => void;
}

/**
 * Замовлення (R-4.3–R-4.5): кнопки 0…K на своєму ході; заборонене для роздаючого
 * значення вимкнене й пояснене. Пояснення бачать усі, коли черга дійшла до роздаючого.
 */
export function Bidding({ view, onBid }: BiddingProps) {
  const hintId = useId();
  const cards = view.spec.cards;
  const legal = new Set(
    view.legalActions.flatMap((action) => (action.type === 'bid' ? [action.bid] : [])),
  );
  const myTurn = view.turn === view.seat && legal.size > 0;
  const forbidden = view.turn === view.dealer ? view.forbiddenBid : null;
  if (!myTurn && forbidden === null) return null;

  return (
    <section className="bidding panel" aria-label={uk.bidding.title}>
      {forbidden !== null && (
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
