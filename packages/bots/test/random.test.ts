import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, MIN_PLAYERS, createGame, gameLog, replay, viewFor } from '@poker/engine';
import { createRandomBot, playGame } from '../src/index.js';

const randomBots = (playerCount: number, seed: number) =>
  Array.from({ length: playerCount }, (_, seat) => createRandomBot(seed * 10 + seat));

describe('випадковий легальний бот', () => {
  it('R-4.3: у замовленнях обирає лише легальну дію з погляду гравця', () => {
    const state = createGame(7, 4);
    const view = viewFor(state, state.turn as number);
    const bot = createRandomBot(1);
    for (let i = 0; i < 20; i++) {
      expect(view.legalActions).toContainEqual(bot.act(view));
    }
  });

  it('детермінований: той самий seed дає ті самі дії', () => {
    const view = viewFor(createGame(3, 5), createGame(3, 5).turn as number);
    const a = createRandomBot(42);
    const b = createRandomBot(42);
    const first = Array.from({ length: 10 }, () => a.act(view));
    const second = Array.from({ length: 10 }, () => b.act(view));
    expect(first).toEqual(second);
  });

  it('кидає помилку, якщо зараз не його хід', () => {
    const state = createGame(1, 3);
    const other = ((state.turn as number) + 1) % 3;
    expect(() => createRandomBot(1).act(viewFor(state, other))).toThrow();
  });

  it.each(Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i))(
    'R-2.1: доводить до кінця повну гру на %i гравців, лог відтворюється (R-2.3)',
    (playerCount) => {
      const state = playGame(11, randomBots(playerCount, 11));
      expect(state.status).toBe('finished');
      expect(replay(11, gameLog(state))).toEqual(state);
    },
  );

  it('playGame детермінований для однакових seed гри й ботів', () => {
    expect(playGame(5, randomBots(4, 5)).actions).toEqual(playGame(5, randomBots(4, 5)).actions);
  });

  it('playGame вимагає бота на кожне місце', () => {
    expect(() => playGame(1, randomBots(2, 1))).toThrow(RangeError);
    expect(() => playGame(1, randomBots(7, 1))).toThrow(RangeError);
  });
});
