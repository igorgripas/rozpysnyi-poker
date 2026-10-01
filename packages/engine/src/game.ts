import { biddingOrder, forbiddenDealerBid, legalBids } from './bidding.js';
import { type Card, type Suit, assertPlayerCount, cardId, createDeck, isJoker } from './cards.js';
import { deal } from './deal.js';
import { ENGINE_LOG_VERSION, migrateLog } from './log.js';
import { createRng, shuffle } from './rng.js';
import { type HandSpec, chooseFirstDealer, createSchedule, dealerForHand } from './schedule.js';
import { type HandRecord, type ScoreTable, buildScoreTable } from './score.js';
import {
  type JokerCall,
  type TrickCard,
  firstLeader,
  isLegalJokerCall,
  isLegalPlay,
  legalJokerCalls,
  legalPlays,
  trickWinner,
} from './trick.js';
import { determineTrump } from './trump.js';

/** Дія гравця на місці `seat`: замовлення (R-4.x) або хід картою (R-5.x, R-6.x). */
export type Action =
  | { readonly type: 'bid'; readonly seat: number; readonly bid: number }
  | {
      readonly type: 'play';
      readonly seat: number;
      readonly card: Card;
      /** Оголошення — обов'язкове для джокера й заборонене для звичайної карти (§6). */
      readonly call?: JokerCall;
    };

/** Лог гри: разом із seed повністю відтворює стан через `replay` (R-2.3). */
export interface GameLog {
  readonly version: number;
  readonly playerCount: number;
  readonly actions: readonly Action[];
}

/** Стан поточної роздачі; масиви — за порядком місць. */
export interface HandState {
  readonly spec: HandSpec;
  readonly dealer: number;
  /** Козир роздачі або `null` («б/к»). */
  readonly trump: Suit | null;
  /** Відкрита карта з решти колоди (R-3.1) або `null`. */
  readonly revealed: Card | null;
  /** Руки одразу після роздачі — з них рахуються кружечки (R-8.3). */
  readonly dealt: readonly (readonly Card[])[];
  /** Карти, що лишилися в руках. */
  readonly hands: readonly (readonly Card[])[];
  /** Замовлення; `null` — ще не замовив або роздача без замовлень (R-4.1). */
  readonly bids: readonly (number | null)[];
  readonly taken: readonly number[];
  /** Хто заходить у поточну взятку. */
  readonly leader: number;
  readonly trick: readonly TrickCard[];
}

/** Завершена взятка, видима до першої карти наступної (R-9.2). */
export interface CompletedTrick {
  readonly leader: number;
  readonly cards: readonly TrickCard[];
  readonly winner: number;
}

export type GameStatus = 'bidding' | 'playing' | 'finished';

/** Повний стан гри. Змінюється лише через `apply`, серіалізується в JSON. */
export interface GameState {
  readonly seed: number;
  readonly playerCount: number;
  readonly firstDealer: number;
  /** Seed тасування кожної роздачі, виведені з головного seed (R-2.3). */
  readonly handSeeds: readonly number[];
  readonly status: GameStatus;
  /** Чий хід; `null`, коли гру завершено. */
  readonly turn: number | null;
  /** Поточна роздача (після завершення гри — остання). */
  readonly hand: HandState;
  /** Завершені роздачі в порядку розкладу. */
  readonly history: readonly HandRecord[];
  readonly lastTrick: CompletedTrick | null;
  readonly actions: readonly Action[];
}

/** Недопустима дія: не той гравець, не та фаза або порушення правил. */
export class IllegalActionError extends Error {
  override readonly name = 'IllegalActionError';
}

const UINT32 = 2 ** 32;

function assertSeat(seat: number, playerCount: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= playerCount) {
    throw new RangeError(`Місце має бути від 0 до ${playerCount - 1}, отримано ${seat}`);
  }
}

/** Роздає роздачу `index` і визначає козир (R-2.2, R-2.3, R-3.1–R-3.4). */
function startHand(
  state: Omit<GameState, 'hand' | 'status' | 'turn'>,
  index: number,
): Pick<GameState, 'hand' | 'status' | 'turn'> {
  const { playerCount } = state;
  const spec = createSchedule(playerCount)[index] as HandSpec;
  const dealer = dealerForHand(state.firstDealer, index, playerCount);
  const deck = shuffle(createDeck(), createRng(state.handSeeds[index] as number));
  const { hands, rest } = deal(deck, playerCount, spec.cards);
  const { trump, revealed } = determineTrump(spec.trump, rest);
  const first = firstLeader(dealer, playerCount);
  return {
    // R-4.1: без замовлень одразу розіграш; інакше першим замовляє гравець ліворуч (R-4.2).
    status: spec.bidding ? 'bidding' : 'playing',
    turn: first,
    hand: {
      spec,
      dealer,
      trump,
      revealed,
      dealt: hands,
      hands,
      bids: hands.map(() => null),
      taken: hands.map(() => 0),
      leader: first,
      trick: [],
    },
  };
}

/** Нова гра: seed визначає першого роздаючого (R-2.2) і тасування всіх роздач (R-2.3). */
export function createGame(seed: number, playerCount: number): GameState {
  assertPlayerCount(playerCount);
  const rng = createRng(seed);
  const firstDealer = chooseFirstDealer(rng, playerCount);
  const handSeeds = createSchedule(playerCount).map(() => rng.nextInt(UINT32));
  const base = {
    seed,
    playerCount,
    firstDealer,
    handSeeds,
    history: [],
    lastTrick: null,
    actions: [],
  };
  return { ...base, ...startHand(base, 0) };
}

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item));
}

function applyBid(state: GameState, seat: number, bid: number): GameState {
  const { hand, playerCount } = state;
  const order = biddingOrder(hand.dealer, playerCount);
  const previous = order.slice(0, order.indexOf(seat)).map((s) => hand.bids[s] as number);
  if (!Number.isInteger(bid) || !legalBids(hand.spec.cards, previous, playerCount).includes(bid)) {
    throw new IllegalActionError(`Замовлення ${bid} недопустиме (R-4.3, R-4.4)`);
  }
  const bids = replaceAt(hand.bids, seat, bid);
  const next = previous.length + 1 < playerCount ? (order[previous.length + 1] as number) : null;
  return {
    ...state,
    // R-5.1: після замовлень першу взятку починає гравець ліворуч від роздаючого.
    status: next === null ? 'playing' : 'bidding',
    turn: next ?? hand.leader,
    hand: { ...hand, bids },
  };
}

function toTrickCard(state: GameState, card: Card, call: JokerCall | undefined): TrickCard {
  const { hand } = state;
  if (!isJoker(card)) {
    if (call !== undefined) {
      throw new IllegalActionError('Оголошення можливе лише для джокера (§6)');
    }
    return card;
  }
  if (call === undefined || !isLegalJokerCall(hand.trick, hand.trump, call)) {
    throw new IllegalActionError('Джокер потребує допустимого оголошення (R-6.1–R-6.6)');
  }
  return { kind: 'joker', index: card.index, call };
}

function applyPlay(
  state: GameState,
  seat: number,
  card: Card,
  call: JokerCall | undefined,
): GameState {
  const { hand, playerCount } = state;
  const held = hand.hands[seat] as readonly Card[];
  const id = cardId(card);
  const own = held.find((c) => cardId(c) === id);
  if (own === undefined) throw new IllegalActionError(`Карти ${id} немає в руці`);
  if (!isLegalPlay(held, hand.trick, hand.trump, own)) {
    throw new IllegalActionError(`Хід ${id} порушує обов'язок ходу (R-5.2, R-6.1–R-6.3)`);
  }
  const trick = [...hand.trick, toTrickCard(state, own, call)];
  const hands = replaceAt(
    hand.hands,
    seat,
    held.filter((c) => cardId(c) !== id),
  );

  if (trick.length < playerCount) {
    return {
      ...state,
      turn: (seat + 1) % playerCount,
      hand: { ...hand, hands, trick },
      // R-9.2: попередня взятка зникає з першою картою наступної.
      lastTrick: hand.trick.length === 0 ? null : state.lastTrick,
    };
  }

  const winner = trickWinner(hand.leader, trick, hand.trump, playerCount);
  const taken = replaceAt(hand.taken, winner, (hand.taken[winner] as number) + 1);
  const lastTrick: CompletedTrick = { leader: hand.leader, cards: trick, winner };
  const finishedHand = { ...hand, hands, taken, trick: [], leader: winner };

  if ((hands[0] as readonly Card[]).length > 0) {
    // R-5.1: наступну взятку починає той, хто взяв попередню.
    return { ...state, turn: winner, hand: finishedHand, lastTrick };
  }

  const record: HandRecord = {
    spec: hand.spec,
    dealer: hand.dealer,
    trump: hand.trump,
    hands: hand.dealt,
    bids: hand.bids,
    taken,
    completed: true,
  };
  const history = [...state.history, record];
  const nextIndex = hand.spec.index + 1;
  if (nextIndex >= state.handSeeds.length) {
    return { ...state, status: 'finished', turn: null, hand: finishedHand, history, lastTrick };
  }
  const base = { ...state, history, lastTrick };
  return { ...base, ...startHand(base, nextIndex) };
}

/**
 * Редʼюсер гри: повертає новий стан після дії, вхідний стан не змінюється.
 * Недопустима дія кидає `IllegalActionError`.
 */
export function apply(state: GameState, action: Action): GameState {
  if (state.status === 'finished') throw new IllegalActionError('Гру завершено');
  if (action.seat !== state.turn) {
    throw new IllegalActionError(`Зараз хід гравця ${state.turn}, а не ${action.seat}`);
  }
  let next: GameState;
  if (action.type === 'bid') {
    if (state.status !== 'bidding') throw new IllegalActionError('Зараз не час замовлень');
    next = applyBid(state, action.seat, action.bid);
  } else if (action.type === 'play') {
    if (state.status !== 'playing') throw new IllegalActionError('Зараз не час розіграшу');
    next = applyPlay(state, action.seat, action.card, action.call);
  } else {
    throw new IllegalActionError('Невідомий тип дії');
  }
  return { ...next, actions: [...state.actions, action] };
}

/** Усі допустимі дії гравця на черзі (для ботів і перевірок). */
export function legalActions(state: GameState): Action[] {
  if (state.turn === null) return [];
  const seat = state.turn;
  const { hand, playerCount } = state;
  if (state.status === 'bidding') {
    const order = biddingOrder(hand.dealer, playerCount);
    const previous = order.slice(0, order.indexOf(seat)).map((s) => hand.bids[s] as number);
    return legalBids(hand.spec.cards, previous, playerCount).map((bid) => ({
      type: 'bid',
      seat,
      bid,
    }));
  }
  return legalPlays(hand.hands[seat] as readonly Card[], hand.trick, hand.trump).flatMap(
    (card): Action[] =>
      isJoker(card)
        ? legalJokerCalls(hand.trick, hand.trump).map((call) => ({
            type: 'play',
            seat,
            card,
            call,
          }))
        : [{ type: 'play', seat, card }],
  );
}

/** Лог гри для збереження й відтворення. */
export function gameLog(state: GameState): GameLog {
  return { version: ENGINE_LOG_VERSION, playerCount: state.playerCount, actions: state.actions };
}

/**
 * Відтворює гру з seed і логу дій (R-2.3): той самий лог дає той самий стан.
 * Лог старої версії спершу мігрується; несумісний — `UnsupportedLogVersionError`.
 */
export function replay(seed: number, log: GameLog): GameState {
  const { playerCount, actions } = migrateLog(log);
  return actions.reduce(apply, createGame(seed, playerCount));
}

/** Таблиця гри (R-8.1–R-8.4): завершені роздачі й поточна, якщо гра триває. */
export function scoreTable(state: GameState): ScoreTable {
  const records: HandRecord[] = [...state.history];
  if (state.status !== 'finished') {
    const { hand } = state;
    records.push({
      spec: hand.spec,
      dealer: hand.dealer,
      trump: hand.trump,
      hands: hand.dealt,
      bids: hand.bids,
      taken: hand.taken,
      completed: false,
    });
  }
  return buildScoreTable(records, state.playerCount);
}

/** Що бачить гравець: лише власну руку, публічні дані й таблицю без чужих кружечків. */
export interface PlayerView {
  readonly seat: number;
  readonly playerCount: number;
  readonly status: GameStatus;
  readonly turn: number | null;
  readonly spec: HandSpec;
  readonly dealer: number;
  readonly trump: Suit | null;
  readonly revealed: Card | null;
  /** Власна рука гравця. */
  readonly hand: readonly Card[];
  /** Скільки карт у руці кожного гравця. */
  readonly handSizes: readonly number[];
  /** Замовлення відкриті для всіх (R-4.5). */
  readonly bids: readonly (number | null)[];
  /** Поточна сума замовлень (R-4.5). */
  readonly bidSum: number;
  /** Заборонене для роздаючого значення (R-4.4, R-4.5) або `null` (зокрема в роздачах з 1–3 картами, R-4.6). */
  readonly forbiddenBid: number | null;
  readonly taken: readonly number[];
  readonly leader: number;
  readonly trick: readonly TrickCard[];
  readonly lastTrick: CompletedTrick | null;
  /** Таблиця гри; кружечки поточної роздачі приховані до її завершення (R-8.3). */
  readonly table: ScoreTable;
  /** Допустимі дії гравця, якщо зараз його хід; інакше порожньо. */
  readonly legalActions: readonly Action[];
}

/** Погляд гравця `seat`: чужі руки й кружечки до кінця роздачі приховані. */
export function viewFor(state: GameState, seat: number): PlayerView {
  assertSeat(seat, state.playerCount);
  const { hand } = state;
  const bidSum = hand.bids.reduce<number>((sum, bid) => sum + (bid ?? 0), 0);
  const dealerBid = hand.bids[hand.dealer];
  const forbiddenBid =
    hand.spec.bidding && dealerBid === null ? forbiddenDealerBid(hand.spec.cards, bidSum) : null;
  return {
    seat,
    playerCount: state.playerCount,
    status: state.status,
    turn: state.turn,
    spec: hand.spec,
    dealer: hand.dealer,
    trump: hand.trump,
    revealed: hand.revealed,
    hand: hand.hands[seat] as readonly Card[],
    handSizes: hand.hands.map((cards) => cards.length),
    bids: hand.bids,
    bidSum,
    forbiddenBid,
    taken: hand.taken,
    leader: hand.leader,
    trick: hand.trick,
    lastTrick: state.lastTrick,
    table: scoreTable(state),
    legalActions: state.turn === seat ? legalActions(state) : [],
  };
}
