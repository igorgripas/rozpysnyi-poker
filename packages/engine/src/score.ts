import { type Card, type Suit, assertPlayerCount, isJoker } from './cards.js';
import type { HandPhase, HandSpec } from './schedule.js';

/** Штраф за кожного джокера, що прийшов гравцеві за гру (R-7.7). */
export const JOKER_PENALTY = 10;

function assertCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} має бути невідʼємним цілим, отримано ${value}`);
  }
}

/** Множник балів за «Темну» (R-10.2). */
export const DARK_MULTIPLIER = 2;

/**
 * Бали гравця за роздачу (R-7.1–R-7.6); у «Темній» — удвічі більше (R-10.2).
 * `bid` — замовлення (`null` у «Мізері» й «Відіграші», R-4.1), `taken` — взято взяток.
 */
export function scoreHand(spec: HandSpec, bid: number | null, taken: number): number {
  assertCount(taken, 'Кількість взятих взяток');
  if (!spec.bidding) {
    if (bid !== null) {
      throw new RangeError('У роздачі без замовлень (R-4.1) замовлення має бути null');
    }
    // R-7.5 «Мізер»; R-7.6 «Відіграш».
    if (spec.phase === 'misere') return taken === 0 ? 10 : -10 * taken;
    return 10 * taken;
  }
  if (bid === null) throw new RangeError('У роздачі із замовленням потрібне замовлення');
  assertCount(bid, 'Замовлення');
  const multiplier = spec.phase === 'dark' ? DARK_MULTIPLIER : 1;
  return multiplier * scoreBid(bid, taken);
}

/** Бали за роздачу із замовленням (R-7.1–R-7.4). */
function scoreBid(bid: number, taken: number): number {
  if (taken === bid) return bid === 0 ? 5 : 10 * bid; // R-7.2, R-7.1
  if (taken > bid) return taken; // R-7.3
  return -10 * (bid - taken); // R-7.4
}

/** Кількість кружечків гравця в роздачі (R-8.3): скільки джокерів прийшло йому в руку. */
export function countJokers(hand: readonly Card[]): number {
  return hand.filter(isJoker).length;
}

/** Фінальний підсумок (R-7.7): сума балів за роздачі мінус 10 за кожного джокера. */
export function finalScore(total: number, jokers: number): number {
  assertCount(jokers, 'Кількість джокерів');
  return total - JOKER_PENALTY * jokers;
}

/** Запис про роздачу для таблиці гри; масиви — за порядком місць. */
export interface HandRecord {
  readonly spec: HandSpec;
  /** Місце роздаючого. */
  readonly dealer: number;
  /** Козир роздачі або `null` («б/к»). */
  readonly trump: Suit | null;
  /** Руки гравців одразу після роздачі — з них рахуються кружечки (R-8.3). */
  readonly hands: readonly (readonly Card[])[];
  /** Замовлення; `null` — ще не замовив або роздача без замовлень (R-4.1). */
  readonly bids: readonly (number | null)[];
  /** Скільки взяток уже взяв кожен гравець. */
  readonly taken: readonly number[];
  /** Чи завершена роздача (зіграно всі взятки). */
  readonly completed: boolean;
}

/** Клітинка гравця в рядку таблиці (R-8.2, R-8.3). */
export interface ScoreCell {
  readonly bid: number | null;
  readonly taken: number;
  /** Бали за роздачу; `null`, поки роздача не завершена. */
  readonly points: number | null;
  /** Наростаючий підсумок; `null`, поки роздача не завершена. */
  readonly total: number | null;
  /** Кружечки навколо замовлення (0, 1 або 2); `null` під час розіграшу (R-8.3). */
  readonly circles: number | null;
}

/** Рядок таблиці — одна роздача (R-8.1). */
export interface ScoreRow {
  /** Номер роздачі, від 1. */
  readonly number: number;
  readonly phase: HandPhase;
  readonly cards: number;
  readonly trump: Suit | null;
  readonly dealer: number;
  readonly players: readonly ScoreCell[];
}

/** Підсумок гравця під таблицею (R-8.4). */
export interface ScoreSummary {
  /** Сума балів за завершені роздачі. */
  readonly total: number;
  /** Загальна кількість кружечків (джокерів) за завершені роздачі. */
  readonly circles: number;
  /** Штраф за джокери (R-7.7), від'ємне число або 0. */
  readonly penalty: number;
  readonly final: number;
}

export interface ScoreTable {
  readonly rows: readonly ScoreRow[];
  readonly summary: readonly ScoreSummary[];
}

function assertRecord(record: HandRecord, playerCount: number): void {
  const { spec, bids, taken, hands, completed } = record;
  for (const [label, list] of [
    ['замовлень', bids],
    ['взяток', taken],
    ['рук', hands],
  ] as const) {
    if (list.length !== playerCount) {
      throw new RangeError(
        `Роздача ${spec.index + 1}: кількість ${label} має бути ${playerCount}, отримано ${list.length}`,
      );
    }
  }
  taken.forEach((count) => assertCount(count, 'Кількість взятих взяток'));
  const sum = taken.reduce((acc, count) => acc + count, 0);
  if (completed ? sum !== spec.cards : sum > spec.cards) {
    throw new RangeError(
      `Роздача ${spec.index + 1}: взято ${sum} взяток із ${spec.cards} карт на руку`,
    );
  }
  if (!spec.bidding && bids.some((bid) => bid !== null)) {
    throw new RangeError(`Роздача ${spec.index + 1}: у роздачі без замовлень (R-4.1) їх немає`);
  }
}

/**
 * Будує таблицю гри (R-8.1–R-8.4) з записів роздач у порядку розкладу.
 * Бали, підсумок і кружечки незавершеної роздачі не показуються (R-8.3);
 * підсумок під таблицею враховує лише завершені роздачі.
 */
export function buildScoreTable(records: readonly HandRecord[], playerCount: number): ScoreTable {
  assertPlayerCount(playerCount);
  const totals = Array.from({ length: playerCount }, () => 0);
  const circles = Array.from({ length: playerCount }, () => 0);

  const rows = records.map((record): ScoreRow => {
    assertRecord(record, playerCount);
    const { spec, completed } = record;
    const players = Array.from({ length: playerCount }, (_, seat): ScoreCell => {
      const bid = record.bids[seat] ?? null;
      const taken = record.taken[seat] as number;
      if (!completed) return { bid, taken, points: null, total: null, circles: null };
      const points = scoreHand(spec, bid, taken);
      const jokers = countJokers(record.hands[seat] as readonly Card[]);
      totals[seat] = (totals[seat] as number) + points;
      circles[seat] = (circles[seat] as number) + jokers;
      return { bid, taken, points, total: totals[seat] as number, circles: jokers };
    });
    return {
      number: spec.index + 1,
      phase: spec.phase,
      cards: spec.cards,
      trump: record.trump,
      dealer: record.dealer,
      players,
    };
  });

  const summary = totals.map((total, seat): ScoreSummary => {
    const jokers = circles[seat] as number;
    return {
      total,
      circles: jokers,
      penalty: 0 - JOKER_PENALTY * jokers,
      final: finalScore(total, jokers),
    };
  });
  return { rows, summary };
}
