/** Масті в порядку R-1.1 (і R-2.1, роздачі «Масті»): ♠ піка, ♣ трефа, ♦ бубна, ♥ чирва. */
export const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'] as const;
export type Suit = (typeof SUITS)[number];

/** Ранги від молодшого до старшого (R-1.1): 6…10, В=11, Д=12, К=13, Т=14. */
export const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type Rank = (typeof RANKS)[number];

export interface StandardCard {
  readonly kind: 'standard';
  readonly suit: Suit;
  readonly rank: Rank;
}

export interface JokerCard {
  readonly kind: 'joker';
  /** Розрізняє два джокери колоди. */
  readonly index: 0 | 1;
}

export type Card = StandardCard | JokerCard;

/** Повний розмір колоди (R-1.1): 36 карт + 2 джокери. */
export const DECK_SIZE = 38;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

export function isJoker(card: Card): card is JokerCard {
  return card.kind === 'joker';
}

/** Порівнює ранги за старшинством R-1.1: > 0, якщо `a` старша. */
export function compareRank(a: Rank, b: Rank): number {
  return a - b;
}

/** Стабільний рядковий ідентифікатор карти, напр. `hearts-14`, `joker-0`. */
export function cardId(card: Card): string {
  return isJoker(card) ? `joker-${card.index}` : `${card.suit}-${card.rank}`;
}

/** Нова неперетасована колода (R-1.1): масті по черзі, у кожній ранги за зростанням, потім джокери. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ kind: 'standard', suit, rank });
  }
  deck.push({ kind: 'joker', index: 0 }, { kind: 'joker', index: 1 });
  return deck;
}

/** Перевіряє кількість гравців (R-1.2): ціле від 3 до 6. */
export function assertPlayerCount(playerCount: number): void {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new RangeError(
      `Кількість гравців має бути від ${MIN_PLAYERS} до ${MAX_PLAYERS}, отримано ${playerCount}`,
    );
  }
}

/** Перевіряє номер місця за столом з `playerCount` гравців: ціле від 0 до N−1. */
export function assertSeat(seat: number, playerCount: number, label = 'Місце'): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount) {
    throw new RangeError(`${label} має бути від 0 до ${playerCount - 1}, отримано ${seat}`);
  }
}

/** Максимальна кількість карт на руку (R-1.3): `floor(38 / N)`. */
export function maxCardsPerHand(playerCount: number): number {
  assertPlayerCount(playerCount);
  return Math.floor(DECK_SIZE / playerCount);
}
