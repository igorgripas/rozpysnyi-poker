import { describe, expect, it } from 'vitest';
import {
  REPLAY_FILE_FORMAT,
  apply,
  createGame,
  legalActions,
  parseReplayFile,
  replay,
  toReplayFile,
} from '../src/index.js';
import type { Action } from '../src/index.js';
import { playRandomGame } from './support/invariants.js';

/** Гра посеред роздачі: кілька перших легальних дій. */
function midGame() {
  let state = createGame(42, 4);
  for (let i = 0; i < 12; i++) state = apply(state, legalActions(state)[0] as Action);
  return state;
}

describe('replay-файл (AUTOPILOT §6)', () => {
  it('R-2.3: replay-файл гри відтворює той самий стан', () => {
    const state = midGame();
    const file = parseReplayFile(JSON.stringify(toReplayFile(state)));
    expect(file.format).toBe(REPLAY_FILE_FORMAT);
    expect(replay(file.seed, file.log)).toEqual(state);
  });

  it('R-2.3: replay-файл знаходиться в тексті issue (блок ```json)', () => {
    const state = playRandomGame(5, 3);
    const body = [
      'Звіт гравця',
      '```text',
      'щось не так',
      '```',
      '<details><summary>Replay</summary>',
      '',
      '```json',
      JSON.stringify(toReplayFile(state)),
      '```',
      '</details>',
    ].join('\n');
    const file = parseReplayFile(body);
    expect(replay(file.seed, file.log)).toEqual(state);
  });

  it('некоректний replay-файл — зрозуміла помилка', () => {
    expect(() => parseReplayFile('не json')).toThrow(/replay/i);
    expect(() => parseReplayFile('{"format":"інше","seed":1}')).toThrow(/replay/i);
    expect(() =>
      parseReplayFile(JSON.stringify({ format: REPLAY_FILE_FORMAT, seed: 1.5, log: {} })),
    ).toThrow(/seed/);
    expect(() =>
      parseReplayFile(
        JSON.stringify({
          format: REPLAY_FILE_FORMAT,
          seed: 1,
          log: { version: 1, playerCount: 4 },
        }),
      ),
    ).toThrow(/log/);
  });
});

describe('replay-файл у тексті issue', () => {
  it('R-2.3: перевага за останнім блоком — опис гравця не підмінить replay', () => {
    const state = midGame();
    const fake = JSON.stringify(toReplayFile(createGame(1, 3)));
    const body = [
      '```json',
      fake,
      '```',
      '',
      '```json',
      JSON.stringify(toReplayFile(state)),
      '```',
    ];
    const file = parseReplayFile(body.join('\n'));
    expect(replay(file.seed, file.log)).toEqual(state);
  });
});
