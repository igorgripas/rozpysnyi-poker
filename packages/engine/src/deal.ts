import { type Card, DECK_SIZE, maxCardsPerHand } from './cards.js';

export interface DealResult {
  /** Руки гравців за порядком місць. */
  readonly hands: Card[][];
  /** Решта колоди в початковому порядку; `rest[0]` — верхня карта. */
  readonly rest: Card[];
}

/**
 * Роздає карти з (уже перетасованої) колоди по одній кожному гравцю по колу (R-2.3).
 * Кількість карт на руку — від 1 до MAX (R-1.3).
 */
export function deal(deck: readonly Card[], playerCount: number, cardsPerHand: number): DealResult {
  const max = maxCardsPerHand(playerCount);
  if (!Number.isInteger(cardsPerHand) || cardsPerHand < 1 || cardsPerHand > max) {
    throw new RangeError(
      `Кількість карт на руку має бути від 1 до ${max}, отримано ${cardsPerHand}`,
    );
  }
  if (deck.length !== DECK_SIZE) {
    throw new RangeError(`Колода має містити ${DECK_SIZE} карт, отримано ${deck.length}`);
  }
  const hands = Array.from({ length: playerCount }, (_, seat) =>
    Array.from({ length: cardsPerHand }, (_, round) => deck[round * playerCount + seat] as Card),
  );
  const dealt = playerCount * cardsPerHand;
  return { hands, rest: deck.slice(dealt) };
}
