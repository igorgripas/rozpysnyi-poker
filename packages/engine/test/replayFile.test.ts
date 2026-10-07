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

describe('розбір replay-файлу', () => {
  const log = { version: 2, playerCount: 3, actions: [] };
  const file = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ format: 'rozpysnyi-poker/replay', seed: 7, log, ...overrides });

  it('R-2.3: формат replay-файлу — стала позначка rozpysnyi-poker/replay', () => {
    expect(REPLAY_FILE_FORMAT).toBe('rozpysnyi-poker/replay');
    expect(parseReplayFile(file())).toEqual({ format: REPLAY_FILE_FORMAT, seed: 7, log });
  });

  it('R-2.3: JSON іншого формату не вважається replay-файлом', () => {
    expect(() => parseReplayFile(file({ format: 'інше' }))).toThrow('Не знайдено replay-файл');
    expect(() => parseReplayFile(JSON.stringify({ seed: 7, log }))).toThrow(
      'Не знайдено replay-файл',
    );
    for (const text of ['null', '5', '"рядок"', '[]']) {
      expect(() => parseReplayFile(text)).toThrow('Не знайдено replay-файл');
    }
  });

  it('R-2.3: seed — невідʼємне ціле, нуль допустимий', () => {
    expect(parseReplayFile(file({ seed: 0 })).seed).toBe(0);
    for (const seed of [-1, 1.5, '7', null]) {
      expect(() => parseReplayFile(file({ seed }))).toThrow(
        'Replay-файл: seed має бути невідʼємним цілим',
      );
    }
  });

  it('R-2.3: log має містити version, playerCount і actions', () => {
    const message = 'Replay-файл: log має містити version, playerCount і actions';
    for (const bad of [
      null,
      [],
      'log',
      { playerCount: 3, actions: [] },
      { version: '2', playerCount: 3, actions: [] },
      { version: 2, actions: [] },
      { version: 2, playerCount: '3', actions: [] },
      { version: 2, playerCount: 3 },
      { version: 2, playerCount: 3, actions: {} },
    ]) {
      expect(() => parseReplayFile(file({ log: bad }))).toThrow(message);
    }
  });

  it('R-2.3: блок ```json знаходиться з пробілами після мітки й відступом перед закриттям', () => {
    const pretty = JSON.stringify(JSON.parse(file()), null, 2);
    const body = ['Опис', '```json  ', pretty, '  ```', 'кінець'].join('\n');
    expect(parseReplayFile(body).seed).toBe(7);
  });

  it('R-2.3: некоректний JSON у блоці пропускається, знаходиться попередній блок', () => {
    const body = ['```json', file(), '```', '', '```json', '{ зламано', '```'].join('\n');
    expect(parseReplayFile(body).seed).toBe(7);
  });

  it('R-2.3: якщо всі replay-блоки зіпсовані — помилка останнього з них', () => {
    const body = ['```json', file({ seed: -1 }), '```', '```json', file({ log: null }), '```'];
    expect(() => parseReplayFile(body.join('\n'))).toThrow(/log має містити/);
  });
});
