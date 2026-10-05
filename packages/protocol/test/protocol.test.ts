import {
  type Action,
  type Card,
  type GameOptions,
  type GameState,
  type JokerCall,
  apply,
  createGame,
  createRng,
  legalActions,
  viewFor,
} from '@poker/engine';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BUG_DESCRIPTION_MAX_LENGTH,
  CLIENT_EVENTS,
  ERROR_CODES,
  PROTOCOL_VERSION,
  ROOM_CODE_LENGTH,
  actionSchema,
  bidRequestSchema,
  bugReportRequestSchema,
  bugReportResponseSchema,
  cardSchema,
  clientMessageSchemas,
  gameOptionsSchema,
  handshakeSchema,
  jokerCallSchema,
  parseClientMessage,
  playRequestSchema,
  playerNameSchema,
  playerViewSchema,
  roomCodeSchema,
  serverMessageSchemas,
  type WireAction,
  type WireCard,
  type WireJokerCall,
  roomStateSchema,
  sessionSchema,
  TURN_TIMER_MAX_SEC,
  TURN_TIMER_MIN_SEC,
  turnTimerSchema,
  VOICE_SDP_MAX_LENGTH,
  voiceJoinResponseSchema,
  voiceSignalSchema,
} from '../src/index.js';

/** Грає гру випадковими легальними ходами й повертає всі проміжні стани. */
function randomGame(
  seed: number,
  playerCount: number,
  maxActions = Infinity,
  options?: GameOptions,
): GameState[] {
  const rng = createRng(seed);
  let state = createGame(seed, playerCount, options);
  const states = [state];
  while (state.turn !== null && states.length <= maxActions) {
    const actions = legalActions(state);
    state = apply(state, actions[rng.nextInt(actions.length)] as Action);
    states.push(state);
  }
  return states;
}

describe('версія протоколу', () => {
  it('є додатним цілим числом', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('рукостискання приймає лише поточну версію', () => {
    expect(handshakeSchema.safeParse({ protocolVersion: PROTOCOL_VERSION }).success).toBe(true);
    expect(handshakeSchema.safeParse({ protocolVersion: PROTOCOL_VERSION + 1 }).success).toBe(
      false,
    );
    expect(handshakeSchema.safeParse({}).success).toBe(false);
  });
});

describe('карти й оголошення', () => {
  it('R-1.1: приймає всі 38 карт колоди й відкидає неіснуючі', () => {
    for (const suit of ['spades', 'clubs', 'diamonds', 'hearts']) {
      for (let rank = 6; rank <= 14; rank++) {
        expect(cardSchema.safeParse({ kind: 'standard', suit, rank }).success).toBe(true);
      }
      expect(cardSchema.safeParse({ kind: 'standard', suit, rank: 5 }).success).toBe(false);
      expect(cardSchema.safeParse({ kind: 'standard', suit, rank: 15 }).success).toBe(false);
    }
    expect(cardSchema.safeParse({ kind: 'joker', index: 0 }).success).toBe(true);
    expect(cardSchema.safeParse({ kind: 'joker', index: 1 }).success).toBe(true);
    expect(cardSchema.safeParse({ kind: 'joker', index: 2 }).success).toBe(false);
    expect(cardSchema.safeParse({ kind: 'standard', suit: 'stars', rank: 6 }).success).toBe(false);
  });

  it('R-6.1–R-6.5: приймає всі види оголошення джокера', () => {
    for (const call of [
      { type: 'highTrump' },
      { type: 'high', suit: 'clubs' },
      { type: 'low', suit: 'hearts' },
      { type: 'take' },
      { type: 'discard' },
    ]) {
      expect(jokerCallSchema.safeParse(call).success).toBe(true);
    }
    expect(jokerCallSchema.safeParse({ type: 'high' }).success).toBe(false);
    expect(jokerCallSchema.safeParse({ type: 'steal' }).success).toBe(false);
  });
});

describe('повідомлення клієнта', () => {
  it('ім’я гравця обрізається й має бути непорожнім і коротким', () => {
    expect(playerNameSchema.parse('  Оля ')).toBe('Оля');
    expect(playerNameSchema.safeParse('   ').success).toBe(false);
    expect(playerNameSchema.safeParse('x'.repeat(100)).success).toBe(false);
  });

  it('код кімнати нормалізується до великих літер', () => {
    const code = 'abcde'.slice(0, ROOM_CODE_LENGTH);
    expect(roomCodeSchema.parse(code)).toBe(code.toUpperCase());
    expect(roomCodeSchema.safeParse('A').success).toBe(false);
    expect(roomCodeSchema.safeParse('AB-DE').success).toBe(false);
  });

  it('R-4.3: замовлення — невідʼємне ціле', () => {
    expect(bidRequestSchema.safeParse({ bid: 0 }).success).toBe(true);
    expect(bidRequestSchema.safeParse({ bid: 3 }).success).toBe(true);
    expect(bidRequestSchema.safeParse({ bid: -1 }).success).toBe(false);
    expect(bidRequestSchema.safeParse({ bid: 1.5 }).success).toBe(false);
  });

  it('хід картою не містить місця: його визначає сервер', () => {
    const parsed = playRequestSchema.parse({ card: { kind: 'standard', suit: 'spades', rank: 6 } });
    expect(parsed).toEqual({ card: { kind: 'standard', suit: 'spades', rank: 6 } });
    expect(
      playRequestSchema.safeParse({
        card: { kind: 'joker', index: 0 },
        call: { type: 'take' },
        seat: 2,
      }).success,
    ).toBe(false);
  });

  it('звіт про баг: опис гравця обрізається й обмежений за довжиною', () => {
    expect(parseClientMessage('game:reportBug', { description: '  карта зникла  ' })).toEqual({
      ok: true,
      data: { description: 'карта зникла' },
    });
    expect(bugReportRequestSchema.safeParse({ description: '   ' }).success).toBe(false);
    expect(
      bugReportRequestSchema.safeParse({ description: 'x'.repeat(BUG_DESCRIPTION_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(bugReportResponseSchema.parse({ url: 'https://github.com/o/r/issues/1' })).toEqual({
      url: 'https://github.com/o/r/issues/1',
    });
    expect(ERROR_CODES).toContain('rateLimited');
  });

  it('кожна подія клієнта має схему', () => {
    for (const event of CLIENT_EVENTS) {
      expect(clientMessageSchemas[event]).toBeDefined();
    }
  });

  it('parseClientMessage повертає дані або помилку badRequest', () => {
    expect(parseClientMessage('room:join', { code: 'abcde', name: 'Петро' })).toEqual({
      ok: true,
      data: { code: 'ABCDE', name: 'Петро' },
    });
    const bad = parseClientMessage('game:bid', { bid: 'багато' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('badRequest');
  });
});

describe('перепідключення й таймер ходу', () => {
  it('R-9.3: таймер ходу вимкнений (null) або в межах дозволених секунд', () => {
    expect(turnTimerSchema.parse(null)).toBeNull();
    expect(turnTimerSchema.parse(TURN_TIMER_MIN_SEC)).toBe(TURN_TIMER_MIN_SEC);
    expect(turnTimerSchema.parse(TURN_TIMER_MAX_SEC)).toBe(TURN_TIMER_MAX_SEC);
    expect(turnTimerSchema.safeParse(TURN_TIMER_MIN_SEC - 1).success).toBe(false);
    expect(turnTimerSchema.safeParse(TURN_TIMER_MAX_SEC + 1).success).toBe(false);
    expect(turnTimerSchema.safeParse(30.5).success).toBe(false);
    expect(parseClientMessage('room:settings', { turnTimerSec: 30 })).toEqual({
      ok: true,
      data: { turnTimerSec: 30 },
    });
    expect(parseClientMessage('room:settings', {}).ok).toBe(false);
  });

  it('R-9.3: хост віддає боту місце за номером', () => {
    expect(parseClientMessage('room:replaceWithBot', { seat: 2 })).toEqual({
      ok: true,
      data: { seat: 2 },
    });
    expect(parseClientMessage('room:replaceWithBot', { seat: -1 }).ok).toBe(false);
    expect(ERROR_CODES).toContain('playerConnected');
  });

  it('є код помилки для збою сховища: дію не вдалося зберегти', () => {
    expect(ERROR_CODES).toContain('unavailable');
  });

  it('R-9.3: стан кімнати містить налаштування таймера й дедлайн ходу', () => {
    const room = {
      code: 'ABCDE',
      link: '/r/ABCDE',
      status: 'playing',
      hostId: 'p1',
      you: 'p1',
      seats: [{ id: 'p1', name: 'Оля', kind: 'human', connected: false, away: false }],
      turnTimerSec: 30,
      turnDeadline: 1_700_000_000_000,
      options: { dark: false, zeroLimit: false },
    };
    expect(roomStateSchema.parse(room)).toEqual(room);
    expect(roomStateSchema.safeParse({ ...room, turnTimerSec: undefined }).success).toBe(false);
    expect(roomStateSchema.safeParse({ ...room, turnTimerSec: 1 }).success).toBe(false);
  });
});

describe('повідомлення сервера', () => {
  it('сесія й стан кімнати проходять валідацію', () => {
    const session = { code: 'ABCDE', token: 't'.repeat(32), playerId: 'p1', link: '/r/ABCDE' };
    expect(sessionSchema.parse(session)).toEqual(session);
    const room = {
      code: 'ABCDE',
      link: '/r/ABCDE',
      status: 'lobby',
      hostId: 'p1',
      you: 'p1',
      seats: [
        { id: 'p1', name: 'Оля', kind: 'human', connected: true, away: false },
        { id: 'b1', name: 'Бот 1', kind: 'bot', connected: true, away: false },
      ],
      turnTimerSec: null,
      turnDeadline: null,
      options: { dark: true, zeroLimit: false },
    };
    expect(roomStateSchema.parse(room)).toEqual(room);
    expect(roomStateSchema.safeParse({ ...room, status: 'paused' }).success).toBe(false);
  });

  it('погляд гравця з рушія будь-якої миті гри проходить схему без змін', () => {
    for (const playerCount of [3, 4, 5, 6]) {
      const states = randomGame(100 + playerCount, playerCount);
      for (const state of states.filter((_, i) => i % 7 === 0 || i === states.length - 1)) {
        for (let seat = 0; seat < playerCount; seat++) {
          const view = viewFor(state, seat);
          const wire = JSON.parse(JSON.stringify(view)) as unknown;
          expect(playerViewSchema.parse(wire)).toEqual(wire);
        }
      }
    }
  });

  it('дії з рушія проходять схему дії', () => {
    for (const state of randomGame(7, 4)) {
      for (const action of legalActions(state)) {
        expect(actionSchema.safeParse(action).success).toBe(true);
      }
    }
  });

  it('типи рушія сумісні з типами протоколу', () => {
    expectTypeOf<Card>().toExtend<WireCard>();
    expectTypeOf<WireCard>().toExtend<Card>();
    expectTypeOf<JokerCall>().toExtend<WireJokerCall>();
    expectTypeOf<Action>().toExtend<WireAction>();
  });

  it('схема погляду сувора: зайві поля (напр. чужі руки) відкидаються як помилка', () => {
    const view = JSON.parse(JSON.stringify(viewFor(createGame(1, 3), 0))) as Record<
      string,
      unknown
    >;
    expect(playerViewSchema.safeParse({ ...view, hands: [[], [], []] }).success).toBe(false);
  });
});

describe('опції кімнати (§10)', () => {
  it('R-10.1: хост задає обидві опції; інших полів немає', () => {
    const options = { dark: true, zeroLimit: false };
    expect(parseClientMessage('room:options', options)).toEqual({ ok: true, data: options });
    expect(parseClientMessage('room:options', { dark: true }).ok).toBe(false);
    expect(parseClientMessage('room:options', { ...options, extra: 1 }).ok).toBe(false);
    expect(gameOptionsSchema.safeParse({ dark: 'так', zeroLimit: false }).success).toBe(false);
  });

  it('R-10.1: стан кімнати показує всім, які опції ввімкнено', () => {
    expect(roomStateSchema.shape.options).toBe(gameOptionsSchema);
  });

  it('R-10.1–R-10.3: погляд гравця в грі з опціями проходить схему без змін', () => {
    const states = randomGame(5, 4, Infinity, { dark: true, zeroLimit: true });
    const dark = states.filter((state) => state.hand.spec.phase === 'dark');
    expect(dark.length).toBeGreaterThan(0);
    for (const state of [...states.filter((_, i) => i % 11 === 0), ...dark]) {
      for (let seat = 0; seat < 4; seat++) {
        const wire = JSON.parse(JSON.stringify(viewFor(state, seat))) as unknown;
        expect(playerViewSchema.parse(wire)).toEqual(wire);
      }
    }
  });

  it('R-10.2: у «Темній» до замовлення роздаючого погляд не містить карт гравця', () => {
    const states = randomGame(6, 3, Infinity, { dark: true, zeroLimit: false });
    const blind = states.filter((s) => s.hand.spec.phase === 'dark' && s.status === 'bidding');
    expect(blind).toHaveLength(3);
    for (const state of blind) {
      for (let seat = 0; seat < 3; seat++) {
        const wire = JSON.parse(JSON.stringify(viewFor(state, seat))) as Record<string, unknown>;
        expect(wire).toMatchObject({ blind: true, hand: [] });
        expect(playerViewSchema.parse(wire)).toEqual(wire);
        // Схема не пропускає руку в погляді наосліп: сервер не може її надіслати.
        const hand = state.hand.hands[seat];
        expect(playerViewSchema.safeParse({ ...wire, hand }).success).toBe(false);
      }
    }
  });
});

describe('перезапуск сервера (T55)', () => {
  it('сервер попереджає клієнтів про перезапуск подією server:restarting', () => {
    expect(serverMessageSchemas['server:restarting'].parse({})).toEqual({});
  });
});

describe('голосовий чат (T63)', () => {
  const offer = { type: 'offer', sdp: 'v=0\r\n' } as const;
  const candidate = {
    type: 'candidate',
    candidate: {
      candidate: 'candidate:1 1 udp 1 10.0.0.1 9 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    },
  } as const;

  it('сигнали WebRTC: offer, answer і ICE-кандидат; решта відкидається', () => {
    expect(voiceSignalSchema.parse(offer)).toEqual(offer);
    expect(voiceSignalSchema.parse({ type: 'answer', sdp: 'v=0' })).toEqual({
      type: 'answer',
      sdp: 'v=0',
    });
    expect(voiceSignalSchema.parse(candidate)).toEqual(candidate);
    expect(voiceSignalSchema.safeParse({ type: 'offer' }).success).toBe(false);
    expect(voiceSignalSchema.safeParse({ type: 'hack', sdp: 'x' }).success).toBe(false);
    expect(
      voiceSignalSchema.safeParse({ type: 'offer', sdp: 'x'.repeat(VOICE_SDP_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it('клієнт входить у голос, виходить і надсилає сигнал конкретному гравцеві', () => {
    expect(parseClientMessage('voice:join', {}).ok).toBe(true);
    expect(parseClientMessage('voice:leave', {}).ok).toBe(true);
    expect(parseClientMessage('voice:signal', { to: 'p1', signal: offer }).ok).toBe(true);
    expect(parseClientMessage('voice:signal', { signal: offer }).ok).toBe(false);
    expect(voiceJoinResponseSchema.parse({ peers: ['p1', 'p2'] })).toEqual({
      peers: ['p1', 'p2'],
    });
  });

  it('сервер повідомляє, хто увійшов у голос і вийшов, і пересилає сигнал від гравця', () => {
    expect(serverMessageSchemas['voice:joined'].parse({ playerId: 'p1' })).toEqual({
      playerId: 'p1',
    });
    expect(serverMessageSchemas['voice:left'].parse({ playerId: 'p1' })).toEqual({
      playerId: 'p1',
    });
    expect(serverMessageSchemas['voice:signal'].parse({ from: 'p1', signal: candidate })).toEqual({
      from: 'p1',
      signal: candidate,
    });
  });
});

describe('вихід із кімнати (T180)', () => {
  it('клієнт виходить із кімнати порожнім запитом room:leave', () => {
    expect(CLIENT_EVENTS).toContain('room:leave');
    expect(parseClientMessage('room:leave', {}).ok).toBe(true);
    expect(parseClientMessage('room:leave', { code: 'ABCDE' }).ok).toBe(false);
  });

  it('R-9.3: місце гравця, що вийшов посеред гри, позначене away: за нього ходить бот', () => {
    const seat = { id: 'p2', name: 'Петро', kind: 'human', connected: false, away: true };
    const room = {
      code: 'ABCDE',
      link: '/r/ABCDE',
      status: 'playing',
      hostId: 'p1',
      you: 'p1',
      seats: [{ id: 'p1', name: 'Оля', kind: 'human', connected: true, away: false }, seat],
      turnTimerSec: null,
      turnDeadline: null,
      options: { dark: false, zeroLimit: false },
    };
    expect(roomStateSchema.parse(room)).toEqual(room);
    const withoutAway = { id: 'p2', name: 'Петро', kind: 'human', connected: false };
    expect(roomStateSchema.safeParse({ ...room, seats: [withoutAway] }).success).toBe(false);
  });

  it('нова подія й нове поле — нова версія протоколу', () => {
    expect(PROTOCOL_VERSION).toBe(4);
  });
});
