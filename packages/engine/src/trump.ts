import { type Card, type Suit, isJoker } from './cards.js';
import type { TrumpRule } from './schedule.js';

/** Козир роздачі. */
export interface TrumpResult {
  /** Козирна масть або `null`, якщо роздача без козиря («б/к»). */
  readonly trump: Suit | null;
  /** Відкрита карта з решти колоди (R-3.1) або `null`, якщо карта не відкривалась. */
  readonly revealed: Card | null;
}

/**
 * Визначає козир роздачі за її правилом (R-3.1–R-3.4).
 * `rest` — решта колоди після роздачі; `rest[0]` — верхня карта.
 */
export function determineTrump(rule: TrumpRule, rest: readonly Card[]): TrumpResult {
  switch (rule.kind) {
    case 'revealed': {
      const top = rest[0];
      if (top === undefined) {
        throw new RangeError('Немає карти, щоб відкрити козир: решта колоди порожня');
      }
      // R-3.2: відкритий джокер — роздача без козиря.
      return { trump: isJoker(top) ? null : top.suit, revealed: top };
    }
    case 'fixed':
      return { trump: rule.suit, revealed: null };
    case 'none':
      return { trump: null, revealed: null };
  }
}
