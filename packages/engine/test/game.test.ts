import { describe, expect, it } from 'vitest';
import {
  ENGINE_LOG_VERSION,
  IllegalActionError,
  UnsupportedLogVersionError,
  apply,
  biddingOrder,
  cardId,
  createGame,
  createRng,
  createSchedule,
  gameLog,
  isJoker,
  legalActions,
  migrateLog,
  replay,
  scoreTable,
  viewFor,
} from '../src/index.js';
import type { Action, Card, GameLog, GameState, LogMigration, Rng } from '../src/index.js';

/** Випадковий легальний хід — детермінований через окремий seed RNG. */
function randomAction(state: GameState, rng: Rng): Action {
  const actions = legalActions(state);
  return actions[rng.nextInt(actions.length)] as Action;
}

function playUntil(
  state: GameState,
  rng: Rng,
  stop: (state: GameState) => boolean,
  limit = 10_000,
): GameState {
  let current = state;
  for (let step = 0; step < limit && !stop(current); step++) {
    current = apply(current, randomAction(current, rng));
  }
  return current;
}

function playToEnd(seed: number, playerCount: number, movesSeed = seed + 1): GameState {
  return playUntil(
    createGame(seed, playerCount),
    createRng(movesSeed),
    (s) => s.status === 'finished',
  );
}

/** Замовлення, яке гравець на черзі може зробити (для роздаючого — не заборонене). */
function firstLegalBid(state: GameState): Action {
  const bid = legalActions(state).find((action) => action.type === 'bid');
  if (bid === undefined) throw new Error('Немає легального замовлення');
  return bid;
}

function bidAll(state: GameState): GameState {
  let current = state;
  while (current.status === 'bidding') current = apply(current, firstLegalBid(current));
  return current;
}

describe('створення гри', () => {
  it('R-2.3: same seed gives the same initial state', () => {
    expect(createGame(42, 4)).toEqual(createGame(42, 4));
    expect(createGame(42, 4).hand.dealt).not.toEqual(createGame(43, 4).hand.dealt);
  });

  it('R-2.1: game starts with the first hand of the schedule, 1 card each', () => {
    const state = createGame(7, 5);
    expect(state.hand.spec).toEqual(createSchedule(5)[0]);
    expect(state.hand.hands.map((hand) => hand.length)).toEqual([1, 1, 1, 1, 1]);
    expect(state.status).toBe('bidding');
  });

  it('R-1.2: rejects player count outside 3…6', () => {
    expect(() => createGame(1, 2)).toThrow(RangeError);
    expect(() => createGame(1, 7)).toThrow(RangeError);
  });

  it('R-4.2: the player left of the dealer bids first', () => {
    const state = createGame(11, 4);
    expect(state.turn).toBe((state.hand.dealer + 1) % 4);
  });

  it('R-3.1: trump of an ascending hand is the suit of the revealed card', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { hand } = createGame(seed, 3);
      expect(hand.revealed).not.toBeNull();
      const revealed = hand.revealed as Card;
      expect(hand.trump).toBe(isJoker(revealed) ? null : revealed.suit);
    }
  });
});

describe('apply: замовлення', () => {
  it('R-4.2: bids go clockwise and the dealer bids last', () => {
    let state = createGame(3, 4);
    const order = biddingOrder(state.hand.dealer, 4);
    const seen: number[] = [];
    while (state.status === 'bidding') {
      seen.push(state.turn as number);
      state = apply(state, firstLegalBid(state));
    }
    expect(seen).toEqual(order);
  });

  it('R-4.3: rejects a bid outside 0…K', () => {
    const state = createGame(5, 3);
    const seat = state.turn as number;
    expect(() => apply(state, { type: 'bid', seat, bid: 2 })).toThrow(IllegalActionError);
    expect(() => apply(state, { type: 'bid', seat, bid: -1 })).toThrow(IllegalActionError);
  });

  it('R-4.6: in a 1-card hand the dealer may make sum equal to cards dealt', () => {
    let state = createGame(5, 3);
    // Роздача на 1 карту: двоє перших замовляють 0, роздаючий може замовити 1.
    state = apply(state, { type: 'bid', seat: state.turn as number, bid: 0 });
    state = apply(state, { type: 'bid', seat: state.turn as number, bid: 0 });
    const dealer = state.turn as number;
    expect(dealer).toBe(state.hand.dealer);
    expect(viewFor(state, dealer).forbiddenBid).toBeNull();
    expect(legalActions(state)).toHaveLength(2);
    expect(apply(state, { type: 'bid', seat: dealer, bid: 1 }).status).toBe('playing');
  });

  it('R-4.4: dealer cannot make sum equal to cards dealt', () => {
    let state = createGame(5, 3);
    // Перші три роздачі (1–3 карти, R-4.6) — без обмеження; далі роздача на 4 карти.
    while (state.hand.spec.cards < 4) state = apply(state, legalActions(state)[0] as Action);
    expect(state.status).toBe('bidding');
    state = apply(state, { type: 'bid', seat: state.turn as number, bid: 1 });
    state = apply(state, { type: 'bid', seat: state.turn as number, bid: 1 });
    const dealer = state.turn as number;
    expect(dealer).toBe(state.hand.dealer);
    expect(viewFor(state, dealer).forbiddenBid).toBe(2);
    expect(() => apply(state, { type: 'bid', seat: dealer, bid: 2 })).toThrow(IllegalActionError);
    expect(apply(state, { type: 'bid', seat: dealer, bid: 0 }).status).toBe('playing');
  });

  it('rejects an action from a player out of turn', () => {
    const state = createGame(5, 3);
    const other = ((state.turn as number) + 1) % 3;
    expect(() => apply(state, { type: 'bid', seat: other, bid: 0 })).toThrow(IllegalActionError);
  });

  it('rejects a card play during bidding', () => {
    const state = createGame(5, 3);
    const seat = state.turn as number;
    const card = state.hand.hands[seat]?.[0] as Card;
    expect(() => apply(state, { type: 'play', seat, card })).toThrow(IllegalActionError);
  });

  it('does not mutate the input state', () => {
    const state = createGame(9, 4);
    const snapshot = structuredClone(state);
    apply(state, firstLegalBid(state));
    expect(state).toEqual(snapshot);
  });
});

describe('apply: розіграш', () => {
  it('R-5.1: the player left of the dealer leads the first trick', () => {
    const state = bidAll(createGame(21, 4));
    expect(state.status).toBe('playing');
    expect(state.turn).toBe((state.hand.dealer + 1) % 4);
    expect(state.hand.leader).toBe(state.turn);
  });

  it('R-5.2: rejects a card that does not follow the obligation', () => {
    const illegalCard = (state: GameState): Card | undefined => {
      if (state.status !== 'playing') return undefined;
      const legal = new Set(
        legalActions(state).map((action) => (action.type === 'play' ? cardId(action.card) : '')),
      );
      return state.hand.hands[state.turn as number]?.find((card) => !legal.has(cardId(card)));
    };
    const state = playUntil(
      createGame(12, 3),
      createRng(1),
      (s) => s.status === 'finished' || illegalCard(s) !== undefined,
    );
    const card = illegalCard(state) as Card;
    expect(card).toBeDefined();
    expect(() => apply(state, { type: 'play', seat: state.turn as number, card })).toThrow(
      IllegalActionError,
    );
  });

  it('rejects a card the player does not hold', () => {
    const state = bidAll(createGame(21, 4));
    const seat = state.turn as number;
    const foreign = state.hand.hands[(seat + 1) % 4]?.[0] as Card;
    expect(() => apply(state, { type: 'play', seat, card: foreign })).toThrow(IllegalActionError);
  });

  it('R-6.1: a joker must be played with a legal call', () => {
    const rng = createRng(2);
    for (let seed = 0; seed < 300; seed++) {
      let state = bidAll(createGame(seed, 3));
      state = playUntil(state, rng, (s) => {
        const hand = s.hand.hands[s.turn as number] ?? [];
        return s.status !== 'playing' || (s.hand.trick.length === 0 && hand.some(isJoker));
      });
      if (state.status !== 'playing' || state.hand.trick.length !== 0) continue;
      const seat = state.turn as number;
      const joker = state.hand.hands[seat]?.find(isJoker) as Card;
      expect(() => apply(state, { type: 'play', seat, card: joker })).toThrow(IllegalActionError);
      // «Беру» на заході неможливе (R-6.4 — лише не на заході).
      expect(() =>
        apply(state, { type: 'play', seat, card: joker, call: { type: 'take' } }),
      ).toThrow(IllegalActionError);
      const next = apply(state, {
        type: 'play',
        seat,
        card: joker,
        call: { type: 'low', suit: 'hearts' },
      });
      expect(next.hand.trick[0]).toEqual({ ...joker, call: { type: 'low', suit: 'hearts' } });
      return;
    }
    throw new Error('Не знайдено заходу джокером');
  });

  it('rejects a call on a standard card', () => {
    const state = bidAll(createGame(21, 4));
    const seat = state.turn as number;
    const card = state.hand.hands[seat]?.find((c) => !isJoker(c));
    if (card === undefined) return;
    expect(() => apply(state, { type: 'play', seat, card, call: { type: 'discard' } })).toThrow(
      IllegalActionError,
    );
  });

  it('R-5.1: the winner of a trick leads the next one and gets the trick', () => {
    let state = bidAll(createGame(31, 3));
    // Роздача на 1 карту: після взятки роздача закінчується, тому граємо другу (2 карти).
    state = playUntil(state, createRng(5), (s) => s.hand.spec.index === 1);
    state = bidAll(state);
    const rng = createRng(6);
    for (let i = 0; i < 3; i++) state = apply(state, randomAction(state, rng));
    const last = state.lastTrick;
    expect(last).not.toBeNull();
    expect(state.turn).toBe(last?.winner);
    expect(state.hand.leader).toBe(last?.winner);
    expect(state.hand.taken[last?.winner as number]).toBe(1);
    expect(state.hand.taken.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('R-9.2: the last trick stays visible until the first card of the next trick', () => {
    let state = playUntil(createGame(8, 3), createRng(3), (s) => s.hand.spec.index === 1);
    state = bidAll(state);
    const rng = createRng(4);
    for (let i = 0; i < 3; i++) state = apply(state, randomAction(state, rng));
    expect(state.lastTrick?.cards).toHaveLength(3);
    expect(state.hand.trick).toHaveLength(0);
    state = apply(state, randomAction(state, rng));
    expect(state.lastTrick).toBeNull();
    expect(state.hand.trick).toHaveLength(1);
  });

  it('R-2.2: after a hand the next player deals', () => {
    const start = createGame(13, 4);
    const next = playUntil(start, createRng(1), (s) => s.hand.spec.index === 1);
    expect(next.hand.dealer).toBe((start.hand.dealer + 1) % 4);
    expect(next.hand.hands.map((hand) => hand.length)).toEqual([2, 2, 2, 2]);
    expect(next.status).toBe('bidding');
  });

  it('R-4.1: misere and comeback hands skip bidding', () => {
    for (const phase of ['misere', 'comeback'] as const) {
      const state = playUntil(createGame(17, 3), createRng(9), (s) => s.hand.spec.phase === phase);
      expect(state.status).toBe('playing');
      expect(state.hand.bids).toEqual([null, null, null]);
      expect(state.turn).toBe((state.hand.dealer + 1) % 3);
    }
  });
});

describe('повна гра', () => {
  it.each([3, 4, 5, 6])('R-2.1: a full game with %i players plays every hand', (n) => {
    const state = playToEnd(100 + n, n);
    expect(state.status).toBe('finished');
    expect(state.turn).toBeNull();
    expect(state.history).toHaveLength(createSchedule(n).length);
    for (const record of state.history) {
      expect(record.completed).toBe(true);
      expect(record.taken.reduce((a, b) => a + b, 0)).toBe(record.spec.cards);
    }
    expect(() => apply(state, { type: 'bid', seat: 0, bid: 0 })).toThrow(IllegalActionError);
    expect(legalActions(state)).toEqual([]);
  });

  it('R-4.4, R-4.6: in every hand of 4+ cards the sum of bids differs from cards dealt', () => {
    const state = playToEnd(55, 4);
    for (const record of state.history.filter((r) => r.spec.bidding && r.spec.cards >= 4)) {
      const sum = record.bids.reduce<number>((a, b) => a + (b ?? 0), 0);
      expect(sum).not.toBe(record.spec.cards);
    }
  });

  it('R-7.7: final table penalises every joker dealt during the game', () => {
    const state = playToEnd(56, 5);
    const table = scoreTable(state);
    expect(table.rows).toHaveLength(createSchedule(5).length);
    const jokers = [0, 1, 2, 3, 4].map((seat) =>
      state.history.reduce(
        (sum, record) => sum + (record.hands[seat] ?? []).filter(isJoker).length,
        0,
      ),
    );
    expect(table.summary.map((s) => s.circles)).toEqual(jokers);
    // Кожна роздача роздає обидва джокери, лише якщо вони не в решті колоди.
    expect(jokers.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2 * state.history.length);
  });
});

describe('replay', () => {
  it('R-2.3: replay(seed, log) reproduces the same final state', () => {
    for (const n of [3, 4, 5, 6]) {
      const state = playToEnd(200 + n, n);
      expect(replay(state.seed, gameLog(state))).toEqual(state);
    }
  });

  it('R-2.3: replay reproduces a game stopped mid-hand', () => {
    const state = playUntil(createGame(77, 4), createRng(1), (s) => s.actions.length >= 37);
    expect(replay(77, gameLog(state))).toEqual(state);
  });

  it('log is serialisable and carries its version', () => {
    const state = playToEnd(300, 3);
    const log = gameLog(state);
    expect(log.version).toBe(ENGINE_LOG_VERSION);
    expect(log.playerCount).toBe(3);
    expect(replay(300, JSON.parse(JSON.stringify(log)))).toEqual(state);
  });

  it('rejects a log of an unknown version', () => {
    expect(() => replay(1, { version: 999, playerCount: 3, actions: [] })).toThrow(
      UnsupportedLogVersionError,
    );
  });

  it('R-2.3: a log of a newer engine version is rejected with a readable message', () => {
    const log = { version: ENGINE_LOG_VERSION + 1, playerCount: 3, actions: [] };
    expect(() => migrateLog(log)).toThrow(UnsupportedLogVersionError);
    try {
      replay(1, log);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedLogVersionError);
      expect((error as UnsupportedLogVersionError).version).toBe(ENGINE_LOG_VERSION + 1);
      expect((error as Error).message).toContain(`версії ${ENGINE_LOG_VERSION + 1}`);
    }
  });

  it('R-2.3: a log of the current version is not migrated', () => {
    const log = gameLog(playUntil(createGame(5, 3), createRng(2), (s) => s.actions.length >= 10));
    expect(migrateLog(log)).toBe(log);
  });

  it('R-2.3: an old log is migrated step by step to the current version and replayed', () => {
    const state = playUntil(createGame(9, 4), createRng(3), (s) => s.actions.length >= 20);
    // Уявна стара версія, де місце гравця звалося `player`; міграції повертають `seat`.
    const old = {
      version: ENGINE_LOG_VERSION - 2,
      playerCount: 4,
      actions: state.actions.map(({ seat, ...rest }) => ({ ...rest, player: seat })),
    };
    const migrations: Record<number, LogMigration> = {
      [ENGINE_LOG_VERSION - 2]: (log) => ({ ...log, version: ENGINE_LOG_VERSION - 1 }),
      [ENGINE_LOG_VERSION - 1]: (log) => {
        const { actions } = log as unknown as typeof old;
        return {
          ...log,
          version: ENGINE_LOG_VERSION,
          actions: actions.map(({ player, ...rest }) => ({ ...rest, seat: player })),
        };
      },
    };
    const migrated = migrateLog(old, migrations) as unknown as GameLog;
    expect(migrated.version).toBe(ENGINE_LOG_VERSION);
    expect(replay(9, migrated)).toEqual(state);
  });

  it('R-2.3: an old log without a migration path is rejected', () => {
    const old = { version: ENGINE_LOG_VERSION - 1, playerCount: 3, actions: [] };
    expect(() => migrateLog(old, {})).toThrow(UnsupportedLogVersionError);
    expect(() => migrateLog(old, { [old.version]: (log) => log })).toThrow(
      UnsupportedLogVersionError,
    );
    expect(() => migrateLog({ ...old, version: 1.5 })).toThrow(UnsupportedLogVersionError);
  });

  it('rejects a log containing an illegal action', () => {
    expect(() =>
      replay(1, {
        version: ENGINE_LOG_VERSION,
        playerCount: 3,
        actions: [{ type: 'bid', seat: 0, bid: 99 }],
      }),
    ).toThrow(IllegalActionError);
  });
});

describe('viewFor', () => {
  function otherCards(state: GameState, seat: number): Card[] {
    return state.hand.hands.flatMap((hand, s) => (s === seat ? [] : hand));
  }

  it("hides other players' hands and shows only their sizes", () => {
    const state = createGame(61, 4);
    for (let seat = 0; seat < 4; seat++) {
      const view = viewFor(state, seat);
      expect(view.hand).toEqual(state.hand.hands[seat]);
      expect(view.handSizes).toEqual([1, 1, 1, 1]);
      const text = JSON.stringify(view);
      for (const card of otherCards(state, seat)) {
        expect(text.includes(JSON.stringify(card)), `${cardId(card)} видна гравцю ${seat}`).toBe(
          false,
        );
      }
    }
  });

  it("does not leak other players' cards through the whole game", () => {
    let state = createGame(62, 3);
    const rng = createRng(63);
    while (state.status !== 'finished') {
      for (let seat = 0; seat < 3; seat++) {
        const view = viewFor(state, seat);
        expect(view.hand).toEqual(state.hand.hands[seat]);
        expect(view).not.toHaveProperty('hands');
        expect(view).not.toHaveProperty('dealt');
        expect(view).not.toHaveProperty('handSeeds');
      }
      state = apply(state, randomAction(state, rng));
    }
  });

  it('R-8.3: circles are hidden until the hand is completed', () => {
    let state = createGame(64, 3);
    const view = viewFor(state, 0);
    const current = view.table.rows.at(-1);
    expect(current?.players.every((cell) => cell.circles === null)).toBe(true);
    state = playUntil(state, createRng(1), (s) => s.hand.spec.index === 1);
    const after = viewFor(state, 0).table.rows[0];
    const jokers = state.history[0]?.hands.map((hand) => hand.filter(isJoker).length);
    expect(after?.players.map((cell) => cell.circles)).toEqual(jokers);
    expect(viewFor(state, 0).table.rows[1]?.players.every((c) => c.circles === null)).toBe(true);
  });

  it('R-4.5: bids are open to everyone and the view shows the sum and forbidden value', () => {
    let state = playUntil(createGame(65, 3), createRng(1), (s) => s.hand.spec.cards === 4);
    expect(state.status).toBe('bidding');
    state = apply(state, { type: 'bid', seat: state.turn as number, bid: 0 });
    state = apply(state, { type: 'bid', seat: state.turn as number, bid: 1 });
    for (let seat = 0; seat < 3; seat++) {
      const view = viewFor(state, seat);
      expect(view.bids).toEqual(state.hand.bids);
      expect(view.bidSum).toBe(1);
      expect(view.forbiddenBid).toBe(3);
    }
  });

  it('R-4.5, R-4.6: in hands of 1–3 cards the view has no forbidden value', () => {
    let state = createGame(65, 3);
    state = apply(state, { type: 'bid', seat: state.turn as number, bid: 0 });
    state = apply(state, { type: 'bid', seat: state.turn as number, bid: 1 });
    for (let seat = 0; seat < 3; seat++) {
      const view = viewFor(state, seat);
      expect(view.bidSum).toBe(1);
      expect(view.forbiddenBid).toBeNull();
    }
  });

  it('lists legal moves only for the player on turn', () => {
    const state = createGame(66, 4);
    const turn = state.turn as number;
    for (let seat = 0; seat < 4; seat++) {
      const view = viewFor(state, seat);
      expect(view.legalActions).toEqual(seat === turn ? legalActions(state) : []);
    }
  });

  it('rejects an invalid seat', () => {
    expect(() => viewFor(createGame(1, 3), 3)).toThrow(RangeError);
  });
});
