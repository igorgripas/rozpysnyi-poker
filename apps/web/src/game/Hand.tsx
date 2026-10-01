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
  /** Змінюється, коли вибір треба скинути ззовні (напр. скасовано діалог джокера). */
  resetKey?: number;
}

/** Рука гравця: тап — вибрати карту, другий тап — зіграти; нелегальні карти приглушені. */
export function Hand({ cards, legal, onPlay, resetKey = 0 }: HandProps) {
  const [selection, setSelection] = useState<{ id: string; turn: string } | null>(null);
  const sorted = [...cards].sort((a, b) => sortKey(a) - sortKey(b));
  // Вибір належить поточному ходу: рука, легальні карти й скидання ззовні. Коли хід
  // закінчився (legal = null) чи рука змінилась, вибір зникає — навіть для джокера,
  // який легальний завжди, тож інакше «переїжджав» би в наступний хід і грався з першого тапу.
  const turn = [
    resetKey,
    sorted.map(cardId).join(','),
    legal === null ? 'wait' : [...legal].sort().join(','),
  ].join('|');
  // Хід перейшов до іншого гравця: вибір не доживає до мого наступного ходу
  // (коригування стану під час рендеру — без ефекту й зайвого кадру).
  const waiting = legal === null;
  const [wasWaiting, setWasWaiting] = useState(waiting);
  if (waiting !== wasWaiting) {
    setWasWaiting(waiting);
    if (waiting) setSelection(null);
  }
  const selected =
    selection !== null && selection.turn === turn && legal?.has(selection.id) ? selection.id : null;

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
                else setSelection({ id, turn });
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
