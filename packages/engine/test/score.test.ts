import { describe, expect, it } from 'vitest';
import {
  JOKER_PENALTY,
  buildScoreTable,
  countJokers,
  finalScore,
  createSchedule,
  scoreHand,
} from '../src/index.js';
import type { Card, HandRecord, HandSpec } from '../src/index.js';

const schedule = createSchedule(3);
const regular = schedule[0] as HandSpec;
const misere = schedule.find((spec) => spec.phase === 'misere') as HandSpec;
const comeback = schedule.find((spec) => spec.phase === 'comeback') as HandSpec;
/** Мізер і відіграш на 1 карту — щоб фікстури таблиці були короткими. */
const misere1: HandSpec = { ...misere, cards: 1 };
const comeback1: HandSpec = { ...comeback, cards: 1 };

const joker0: Card = { kind: 'joker', index: 0 };
const joker1: Card = { kind: 'joker', index: 1 };
const six = (suit: 'spades' | 'clubs' | 'diamonds' | 'hearts'): Card => ({
  kind: 'standard',
  suit,
  rank: 6,
});

describe('бали за роздачу із замовленням', () => {
  it('R-7.1: exact non-zero bid gives +10 × z', () => {
    expect(scoreHand(regular, 3, 3)).toBe(30);
    expect(scoreHand(regular, 1, 1)).toBe(10);
  });

  it('R-7.2: zero bid and zero tricks (pass) gives +5', () => {
    expect(scoreHand(regular, 0, 0)).toBe(5);
  });

  it('R-7.3: overtricks give +1 per trick taken', () => {
    expect(scoreHand(regular, 2, 4)).toBe(4);
    expect(scoreHand(regular, 0, 2)).toBe(2);
  });

  it('R-7.4: undertricks give −10 × (z − v), taken tricks give nothing', () => {
    expect(scoreHand(regular, 4, 1)).toBe(-30);
    expect(scoreHand(regular, 2, 0)).toBe(-20);
  });

  it('R-7.x: bidding hand requires a bid', () => {
    expect(() => scoreHand(regular, null, 1)).toThrow(RangeError);
    expect(() => scoreHand(regular, null, 1)).toThrow(
      'У роздачі із замовленням потрібне замовлення',
    );
  });

  it('R-7.x: taken tricks must be a non-negative integer', () => {
    expect(() => scoreHand(regular, 1, -1)).toThrow(RangeError);
    expect(() => scoreHand(regular, 1, 1.5)).toThrow(RangeError);
    expect(() => scoreHand(regular, -1, 0)).toThrow(RangeError);
  });

  it('R-7.x: invalid count error names the field and the value', () => {
    expect(() => scoreHand(regular, 1, -1)).toThrow(
      'Кількість взятих взяток має бути невідʼємним цілим, отримано -1',
    );
    expect(() => scoreHand(regular, 2.5, 0)).toThrow(
      'Замовлення має бути невідʼємним цілим, отримано 2.5',
    );
    expect(() => finalScore(10, -1)).toThrow(
      'Кількість джокерів має бути невідʼємним цілим, отримано -1',
    );
  });
});

describe('бали за мізер і відіграш', () => {
  it('R-7.5: misère with no tricks gives +10', () => {
    expect(scoreHand(misere, null, 0)).toBe(10);
  });

  it('R-7.5: misère with tricks gives −10 × v', () => {
    expect(scoreHand(misere, null, 2)).toBe(-20);
  });

  it('R-7.6: comeback gives +10 × v', () => {
    expect(scoreHand(comeback, null, 3)).toBe(30);
    expect(scoreHand(comeback, null, 0)).toBe(0);
  });

  it('R-4.1: misère and comeback take no bid', () => {
    expect(() => scoreHand(misere, 0, 0)).toThrow(RangeError);
    expect(() => scoreHand(comeback, 1, 1)).toThrow(RangeError);
    expect(() => scoreHand(misere, 0, 0)).toThrow(
      'У роздачі без замовлень (R-4.1) замовлення має бути null',
    );
  });
});

describe('кружечки', () => {
  it('R-8.3: circles equal the number of jokers dealt into the hand', () => {
    expect(countJokers([six('spades'), six('clubs')])).toBe(0);
    expect(countJokers([six('spades'), joker1])).toBe(1);
    expect(countJokers([joker0, six('hearts'), joker1])).toBe(2);
  });
});

/** Роздача на 1 карту (N = 3), у якій сидіння 0 отримує джокера. */
function firstHand(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    spec: regular,
    dealer: 2,
    trump: 'hearts',
    hands: [[joker0], [six('clubs')], [six('spades')]],
    bids: [1, 0, 1],
    taken: [1, 0, 0],
    completed: true,
    ...overrides,
  };
}

describe('таблиця гри', () => {
  it('R-8.1: row shows number, phase, cards, trump and dealer', () => {
    const table = buildScoreTable([firstHand()], 3);
    expect(table.rows[0]).toMatchObject({
      number: 1,
      phase: 'ascending',
      cards: 1,
      trump: 'hearts',
      dealer: 2,
    });
  });

  it('R-8.1: hand without trump shows null (б/к)', () => {
    const table = buildScoreTable([firstHand({ trump: null })], 3);
    expect(table.rows[0]?.trump).toBeNull();
  });

  it('R-8.2: row shows bid, taken, points and running total for each player', () => {
    const second = firstHand({
      spec: schedule[1] as HandSpec,
      dealer: 0,
      hands: [
        [six('clubs'), six('diamonds')],
        [joker0, joker1],
        [six('spades'), six('hearts')],
      ],
      bids: [0, 2, 1],
      taken: [0, 2, 0],
    });
    const table = buildScoreTable([firstHand(), second], 3);
    expect(table.rows[0]?.players.map((p) => [p.bid, p.taken, p.points, p.total])).toEqual([
      [1, 1, 10, 10],
      [0, 0, 5, 5],
      [1, 0, -10, -10],
    ]);
    expect(table.rows[1]?.players.map((p) => [p.bid, p.taken, p.points, p.total])).toEqual([
      [0, 0, 5, 15],
      [2, 2, 20, 25],
      [1, 0, -10, -20],
    ]);
  });

  it('R-8.3: circles are bound to the jokers dealt to each player', () => {
    const second = firstHand({
      spec: schedule[1] as HandSpec,
      hands: [
        [six('clubs'), six('diamonds')],
        [joker0, joker1],
        [six('spades'), six('hearts')],
      ],
      bids: [0, 2, 1],
      taken: [0, 2, 0],
    });
    const table = buildScoreTable([firstHand(), second], 3);
    expect(table.rows[0]?.players.map((p) => p.circles)).toEqual([1, 0, 0]);
    expect(table.rows[1]?.players.map((p) => p.circles)).toEqual([0, 2, 0]);
  });

  it('R-8.3: circles are hidden while the hand is being played', () => {
    const table = buildScoreTable(
      [firstHand({ completed: false, taken: [0, 0, 0], bids: [1, 0, null] })],
      3,
    );
    const players = table.rows[0]?.players ?? [];
    expect(players.map((p) => p.circles)).toEqual([null, null, null]);
    expect(players.map((p) => p.bid)).toEqual([1, 0, null]);
    expect(players.map((p) => p.points)).toEqual([null, null, null]);
    expect(table.summary.map((s) => s.circles)).toEqual([0, 0, 0]);
  });

  it('R-8.3: circles in misère and comeback are counted too, bid is null', () => {
    const records: HandRecord[] = [
      {
        spec: misere1,
        dealer: 0,
        trump: null,
        hands: [[joker0], [joker1], [six('clubs')]],
        bids: [null, null, null],
        taken: [0, 1, 0],
        completed: true,
      },
    ];
    const table = buildScoreTable(records, 3);
    expect(table.rows[0]?.players.map((p) => [p.bid, p.points, p.circles])).toEqual([
      [null, 10, 1],
      [null, -10, 1],
      [null, 10, 0],
    ]);
  });

  it('R-8.4: summary shows total circles, penalty and final score', () => {
    const second = firstHand({
      spec: schedule[1] as HandSpec,
      hands: [
        [joker1, six('diamonds')],
        [six('hearts'), joker0],
        [six('spades'), six('clubs')],
      ],
      bids: [0, 2, 1],
      taken: [0, 2, 0],
    });
    const table = buildScoreTable([firstHand(), second], 3);
    expect(table.summary).toEqual([
      { total: 15, circles: 2, penalty: -20, final: -5 },
      { total: 25, circles: 1, penalty: -10, final: 15 },
      { total: -20, circles: 0, penalty: 0, final: -20 },
    ]);
  });

  it('R-7.7: each joker dealt costs −10 at the end of the game', () => {
    expect(JOKER_PENALTY).toBe(10);
    // Приклад з RULES.md: 312 балів за роздачі, 5 джокерів → 262.
    expect(finalScore(312, 5)).toBe(262);
    expect(finalScore(0, 0)).toBe(0);
  });

  it('R-7.7: jokers from every hand of the game are penalised, incl. misère and comeback', () => {
    const records: HandRecord[] = [
      firstHand(),
      {
        spec: misere1,
        dealer: 0,
        trump: null,
        hands: [[joker0], [six('clubs')], [joker1]],
        bids: [null, null, null],
        taken: [1, 0, 0],
        completed: true,
      },
      {
        spec: comeback1,
        dealer: 1,
        trump: null,
        hands: [[joker1], [joker0], [six('spades')]],
        bids: [null, null, null],
        taken: [0, 1, 0],
        completed: true,
      },
    ];
    const table = buildScoreTable(records, 3);
    expect(table.summary).toEqual([
      { total: 0, circles: 3, penalty: -30, final: -30 },
      { total: 25, circles: 1, penalty: -10, final: 15 },
      { total: 0, circles: 1, penalty: -10, final: -10 },
    ]);
  });

  it('R-7.x: completed hand must distribute exactly all tricks', () => {
    expect(() => buildScoreTable([firstHand({ taken: [1, 1, 0] })], 3)).toThrow(RangeError);
    expect(() => buildScoreTable([firstHand({ taken: [0, 0, 0] })], 3)).toThrow(RangeError);
    const second = firstHand({ spec: schedule[1] as HandSpec, taken: [1, 0, 0] });
    expect(() => buildScoreTable([firstHand(), second], 3)).toThrow(
      'Роздача 2: взято 1 взяток із 2 карт на руку',
    );
  });

  it('R-7.x: hand in progress cannot have more tricks than cards, but may reach the limit', () => {
    const inProgress = (taken: number[]) =>
      firstHand({ spec: schedule[1] as HandSpec, completed: false, taken });
    expect(() => buildScoreTable([inProgress([2, 1, 0])], 3)).toThrow(
      'Роздача 2: взято 3 взяток із 2 карт на руку',
    );
    expect(() => buildScoreTable([inProgress([1, 1, 0])], 3)).not.toThrow();
  });

  it('R-7.x: every taken count in a row must be a non-negative integer', () => {
    // Сума 1 збігається з кількістю карт, тож помилку має дати саме перевірка кожного числа.
    expect(() => buildScoreTable([firstHand({ taken: [2, -1, 0] })], 3)).toThrow(
      'Кількість взятих взяток має бути невідʼємним цілим, отримано -1',
    );
    expect(() => buildScoreTable([firstHand({ completed: false, taken: [-1, 0, 0] })], 3)).toThrow(
      RangeError,
    );
  });

  it('R-4.1: a row of misère or comeback must have no bids', () => {
    const record: HandRecord = {
      spec: { ...misere1, index: 4 },
      dealer: 0,
      trump: null,
      hands: [[joker0], [joker1], [six('clubs')]],
      bids: [null, 0, null],
      taken: [0, 0, 0],
      completed: false,
    };
    expect(() => buildScoreTable([record], 3)).toThrow(
      'Роздача 5: у роздачі без замовлень (R-4.1) їх немає',
    );
    expect(() => buildScoreTable([{ ...record, bids: [null, null, null] }], 3)).not.toThrow();
  });

  it('R-8.2: row validates player count of bids, taken and hands', () => {
    expect(() => buildScoreTable([firstHand({ taken: [1, 0] })], 3)).toThrow(RangeError);
    expect(() => buildScoreTable([firstHand({ bids: [1, 0] })], 3)).toThrow(RangeError);
    expect(() => buildScoreTable([firstHand({ hands: [[joker0]] })], 3)).toThrow(RangeError);
    expect(() => buildScoreTable([firstHand({ bids: [1, 0] })], 3)).toThrow(
      'Роздача 1: кількість замовлень має бути 3, отримано 2',
    );
  });

  it('R-1.2: table is built only for a valid number of players', () => {
    expect(() => buildScoreTable([], 2)).toThrow(RangeError);
    expect(() => buildScoreTable([], 7)).toThrow(RangeError);
  });

  it('R-8.5: empty table is valid at the very start of the game', () => {
    const table = buildScoreTable([], 4);
    expect(table.rows).toEqual([]);
    expect(table.summary).toHaveLength(4);
    expect(table.summary[0]).toEqual({ total: 0, circles: 0, penalty: 0, final: 0 });
  });
});
