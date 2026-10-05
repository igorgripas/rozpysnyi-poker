import { SUITS, type Suit, assertPlayerCount, maxCardsPerHand } from './cards.js';
import type { Rng } from './rng.js';

/**
 * Етап гри (R-2.1): «Зростання», «Максимум», «Масті», «Безкозирка», «Темна» (R-10.2),
 * «Мізер», «Відіграш».
 */
export type HandPhase =
  'ascending' | 'maximum' | 'suits' | 'noTrump' | 'dark' | 'misere' | 'comeback';

/** Опції кімнати (§10): фіксуються разом із грою (R-10.1). */
export interface GameOptions {
  /** «Темна» (R-10.2): роздача наосліп перед мізером, бали ×2. */
  readonly dark: boolean;
  /** «Не більше трьох нулів поспіль» (R-10.3). */
  readonly zeroLimit: boolean;
}

/** За замовчуванням усі опції вимкнені (R-10.1). */
export const DEFAULT_OPTIONS: GameOptions = { dark: false, zeroLimit: false };

/**
 * Як визначається козир у роздачі:
 * `revealed` — відкривається верхня карта решти колоди (R-3.1),
 * `fixed` — наперед відомий козир (R-3.3), `none` — без козиря (R-3.4).
 */
export type TrumpRule =
  | { readonly kind: 'revealed' }
  | { readonly kind: 'fixed'; readonly suit: Suit }
  | { readonly kind: 'none' };

/**
 * Версія правил, за якими йде гра. Гра фіксує її на старті й догравається за нею,
 * навіть якщо правила потім змінилися:
 * 1 — мізер і відіграш без козиря;
 * 2 — у мізері й відіграші козир — відкрита карта (R-3.1, рішення власника 02.10).
 */
export const RULES_VERSION = 2;

export function assertRulesVersion(rulesVersion: number): void {
  if (!Number.isInteger(rulesVersion) || rulesVersion < 1 || rulesVersion > RULES_VERSION) {
    throw new RangeError(
      `Версія правил має бути від 1 до ${RULES_VERSION}, отримано ${rulesVersion}`,
    );
  }
}

/** Опис однієї роздачі в розкладі гри. */
export interface HandSpec {
  /** Порядковий номер роздачі в грі, від 0. */
  readonly index: number;
  readonly phase: HandPhase;
  /** Кількість карт на руку. */
  readonly cards: number;
  readonly trump: TrumpRule;
  /** Чи робляться замовлення (R-4.1). */
  readonly bidding: boolean;
}

/**
 * Генерує фіксовану послідовність роздач для N гравців (R-2.1, R-10.2) за версією правил
 * `rulesVersion` (за замовчуванням — поточною).
 */
export function createSchedule(
  playerCount: number,
  options: GameOptions = DEFAULT_OPTIONS,
  rulesVersion: number = RULES_VERSION,
): HandSpec[] {
  assertRulesVersion(rulesVersion);
  const max = maxCardsPerHand(playerCount);
  const specs: Omit<HandSpec, 'index'>[] = [];
  const revealed: TrumpRule = { kind: 'revealed' };
  const none: TrumpRule = { kind: 'none' };

  for (let cards = 1; cards < max; cards++) {
    specs.push({ phase: 'ascending', cards, trump: revealed, bidding: true });
  }
  for (let i = 0; i < playerCount; i++) {
    specs.push({ phase: 'maximum', cards: max, trump: revealed, bidding: true });
  }
  for (const suit of SUITS) {
    specs.push({ phase: 'suits', cards: max, trump: { kind: 'fixed', suit }, bidding: true });
  }
  for (let i = 0; i < playerCount; i++) {
    specs.push({ phase: 'noTrump', cards: max, trump: none, bidding: true });
  }
  if (options.dark) {
    // R-10.2: козир — з відкритої карти колоди, як у R-3.1.
    specs.push({ phase: 'dark', cards: max, trump: revealed, bidding: true });
  }
  // R-3.1: у мізері й відіграші козир — відкрита карта; до версії правил 2 — без козиря.
  const lastTrump = rulesVersion >= 2 ? revealed : none;
  specs.push({ phase: 'misere', cards: max, trump: lastTrump, bidding: false });
  specs.push({ phase: 'comeback', cards: max, trump: lastTrump, bidding: false });

  return specs.map((spec, index) => ({ index, ...spec }));
}

/** Випадково обирає місце першого роздаючого через seed RNG (R-2.2). */
export function chooseFirstDealer(rng: Rng, playerCount: number): number {
  assertPlayerCount(playerCount);
  return rng.nextInt(playerCount);
}

/**
 * Місце роздаючого в роздачі `handIndex` (R-2.2): після кожної роздачі роль переходить
 * до наступного гравця за годинниковою стрілкою, тобто до місця з наступним номером.
 */
export function dealerForHand(firstDealer: number, handIndex: number, playerCount: number): number {
  assertPlayerCount(playerCount);
  if (!Number.isInteger(firstDealer) || firstDealer < 0 || firstDealer >= playerCount) {
    throw new RangeError(
      `Місце роздаючого має бути від 0 до ${playerCount - 1}, отримано ${firstDealer}`,
    );
  }
  if (!Number.isInteger(handIndex) || handIndex < 0) {
    throw new RangeError(`Номер роздачі має бути невідʼємним цілим, отримано ${handIndex}`);
  }
  return (firstDealer + handIndex) % playerCount;
}
