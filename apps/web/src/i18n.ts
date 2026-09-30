import type { Card, HandPhase, Rank, Suit } from '@poker/engine';

/** Форми іменника для 1, 2–4 і 5+ (українська множина). */
export type PluralForms = readonly [one: string, few: string, many: string];

/** Усі тексти інтерфейсу українською. */
export const uk = {
  appTitle: 'Розписний покер',
  theme: {
    toLight: 'Світла тема',
    toDark: 'Темна тема',
  },
  home: {
    tagline: 'Карткова гра на 3–6 гравців. Грайте з друзями або з ботами.',
  },
  card: {
    joker: 'Джокер',
    back: 'Сорочка карти',
  },
  noTrump: 'б/к',
  plural: {
    trick: ['взятка', 'взятки', 'взяток'],
    card: ['карта', 'карти', 'карт'],
    player: ['гравець', 'гравці', 'гравців'],
  },
} as const satisfies Record<string, unknown>;

const RANK_LABELS: Record<Rank, string> = {
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'В',
  12: 'Д',
  13: 'К',
  14: 'Т',
};

const RANK_NAMES: Record<Rank, string> = {
  6: 'Шістка',
  7: 'Сімка',
  8: 'Вісімка',
  9: 'Девʼятка',
  10: 'Десятка',
  11: 'Валет',
  12: 'Дама',
  13: 'Король',
  14: 'Туз',
};

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
};

const SUIT_NAMES: Record<Suit, string> = {
  spades: 'піка',
  clubs: 'трефа',
  diamonds: 'бубна',
  hearts: 'чирва',
};

/** Родовий відмінок масті: «туз піки». */
const SUIT_GENITIVE: Record<Suit, string> = {
  spades: 'піки',
  clubs: 'трефи',
  diamonds: 'бубни',
  hearts: 'чирви',
};

const PHASE_NAMES: Record<HandPhase, string> = {
  ascending: 'Зростання',
  maximum: 'Максимум',
  suits: 'Масті',
  noTrump: 'Безкозирка',
  misere: 'Мізер',
  comeback: 'Відіграш',
};

/** Коротке позначення рангу (R-1.1): 6…10, В, Д, К, Т. */
export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank];
}

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

export function suitName(suit: Suit): string {
  return SUIT_NAMES[suit];
}

/** Повна назва карти для доступності: «Дама чирви», «Джокер». */
export function cardName(card: Card): string {
  if (card.kind === 'joker') return uk.card.joker;
  return `${RANK_NAMES[card.rank]} ${SUIT_GENITIVE[card.suit]}`;
}

/** Назва етапу гри (R-2.1). */
export function phaseName(phase: HandPhase): string {
  return PHASE_NAMES[phase];
}

/** Козир роздачі або «б/к» (R-3.2, R-3.4). */
export function trumpLabel(trump: Suit | null): string {
  return trump === null ? uk.noTrump : `${suitSymbol(trump)} ${suitName(trump)}`;
}

/** Форма іменника для числа `n`: 1 взятка, 3 взятки, 5 взяток, 21 взятка. */
export function plural(n: number, [one, few, many]: PluralForms): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
