/**
 * Golden-сценарії: вручну описані роздачі з відомим результатом (AUTOPILOT §5 п.2).
 * Захищені файли — змінюються лише через PR з міткою `spec-change`.
 *
 * Нотація карт: ранг (6 7 8 9 10 В Д К Т) + масть (♠ ♣ ♦ ♥), напр. `10♥`, `Т♠`.
 * Джокери: `🃏0`, `🃏1`, за ними — оголошення: `беру`, `скидаю`, `старший козир`,
 * `старша <масть>`, `маленька <масть>`. Об'єкт `{ "illegal": … }` — дія, яку рушій
 * має відхилити в цей момент (після неї хід лишається за тим самим гравцем).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IllegalActionError,
  RANKS,
  apply,
  biddingOrder,
  cardId,
  createDeck,
  createGame,
  createSchedule,
  firstLeader,
  legalActions,
  scoreTable,
} from '../../src/index.js';
import type { Action, Card, GameState, HandPhase, JokerCall, Rank, Suit } from '../../src/index.js';

type Illegal<T> = { readonly illegal: T };

interface DealScenario {
  readonly kind: 'deal';
  readonly title: string;
  readonly rules: readonly string[];
  readonly players: number;
  /** Номер роздачі в розкладі гри, від 1 (R-2.1). */
  readonly hand: number;
  readonly phase: HandPhase;
  readonly cards: number;
  readonly dealer: number;
  /** Масть козиря або `null` («б/к»). */
  readonly trump: string | null;
  /** Руки одразу після роздачі за порядком місць. */
  readonly hands: readonly (readonly string[])[];
  /** Замовлення в порядку черги R-4.2. */
  readonly bids?: readonly (number | Illegal<number>)[];
  readonly tricks: readonly {
    readonly leader: number;
    readonly plays: readonly (string | Illegal<string>)[];
    readonly winner: number;
  }[];
  readonly expect: {
    readonly taken: readonly number[];
    readonly points: readonly number[];
    readonly circles: readonly number[];
    readonly final: readonly number[];
  };
}

interface SeedScenario {
  readonly kind: 'seed';
  readonly title: string;
  readonly rules: readonly string[];
  readonly seed: number;
  readonly players: number;
  readonly firstDealer: number;
  /** Перші роздачі гри: роздаючий, руки, відкрита карта й козир. */
  readonly deals: readonly {
    readonly dealer: number;
    readonly hands: readonly (readonly string[])[];
    readonly revealed: string | null;
    readonly trump: string | null;
  }[];
}

type Scenario = DealScenario | SeedScenario;

const SUIT_SYMBOLS: Record<string, Suit> = {
  '♠': 'spades',
  '♣': 'clubs',
  '♦': 'diamonds',
  '♥': 'hearts',
};
const RANK_NAMES: Record<string, Rank> = { В: 11, Д: 12, К: 13, Т: 14 };

function parseSuit(symbol: string): Suit {
  const suit = SUIT_SYMBOLS[symbol];
  if (suit === undefined) throw new Error(`Невідома масть «${symbol}»`);
  return suit;
}

function parseCard(text: string): Card {
  if (text === '🃏0' || text === '🃏1') return { kind: 'joker', index: text === '🃏0' ? 0 : 1 };
  const suit = parseSuit(text.slice(-1));
  const name = text.slice(0, -1);
  const rank = RANK_NAMES[name] ?? Number(name);
  if (!(RANKS as readonly number[]).includes(rank)) throw new Error(`Невідомий ранг «${text}»`);
  return { kind: 'standard', suit, rank: rank as Rank };
}

function formatCard(card: Card): string {
  if (card.kind === 'joker') return `🃏${card.index}`;
  const name = Object.entries(RANK_NAMES).find(([, rank]) => rank === card.rank)?.[0];
  const symbol = Object.entries(SUIT_SYMBOLS).find(([, suit]) => suit === card.suit)?.[0];
  return `${name ?? card.rank}${symbol}`;
}

function parseCall(text: string): JokerCall {
  if (text === 'беру') return { type: 'take' };
  if (text === 'скидаю') return { type: 'discard' };
  if (text === 'старший козир') return { type: 'highTrump' };
  const [word, symbol] = text.split(' ');
  if (word === 'старша' && symbol !== undefined) return { type: 'high', suit: parseSuit(symbol) };
  if (word === 'маленька' && symbol !== undefined) return { type: 'low', suit: parseSuit(symbol) };
  throw new Error(`Невідоме оголошення «${text}»`);
}

function playAction(seat: number, text: string): Action {
  const [cardText = '', ...callWords] = text.split(' ');
  const card = parseCard(cardText);
  return callWords.length > 0
    ? { type: 'play', seat, card, call: parseCall(callWords.join(' ')) }
    : { type: 'play', seat, card };
}

/** Стан гри на початку роздачі `scenario.hand` з заданими руками; ця роздача — остання. */
function stateForDeal(scenario: DealScenario): GameState {
  const { players, dealer } = scenario;
  const spec = createSchedule(players)[scenario.hand - 1];
  if (spec === undefined) throw new Error(`У розкладі немає роздачі ${scenario.hand}`);
  expect(spec.phase).toBe(scenario.phase);
  expect(spec.cards).toBe(scenario.cards);
  const trump = scenario.trump === null ? null : parseSuit(scenario.trump);
  if (spec.trump.kind === 'fixed') expect(trump).toBe(spec.trump.suit);
  if (spec.trump.kind === 'none') expect(trump).toBeNull();

  const hands = scenario.hands.map((hand) => hand.map(parseCard));
  expect(hands).toHaveLength(players);
  for (const hand of hands) expect(hand).toHaveLength(spec.cards);
  const ids = hands.flat().map(cardId);
  expect(new Set(ids).size).toBe(ids.length);

  const base = createGame(1, players);
  const leader = firstLeader(dealer, players);
  return {
    ...base,
    firstDealer: (((dealer - spec.index) % players) + players) % players,
    handSeeds: base.handSeeds.slice(0, spec.index + 1),
    status: spec.bidding ? 'bidding' : 'playing',
    turn: leader,
    hand: {
      spec,
      dealer,
      trump,
      revealed: null,
      dealt: hands,
      hands,
      bids: hands.map(() => null),
      taken: hands.map(() => 0),
      leader,
      trick: [],
    },
  };
}

function applyOrReject<T>(
  state: GameState,
  step: T | Illegal<T>,
  toAction: (value: T) => Action,
): GameState {
  if (typeof step === 'object' && step !== null && 'illegal' in step) {
    expect(() => apply(state, toAction(step.illegal))).toThrow(IllegalActionError);
    return state;
  }
  return apply(state, toAction(step));
}

function runDeal(scenario: DealScenario): void {
  const { players } = scenario;
  let state = stateForDeal(scenario);

  if (state.hand.spec.bidding) {
    const order = biddingOrder(scenario.dealer, players);
    let turn = 0;
    for (const step of scenario.bids ?? []) {
      const seat = order[turn] as number;
      state = applyOrReject(state, step, (bid) => ({ type: 'bid', seat, bid }));
      if (typeof step === 'number') turn++;
    }
    expect(state.status).toBe('playing');
  } else {
    // R-4.1: у «Мізері» й «Відіграші» замовлень немає.
    expect(scenario.bids).toBeUndefined();
    expect(() => apply(state, { type: 'bid', seat: state.turn as number, bid: 0 })).toThrow(
      IllegalActionError,
    );
  }

  for (const trick of scenario.tricks) {
    expect(state.hand.leader).toBe(trick.leader);
    let position = 0;
    for (const step of trick.plays) {
      const seat = (trick.leader + position) % players;
      state = applyOrReject(state, step, (text) => playAction(seat, text));
      if (typeof step === 'string') position++;
    }
    expect(position).toBe(players);
    expect(state.lastTrick?.winner).toBe(trick.winner);
  }

  expect(state.status).toBe('finished');
  const table = scoreTable(state);
  const row = table.rows.at(-1);
  expect(row?.players.map((cell) => cell.taken)).toEqual(scenario.expect.taken);
  expect(row?.players.map((cell) => cell.points)).toEqual(scenario.expect.points);
  expect(row?.players.map((cell) => cell.circles)).toEqual(scenario.expect.circles);
  expect(table.summary.map((summary) => summary.final)).toEqual(scenario.expect.final);
}

function runSeed(scenario: SeedScenario): void {
  let state = createGame(scenario.seed, scenario.players);
  expect(state.firstDealer).toBe(scenario.firstDealer);
  scenario.deals.forEach((expected, index) => {
    expect(state.hand.spec.index).toBe(index);
    expect(state.hand.dealer).toBe(expected.dealer);
    expect(state.hand.dealt.map((hand) => hand.map(formatCard))).toEqual(expected.hands);
    const revealed = state.hand.revealed === null ? null : formatCard(state.hand.revealed);
    expect(revealed).toBe(expected.revealed);
    expect(state.hand.trump).toBe(expected.trump === null ? null : parseSuit(expected.trump));
    // Роздача залежить лише від seed, тож до наступної доходимо першими легальними діями.
    while (state.status !== 'finished' && state.hand.spec.index === index) {
      state = apply(state, legalActions(state)[0] as Action);
    }
  });
}

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .sort();

describe('golden-сценарії', () => {
  it('є сценарії й колода нотації повна', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(new Set(createDeck().map((card) => formatCard(card))).size).toBe(38);
    for (const card of createDeck()) expect(cardId(parseCard(formatCard(card)))).toBe(cardId(card));
  });

  for (const file of files) {
    const scenario = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Scenario;
    it(`${file}: ${scenario.title} (${scenario.rules.join(', ')})`, () => {
      if (scenario.kind === 'deal') runDeal(scenario);
      else runSeed(scenario);
    });
  }
});
