import type { Card, Suit } from '@poker/engine';
import { cardName, rankLabel, suitSymbol, uk } from '../i18n';

// Карти малюються як SVG 60×84 (пропорції 5:7), розмір задає CSS через ширину.

const RED_SUITS: ReadonlySet<Suit> = new Set(['diamonds', 'hearts']);

type CardColor = 'red' | 'black' | 'joker';

function colorOf(card: Card): CardColor {
  if (card.kind === 'joker') return 'joker';
  return RED_SUITS.has(card.suit) ? 'red' : 'black';
}

export interface CardFaceProps {
  card: Card;
  className?: string;
}

/** Лицьова сторона карти. */
export function CardFace({ card, className }: CardFaceProps) {
  const color = colorOf(card);
  const corner = card.kind === 'joker' ? '★' : rankLabel(card.rank);
  const symbol = card.kind === 'joker' ? '' : suitSymbol(card.suit);
  return (
    <svg
      className={['card', className].filter(Boolean).join(' ')}
      viewBox="0 0 60 84"
      role="img"
      aria-label={cardName(card)}
      data-color={color}
    >
      <rect className="card__paper" x="0.5" y="0.5" width="59" height="83" rx="5" />
      <g className="card__ink" aria-hidden="true">
        <text className="card__corner" x="5" y="15">
          {corner}
        </text>
        <text className="card__corner-suit" x="5" y="26">
          {symbol}
        </text>
        {card.kind === 'joker' ? (
          <>
            <text className="card__joker-star" x="30" y="50" textAnchor="middle">
              ★
            </text>
            <text className="card__joker-label" x="30" y="70" textAnchor="middle">
              {uk.card.joker}
            </text>
          </>
        ) : (
          <text className="card__pip" x="30" y="55" textAnchor="middle">
            {symbol}
          </text>
        )}
        <text className="card__corner" x="55" y="78" textAnchor="end">
          {corner}
        </text>
      </g>
    </svg>
  );
}

/** Сорочка карти: чужі карти й колода. */
export function CardBack({ className }: { className?: string }) {
  return (
    <svg
      className={['card', 'card--back', className].filter(Boolean).join(' ')}
      viewBox="0 0 60 84"
      role="img"
      aria-label={uk.card.back}
    >
      <rect className="card__paper" x="0.5" y="0.5" width="59" height="83" rx="5" />
      <rect className="card__pattern" x="5" y="5" width="50" height="74" rx="3" />
    </svg>
  );
}
