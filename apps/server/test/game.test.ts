import { type Action, type Card, type GameState, gameLog, replay } from '@poker/engine';
import { playerViewSchema } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from '../src/rooms.js';
import { errorCode, testRandom, unwrap } from './support.js';

const DELAY = 500;
const PAUSE = 2000;

function manager(seed = 1) {
  return new RoomManager({ random: testRandom(seed), botDelayMs: DELAY });
}

/** Кімната з людьми `names` і `bots` ботами; гру запущено. */
function startedRoom(humans: number, bots: number, seed = 1) {
  const rooms = manager(seed);
  const host = unwrap(rooms.create('Гравець 0'));
  const players = [host];
  for (let i = 1; i < humans; i++) players.push(unwrap(rooms.join(host.code, `Гравець ${i}`)));
  for (let i = 0; i < bots; i++) unwrap(rooms.addBot(host.code, host.playerId));
  unwrap(rooms.start(host.code, host.playerId));
  return { rooms, code: host.code, players };
}

/** Надсилає дію рушія від імені гравця, як це робив би клієнт. */
function send(rooms: RoomManager, code: string, playerId: string, action: Action) {
  if (action.type === 'bid') return rooms.bid(code, playerId, action.bid);
  return rooms.play(code, playerId, action.card, action.call);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('авторитетний сервер', () => {
  it('до старту гри дії відхиляються як notStarted', () => {
    const rooms = manager();
    const host = unwrap(rooms.create('Оля'));
    expect(errorCode(rooms.bid(host.code, host.playerId, 0))).toBe('notStarted');
    expect(rooms.view(host.code, host.playerId)).toBeNull();
  });

  it('кожен гравець отримує viewFor свого місця: лише власна рука', () => {
    const { rooms, code, players } = startedRoom(3, 0);
    const game = rooms.get(code)?.game;
    players.forEach((player, seat) => {
      const view = rooms.view(code, player.playerId);
      expect(view?.seat).toBe(seat);
      expect(view?.hand).toEqual(game?.hand.hands[seat]);
      expect(playerViewSchema.parse(JSON.parse(JSON.stringify(view)))).toBeTruthy();
    });
  });

  it('хід не в свою чергу відхиляється як illegalAction, стан не змінюється', () => {
    const { rooms, code, players } = startedRoom(3, 0);
    const game = rooms.get(code)?.game;
    const idle = players.find((_, seat) => seat !== game?.turn);
    expect(errorCode(rooms.bid(code, idle?.playerId as string, 0))).toBe('illegalAction');
    expect(rooms.get(code)?.game).toBe(game);
  });

  it('R-4.4: роздаючому не дають замовити заборонене значення', () => {
    const { rooms, code, players } = startedRoom(3, 0);
    for (;;) {
      const game = rooms.get(code)?.game;
      const player = players[game?.turn as number];
      const view = rooms.view(code, player?.playerId as string);
      if (view?.status === 'bidding' && view.seat === view.dealer && view.forbiddenBid !== null) {
        const bid = rooms.bid(code, player?.playerId as string, view.forbiddenBid);
        expect(errorCode(bid)).toBe('illegalAction');
        return;
      }
      unwrap(send(rooms, code, player?.playerId as string, view?.legalActions[0] as Action));
    }
  });

  it('R-5.2: карта, якої немає в руці, відхиляється', () => {
    const { rooms, code, players } = startedRoom(3, 0);
    for (let i = 0; i < 3; i++) {
      const turn = rooms.get(code)?.game?.turn as number;
      const view = rooms.view(code, players[turn]?.playerId as string);
      unwrap(send(rooms, code, players[turn]?.playerId as string, view?.legalActions[0] as Action));
    }
    const turn = rooms.get(code)?.game?.turn as number;
    const hand = rooms.get(code)?.game?.hand.hands[(turn + 1) % 3] as readonly Card[];
    expect(errorCode(rooms.play(code, players[turn]?.playerId as string, hand[0] as Card))).toBe(
      'illegalAction',
    );
  });
});

describe('боти', () => {
  it('бот ходить лише після затримки', () => {
    const { rooms, code, players } = startedRoom(1, 2, 5);
    const human = players[0]?.playerId as string;
    const actions = () => rooms.get(code)?.game?.actions.length as number;
    // Після ходу людини (або одразу) черга бота: у кімнаті на 3 місця вона сидить поміж ботами.
    const view = rooms.view(code, human);
    if (view?.legalActions.length) unwrap(send(rooms, code, human, view.legalActions[0] as Action));
    const game = rooms.get(code)?.game;
    expect(rooms.get(code)?.seats[game?.turn as number]?.kind).toBe('bot');
    const before = actions();
    vi.advanceTimersByTime(DELAY - 1);
    expect(actions()).toBe(before);
    vi.advanceTimersByTime(1);
    expect(actions()).toBe(before + 1);
  });

  it('гра людини з двома ботами доходить до кінця; лог відтворює стан', () => {
    const { rooms, code, players } = startedRoom(1, 2, 7);
    const human = players[0]?.playerId as string;
    const changes: string[] = [];
    rooms.subscribe((c) => changes.push(c));
    let steps = 0;
    while (rooms.get(code)?.status !== 'finished') {
      const view = rooms.view(code, human);
      if (view?.legalActions.length)
        unwrap(send(rooms, code, human, view.legalActions[0] as Action));
      else vi.advanceTimersByTime(DELAY);
      expect(++steps).toBeLessThan(5000);
    }
    const game = rooms.get(code)?.game;
    expect(game?.status).toBe('finished');
    expect(replay(game?.seed as number, gameLog(game as GameState))).toEqual(game);
    expect(changes.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('після завершення взятки бот ходить не раніше ніж через паузу взятки', () => {
    const rooms = new RoomManager({
      random: testRandom(3),
      botDelayMs: DELAY,
      trickPauseMs: PAUSE,
    });
    const host = unwrap(rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.start(host.code, host.playerId));
    const code = host.code;
    const game = () => rooms.get(code)?.game as GameState;
    let checked = 0;
    let steps = 0;
    while (game().status !== 'finished' && checked < 5) {
      expect(++steps).toBeLessThan(5000);
      const before = game();
      const view = rooms.view(code, host.playerId);
      if (view?.legalActions.length) {
        unwrap(send(rooms, code, host.playerId, view.legalActions[0] as Action));
      } else {
        vi.advanceTimersByTime(DELAY);
        if (game() === before) vi.advanceTimersByTime(PAUSE);
      }
      const after = game();
      // Щойно завершилася взятка, а далі черга бота.
      const completed = after.lastTrick !== before.lastTrick && after.lastTrick !== null;
      const next = after.turn;
      if (!completed || next === null || rooms.get(code)?.seats[next]?.kind !== 'bot') continue;
      const count = after.actions.length;
      vi.advanceTimersByTime(PAUSE - 1);
      expect(game().actions.length).toBe(count);
      vi.advanceTimersByTime(1);
      expect(game().actions.length).toBe(count + 1);
      checked++;
    }
    expect(checked).toBe(5);
    rooms.close();
  });

  it('усередині взятки бот ходить зі звичайною затримкою', () => {
    const rooms = new RoomManager({
      random: testRandom(3),
      botDelayMs: DELAY,
      trickPauseMs: PAUSE,
    });
    const host = unwrap(rooms.create('Оля'));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.addBot(host.code, host.playerId));
    unwrap(rooms.start(host.code, host.playerId));
    const code = host.code;
    const game = () => rooms.get(code)?.game as GameState;
    let steps = 0;
    // Чекаємо ходу бота посеред взятки.
    while (!(game().status === 'playing' && game().hand.trick.length > 0 && game().turn !== 0)) {
      expect(++steps).toBeLessThan(5000);
      const view = rooms.view(code, host.playerId);
      if (view?.legalActions.length) {
        unwrap(send(rooms, code, host.playerId, view.legalActions[0] as Action));
      } else vi.advanceTimersByTime(1);
    }
    const count = game().actions.length;
    vi.advanceTimersByTime(DELAY);
    expect(game().actions.length).toBe(count + 1);
    rooms.close();
  });

  it('close() скасовує заплановані ходи ботів', () => {
    const { rooms, code } = startedRoom(1, 2, 9);
    vi.advanceTimersByTime(DELAY * 3);
    rooms.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(rooms.get(code)).toBeDefined();
  });
});
