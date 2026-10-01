/**
 * Інваріанти повної або незавершеної гри (AUTOPILOT §5 п.3–4).
 * Спільні для property-тестів, симулятора й регресійних seed.
 * Кожна перевірка повертає список порушень; порожній список — усе гаразд.
 */
import { isDeepStrictEqual } from 'node:util';
import {
  apply,
  cardId,
  countJokers,
  createGame,
  createRng,
  createSchedule,
  finalScore,
  firstLeader,
  gameLog,
  legalActions,
  replay,
  scoreHand,
  scoreTable,
  trickWinner,
} from '../../src/index.js';
import type { Action, GameState, HandRecord, ScoreTable, TrickCard } from '../../src/index.js';

type PlayAction = Extract<Action, { type: 'play' }>;

/** Seed ходів випадкового гравця, виведений із seed гри. */
function movesSeedFor(seed: number): number {
  return (seed ^ 0x9e3779b9) >>> 0;
}

/** Повна гра, де на кожному кроці обирається випадкова легальна дія (seed RNG). */
export function playRandomGame(seed: number, playerCount: number): GameState {
  const rng = createRng(movesSeedFor(seed));
  let state = createGame(seed, playerCount);
  while (state.status !== 'finished') {
    const actions = legalActions(state);
    if (actions.length === 0) throw new Error(`Немає легальних дій (гравець ${state.turn})`);
    state = apply(state, actions[rng.nextInt(actions.length)] as Action);
  }
  return state;
}

interface HandSegment {
  readonly record: HandRecord;
  readonly bids: readonly Action[];
  readonly plays: readonly Action[];
}

/** Ділить лог на завершені роздачі: спершу N замовлень (якщо є), потім N × K ходів. */
function segments(state: GameState): HandSegment[] {
  const n = state.playerCount;
  let offset = 0;
  return state.history.map((record) => {
    const bidCount = record.spec.bidding ? n : 0;
    const bids = state.actions.slice(offset, offset + bidCount);
    const plays = state.actions.slice(offset + bidCount, offset + bidCount + n * record.spec.cards);
    offset += bidCount + plays.length;
    return { record, bids, plays };
  });
}

function label(record: HandRecord): string {
  return `роздача ${record.spec.index + 1}`;
}

/** Кожна роздана карта зіграна рівно один раз і саме тим, кому її роздали. */
export function checkCardsPlayedOnce(state: GameState): string[] {
  const errors: string[] = [];
  for (const { record, plays } of segments(state)) {
    const dealt = new Map<string, number>();
    record.hands.forEach((hand, seat) => hand.forEach((card) => dealt.set(cardId(card), seat)));
    const seen = new Set<string>();
    for (const action of plays) {
      if (action.type !== 'play') {
        errors.push(`${label(record)}: очікувався хід картою, а не ${action.type}`);
        continue;
      }
      const id = cardId(action.card);
      if (seen.has(id)) errors.push(`${label(record)}: карта ${id} зіграна двічі`);
      if (dealt.get(id) !== action.seat) {
        errors.push(`${label(record)}: карту ${id} зіграв гравець ${action.seat}, а не власник`);
      }
      seen.add(id);
    }
    if (seen.size !== dealt.size) {
      errors.push(`${label(record)}: зіграно ${seen.size} різних карт із ${dealt.size}`);
    }
  }
  return errors;
}

/** Сума взяток кожної роздачі дорівнює кількості карт у роздачі. */
export function checkTrickSums(state: GameState): string[] {
  return state.history.flatMap((record) => {
    const sum = record.taken.reduce((acc, count) => acc + count, 0);
    return sum === record.spec.cards
      ? []
      : [`${label(record)}: взято ${sum} взяток із ${record.spec.cards}`];
  });
}

/** R-4.4: сума замовлень ≠ кількості карт у кожній роздачі із замовленням на 4+ карти (R-4.6). */
export function checkBidSums(state: GameState): string[] {
  return segments(state).flatMap(({ record, bids }) => {
    if (!record.spec.bidding) {
      return record.bids.every((bid) => bid === null)
        ? []
        : [`${label(record)}: замовлення в роздачі без замовлень`];
    }
    // R-4.6: у роздачах з 1–3 картами сума може дорівнювати кількості карт.
    if (record.spec.cards <= 3) return [];
    const sum = bids.reduce((acc, action) => acc + (action.type === 'bid' ? action.bid : 0), 0);
    return sum === record.spec.cards
      ? [`${label(record)}: сума замовлень ${sum} дорівнює кількості карт`]
      : [];
  });
}

function toTrickCard(action: PlayAction): TrickCard {
  if (action.card.kind === 'standard') return action.card;
  if (action.call === undefined) throw new Error('Джокер без оголошення в лозі');
  return { ...action.card, call: action.call };
}

/**
 * Перераховує взятки й бали з логу незалежно від редʼюсера (R-5.1, R-5.4, R-7.x)
 * і звіряє з таблицею гри (R-8.2, R-8.4).
 */
export function checkScoreFromLog(state: GameState): string[] {
  const n = state.playerCount;
  const errors: string[] = [];
  const totals = Array.from({ length: n }, () => 0);
  const jokers = Array.from({ length: n }, () => 0);
  let table: ScoreTable;
  try {
    table = scoreTable(state);
  } catch (error) {
    return [`таблиця гри не будується: ${(error as Error).message}`];
  }

  segments(state).forEach(({ record, bids, plays }, row) => {
    const bidBySeat = Array.from({ length: n }, (): number | null => null);
    for (const action of bids) if (action.type === 'bid') bidBySeat[action.seat] = action.bid;
    const taken = Array.from({ length: n }, () => 0);
    let leader = firstLeader(record.dealer, n);
    for (let start = 0; start < plays.length; start += n) {
      const trick = plays.slice(start, start + n) as PlayAction[];
      trick.forEach((action, k) => {
        if (action.seat !== (leader + k) % n) {
          errors.push(`${label(record)}: хід гравця ${action.seat} не в його чергу`);
        }
      });
      leader = trickWinner(leader, trick.map(toTrickCard), record.trump, n);
      taken[leader] = (taken[leader] as number) + 1;
    }
    if (!isDeepStrictEqual(taken, [...record.taken])) {
      errors.push(`${label(record)}: взятки з логу ${taken} ≠ ${record.taken}`);
    }
    const cells = table.rows[row]?.players ?? [];
    for (let seat = 0; seat < n; seat++) {
      const points = scoreHand(record.spec, bidBySeat[seat] ?? null, taken[seat] as number);
      totals[seat] = (totals[seat] as number) + points;
      jokers[seat] = (jokers[seat] as number) + countJokers(record.hands[seat] ?? []);
      const cell = cells[seat];
      if (cell?.points !== points || cell.total !== totals[seat]) {
        errors.push(
          `${label(record)}: бали/підсумок гравця ${seat} з логу ${points}/${totals[seat]}` +
            ` ≠ ${cell?.points}/${cell?.total}`,
        );
      }
    }
  });

  table.summary.forEach((summary, seat) => {
    const expected = finalScore(totals[seat] as number, jokers[seat] as number);
    if (summary.final !== expected || summary.circles !== jokers[seat]) {
      errors.push(`гравець ${seat}: фінал ${summary.final} ≠ перерахованого ${expected}`);
    }
  });
  if (state.status === 'finished' && state.history.length !== createSchedule(n).length) {
    errors.push(`гру завершено після ${state.history.length} роздач`);
  }
  return errors;
}

/** R-2.3: replay(seed, log) відтворює той самий стан. */
export function checkReplay(state: GameState): string[] {
  let replayed: GameState;
  try {
    replayed = replay(state.seed, gameLog(state));
  } catch (error) {
    return [`replay впав: ${(error as Error).message}`];
  }
  return isDeepStrictEqual(replayed, state) ? [] : ['replay(seed, log) дає інший стан'];
}

/** Усі інваріанти гри разом. */
export function checkGame(state: GameState): string[] {
  return [
    ...checkCardsPlayedOnce(state),
    ...checkTrickSums(state),
    ...checkBidSums(state),
    ...checkScoreFromLog(state),
    ...checkReplay(state),
  ];
}
