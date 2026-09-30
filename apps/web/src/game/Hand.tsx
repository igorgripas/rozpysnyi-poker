import { type Card, SUITS, cardId } from '@poker/engine';
import { type CSSProperties, useState } from 'react';
import { cardName, uk } from '../i18n';
import { CardFace } from '../ui/Card';

/** Порядок у руці: джокери, далі масті ♠ ♣ ♦ ♥, у масті — від старшої карти. */
function sortKey(card: Card): number {
  return card.kind === 'joker' ? -1 : SUITS.indexOf(card.suit) * 100 - card.rank;
}

export interface HandProps {
  cards: readonly Card[];
  /** Ідентифікатори карт, якими можна зіграти зараз; `null` — не ваш хід. */
  legal: ReadonlySet<string> | null;
  onPlay: (card: Card) => void;
}

/** Рука гравця: тап — вибрати карту, другий тап — зіграти; нелегальні карти приглушені. */
export function Hand({ cards, legal, onPlay }: HandProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = [...cards].sort((a, b) => sortKey(a) - sortKey(b));
  // Вибір діє, лише поки карта легальна: після ходу чи зміни взятки він скидається сам.
  const selected = selectedId !== null && legal?.has(selectedId) ? selectedId : null;

  return (
    <ul
      className="hand"
      aria-label={uk.game.yourCards}
      style={{ '--hand-size': sorted.length } as CSSProperties}
    >
      {sorted.map((card) => {
        const id = cardId(card);
        const isLegal = legal === null ? null : legal.has(id);
        return (
          <li key={id} className="hand__slot">
            <button
              type="button"
              className="hand__card"
              aria-label={cardName(card)}
              aria-pressed={selected === id}
              data-card={id}
              data-legal={isLegal === null ? undefined : String(isLegal)}
              disabled={isLegal !== true}
              onClick={() => {
                if (selected === id) onPlay(card);
                else setSelectedId(id);
              }}
            >
              <CardFace card={card} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
