/** Опції кімнати (§10): «Темна» (R-10.2) і «не більше трьох нулів поспіль» (R-10.3). */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  apply,
  biddingOrder,
  buildScoreTable,
  createGame,
  createSchedule,
  gameLog,
  legalActions,
  maxCardsPerHand,
  replay,
  scoreHand,
  viewFor,
  zeroBidForbidden,
} from '../src/index.js';
import type { Action, Card, GameOptions, GameState, HandRecord } from '../src/index.js';

const DARK: GameOptions = { dark: true, zeroLimit: false };
const ZERO_LIMIT: GameOptions = { dark: false, zeroLimit: true };
const BOTH: GameOptions = { dark: true, zeroLimit: true };

/** Перша легальна дія; для замовлень — найменше легальне (0, якщо можна). */
function firstAction(state: GameState): Action {
  return legalActions(state)[0] as Action;
}

/** Грає першими легальними діями, доки не виконається умова. */
function playUntil(state: GameState, stop: (state: GameState) => boolean): GameState {
  let current = state;
  for (let step = 0; step < 20_000 && !stop(current); step++) {
    current = apply(current, firstAction(current));
  }
  return current;
}

const darkIndex = (playerCount: number): number =>
  createSchedule(playerCount, DARK).findIndex((spec) => spec.phase === 'dark');

describe('R-10.1: опції фіксуються разом із грою', () => {
  it('R-10.1: за замовчуванням усі опції вимкнені й розклад — за R-2.1', () => {
    expect(DEFAULT_OPTIONS).toEqual({ dark: false, zeroLimit: false });
    for (let n = 3; n <= 6; n++) {
      const game = createGame(7, n);
      expect(game.options).toEqual(DEFAULT_OPTIONS);
      expect(createSchedule(n)).toEqual(createSchedule(n, DEFAULT_OPTIONS));
      expect(createSchedule(n).some((spec) => spec.phase === 'dark')).toBe(false);
      expect(game.handSeeds).toHaveLength(createSchedule(n).length);
    }
  });

  it('R-10.1: вимкнені опції не змінюють гру, створену без них', () => {
    expect(createGame(42, 4, DEFAULT_OPTIONS)).toEqual(createGame(42, 4));
  });

  it('R-10.1: опції входять у лог, і replay відтворює гру з ними', () => {
    const state = playUntil(createGame(5, 4, BOTH), (s) => s.actions.length >= 300);
    const log = gameLog(state);
    expect(log.options).toEqual(BOTH);
    const replayed = replay(5, JSON.parse(JSON.stringify(log)));
    expect(replayed).toEqual(state);
    expect(replayed.options).toEqual(BOTH);
  });

  it('R-10.1: лог без опцій (збережений до §10) відтворюється з вимкненими опціями', () => {
    const state = playUntil(createGame(9, 3), (s) => s.actions.length >= 40);
    const { version, playerCount, actions } = gameLog(state);
    expect(replay(9, { version, playerCount, actions })).toEqual(state);
  });

  it('R-10.1: опції видно всім гравцям', () => {
    const state = createGame(3, 5, BOTH);
    for (let seat = 0; seat < 5; seat++) expect(viewFor(state, seat).options).toEqual(BOTH);
  });
});

describe('R-10.2: «Темна»', () => {
  it('R-10.2: одна роздача по MAX карт після безкозирки й перед мізером', () => {
    for (let n = 3; n <= 6; n++) {
      const plain = createSchedule(n);
      const dark = createSchedule(n, DARK);
      expect(dark).toHaveLength(plain.length + 1);
      const index = darkIndex(n);
      expect(dark.filter((spec) => spec.phase === 'dark')).toHaveLength(1);
      expect(dark[index - 1]?.phase).toBe('noTrump');
      expect(dark[index + 1]?.phase).toBe('misere');
      expect(dark[index]).toEqual({
        index,
        phase: 'dark',
        cards: maxCardsPerHand(n),
        trump: { kind: 'revealed' },
        bidding: true,
      });
      dark.forEach((spec, i) => expect(spec.index).toBe(i));
      expect(createGame(1, n, DARK).handSeeds).toHaveLength(dark.length);
    }
  });

  it('R-10.2: козир — з відкритої карти колоди (R-3.1, R-3.2), видно всім до замовлень', () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = playUntil(
        createGame(seed, 4, DARK),
        (s) => s.hand.spec.phase === 'dark' || s.status === 'finished',
      );
      expect(state.hand.spec.phase).toBe('dark');
      expect(state.status).toBe('bidding');
      const { revealed, trump } = state.hand;
      expect(revealed).not.toBeNull();
      expect(trump).toBe(revealed?.kind === 'joker' ? null : revealed?.suit);
      const view = viewFor(state, 0);
      expect(view.revealed).toEqual(revealed);
      expect(view.trump).toBe(trump);
    }
  });

  it('R-10.2: рука прихована, доки не замовить роздаючий; замовляють за R-4.2', () => {
    let state = playUntil(createGame(11, 4, DARK), (s) => s.hand.spec.phase === 'dark');
    const order = biddingOrder(state.hand.dealer, 4);
    for (const seat of order) {
      expect(state.turn).toBe(seat);
      for (let other = 0; other < 4; other++) {
        const view = viewFor(state, other);
        expect(view.blind).toBe(true);
        expect(view.hand).toEqual([]);
        expect(view.handSizes).toEqual([9, 9, 9, 9]);
        // Жодної карти, крім відкритої (R-3.1) і минулої взятки, у погляді немає.
        const rest = { ...view, revealed: null, lastTrick: null };
        expect(JSON.stringify(rest)).not.toMatch(/"suit":"|"rank":/);
      }
      state = apply(state, firstAction(state));
    }
    expect(state.status).toBe('playing');
    for (let seat = 0; seat < 4; seat++) {
      const view = viewFor(state, seat);
      expect(view.blind).toBe(false);
      expect(view.hand).toEqual(state.hand.hands[seat]);
    }
  });

  it('R-10.2: у звичайних роздачах рука видна під час замовлень', () => {
    const state = createGame(11, 4, DARK);
    expect(state.status).toBe('bidding');
    expect(viewFor(state, 0).blind).toBe(false);
    expect(viewFor(state, 0).hand).toHaveLength(1);
  });

  it('R-10.2: роздаючому заборонене значення за R-4.4', () => {
    let state = playUntil(createGame(12, 3, DARK), (s) => s.hand.spec.phase === 'dark');
    const order = biddingOrder(state.hand.dealer, 3);
    state = apply(state, { type: 'bid', seat: order[0] as number, bid: 5 });
    state = apply(state, { type: 'bid', seat: order[1] as number, bid: 4 });
    const dealer = order[2] as number;
    expect(viewFor(state, dealer).forbiddenBid).toBe(3);
    expect(legalActions(state).some((a) => a.type === 'bid' && a.bid === 3)).toBe(false);
    expect(() => apply(state, { type: 'bid', seat: dealer, bid: 3 })).toThrow();
  });

  it('R-10.2: бали за роздачу (R-7.1–R-7.4) множаться на 2', () => {
    const spec = createSchedule(4, DARK)[darkIndex(4)];
    if (spec === undefined) throw new Error('Немає темної');
    expect(scoreHand(spec, 3, 3)).toBe(60);
    expect(scoreHand(spec, 0, 0)).toBe(10);
    expect(scoreHand(spec, 2, 4)).toBe(8);
    expect(scoreHand(spec, 0, 2)).toBe(4);
    expect(scoreHand(spec, 4, 1)).toBe(-60);
  });

  it('R-10.2: джокери рахуються за R-7.7 без множника', () => {
    const spec = createSchedule(3, DARK)[darkIndex(3)];
    if (spec === undefined) throw new Error('Немає темної');
    const joker = (index: 0 | 1): Card => ({ kind: 'joker', index });
    const filler = Array.from({ length: 11 }, (): Card => ({
      kind: 'standard',
      suit: 'spades',
      rank: 6,
    }));
    const record: HandRecord = {
      spec,
      dealer: 0,
      trump: null,
      hands: [
        [joker(0), joker(1), ...filler.slice(1)],
        [...filler, ...filler.slice(0, 1)],
        [...filler, ...filler.slice(0, 1)],
      ],
      bids: [2, 5, 4],
      taken: [2, 6, 4],
      completed: true,
    };
    const table = buildScoreTable([record], 3);
    expect(table.rows[0]?.players.map((cell) => cell.points)).toEqual([40, 12, 80]);
    expect(table.rows[0]?.players.map((cell) => cell.circles)).toEqual([2, 0, 0]);
    expect(table.summary.map((s) => s.final)).toEqual([20, 12, 80]);
  });

  it('R-10.2: гра з «Темною» завершується після всіх роздач розкладу', () => {
    for (let n = 3; n <= 6; n++) {
      const state = playUntil(createGame(n, n, DARK), (s) => s.status === 'finished');
      expect(state.status).toBe('finished');
      expect(state.history.map((r) => r.spec.phase)).toEqual(
        createSchedule(n, DARK).map((s) => s.phase),
      );
    }
  });
});

describe('R-10.3: не більше трьох нулів поспіль', () => {
  it('R-10.3: після трьох нулів поспіль 0 заборонений', () => {
    expect(zeroBidForbidden([0, 0, 0])).toBe(true);
    expect(zeroBidForbidden([1, 0, 0, 0])).toBe(true);
    expect(zeroBidForbidden([0, 0])).toBe(false);
    expect(zeroBidForbidden([0, 0, 0, 2])).toBe(false);
    expect(zeroBidForbidden([0, 1, 0, 0])).toBe(false);
    expect(zeroBidForbidden([])).toBe(false);
  });

  it('R-10.3: роздачі без замовлень послідовність не переривають і не продовжують', () => {
    expect(zeroBidForbidden([0, null, 0, null, null, 0])).toBe(true);
    expect(zeroBidForbidden([0, 0, null])).toBe(false);
    expect(zeroBidForbidden([0, 0, 0, null])).toBe(true);
  });

  /** Гравці замовляють 0, коли можна; інакше найменше легальне. */
  function zeroesFirstThreeHands(options: GameOptions): GameState {
    return playUntil(createGame(21, 4, options), (s) => s.hand.spec.index === 3);
  }

  it('R-10.3: у четвертій роздачі поспіль гравець не може замовити 0', () => {
    const state = zeroesFirstThreeHands(ZERO_LIMIT);
    for (const record of state.history) expect(record.bids).toEqual([0, 0, 0, 0]);
    const seat = state.turn as number;
    const bids = legalActions(state).map((a) => (a.type === 'bid' ? a.bid : -1));
    expect(bids).toEqual([1, 2, 3, 4]);
    expect(() => apply(state, { type: 'bid', seat, bid: 0 })).toThrow();
    expect(viewFor(state, seat).zeroForbidden).toBe(true);
  });

  it('R-10.3: без опції 0 можна замовляти скільки завгодно разів поспіль', () => {
    const state = zeroesFirstThreeHands(DEFAULT_OPTIONS);
    expect(legalActions(state)[0]).toMatchObject({ type: 'bid', bid: 0 });
    expect(viewFor(state, state.turn as number).zeroForbidden).toBe(false);
  });

  it('R-10.3: ненульове замовлення перериває послідовність', () => {
    let state = zeroesFirstThreeHands(ZERO_LIMIT);
    state = playUntil(state, (s) => s.hand.spec.index === 4);
    // У роздачі 4 ніхто не міг замовити 0 — у роздачі 5 нуль знову можна.
    expect(state.history[3]?.bids.every((bid) => (bid as number) > 0)).toBe(true);
    expect(legalActions(state)[0]).toMatchObject({ type: 'bid', bid: 0 });
  });

  it('R-10.3, R-4.4: якщо заборонено два значення, інші лишаються доступними', () => {
    let state = zeroesFirstThreeHands(ZERO_LIMIT);
    const order = biddingOrder(state.hand.dealer, 4);
    for (const [i, bid] of [1, 1, 2].entries()) {
      state = apply(state, { type: 'bid', seat: order[i] as number, bid });
    }
    // Сума інших 4: R-4.4 і R-10.3 забороняють те саме значення 0.
    expect(legalActions(state).map((a) => (a.type === 'bid' ? a.bid : -1))).toEqual([1, 2, 3, 4]);
    let other = zeroesFirstThreeHands(ZERO_LIMIT);
    for (const [i, bid] of [1, 1, 1].entries()) {
      other = apply(other, { type: 'bid', seat: order[i] as number, bid });
    }
    // Сума інших 3: R-4.4 забороняє 1, R-10.3 — 0.
    expect(viewFor(other, order[3] as number).forbiddenBid).toBe(1);
    expect(legalActions(other).map((a) => (a.type === 'bid' ? a.bid : -1))).toEqual([2, 3, 4]);
  });

  it('R-10.3, R-10.2: «Темна» — звичайна роздача із замовленням', () => {
    const dark = darkIndex(3);
    let state = createGame(33, 3, BOTH);
    // Нулі — лише в трьох роздачах перед темною; раніше — найбільше легальне замовлення.
    while (state.hand.spec.phase !== 'dark') {
      const actions = legalActions(state);
      const zeroes = state.hand.spec.index >= dark - 3;
      state = apply(state, (zeroes ? actions[0] : actions.at(-1)) as Action);
    }
    for (let i = 0; i < 3; i++) {
      const seat = state.turn as number;
      expect(viewFor(state, seat).zeroForbidden).toBe(true);
      expect(legalActions(state).some((a) => a.type === 'bid' && a.bid === 0)).toBe(false);
      state = apply(state, legalActions(state)[0] as Action);
    }
  });
});
