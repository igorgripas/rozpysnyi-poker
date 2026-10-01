/**
 * Фікстури сумісності збережених ігор (T56): seed + лог незавершеної гри у форматі,
 * у якому сервер зберігає її в базу, і стан, до якого лог має відтворитися.
 */
import { cardId, scoreTable } from '../../src/index.js';
import type { GameLog, GameState, GameStatus, Suit, TrickCard } from '../../src/index.js';

/** Стисла картина стану гри, яку перевіряє фікстура. */
export interface CompatSnapshot {
  readonly status: GameStatus;
  readonly turn: number | null;
  /** Номер роздачі в розкладі, від 1 (R-2.1). */
  readonly hand: number;
  readonly cards: number;
  readonly dealer: number;
  readonly trump: Suit | null;
  readonly revealed: string | null;
  /** Карти, що лишилися в руках, за порядком місць. */
  readonly hands: readonly (readonly string[])[];
  readonly bids: readonly (number | null)[];
  readonly taken: readonly number[];
  readonly leader: number;
  /** Карти поточної взятки; джокер — з оголошенням через `:`. */
  readonly trick: readonly string[];
  /** Підсумок таблиці за кожним гравцем (R-8.4). */
  readonly final: readonly number[];
}

export interface CompatFixture {
  readonly title: string;
  readonly rules: readonly string[];
  readonly seed: number;
  readonly log: GameLog;
  readonly expect: CompatSnapshot;
}

function trickCardId(card: TrickCard): string {
  if (card.kind === 'standard') return cardId(card);
  const { call } = card;
  const suit = call.type === 'high' || call.type === 'low' ? `:${call.suit}` : '';
  return `${cardId(card)}:${call.type}${suit}`;
}

export function compatSnapshot(state: GameState): CompatSnapshot {
  const { hand } = state;
  return {
    status: state.status,
    turn: state.turn,
    hand: hand.spec.index + 1,
    cards: hand.spec.cards,
    dealer: hand.dealer,
    trump: hand.trump,
    revealed: hand.revealed === null ? null : cardId(hand.revealed),
    hands: hand.hands.map((cards) => cards.map(cardId)),
    bids: hand.bids,
    taken: hand.taken,
    leader: hand.leader,
    trick: hand.trick.map(trickCardId),
    final: scoreTable(state).summary.map((summary) => summary.final),
  };
}

/** JSON фікстури: дії логу — по одній на рядок, щоб файл лишався читабельним. */
export function formatFixture(fixture: CompatFixture): string {
  const { log, ...rest } = fixture;
  const actions = log.actions.map((action) => `      ${JSON.stringify(action)}`).join(',\n');
  const logJson = [
    '{',
    `    "version": ${log.version},`,
    `    "playerCount": ${log.playerCount},`,
    `    "actions": [\n${actions}\n    ]`,
    '  }',
  ].join('\n');
  const body = JSON.stringify({ ...rest, log: null }, null, 2).replace(
    '"log": null',
    `"log": ${logJson}`,
  );
  return `${body}\n`;
}
