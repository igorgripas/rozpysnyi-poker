import { type GameLog, type GameState, gameLog } from './game.js';

/** Позначка формату replay-файлу: за нею файл знаходиться в тексті issue. */
export const REPLAY_FILE_FORMAT = 'rozpysnyi-poker/replay';

/**
 * Replay-файл гри (AUTOPILOT §6): seed і лог дій. Відтворюється через
 * `replay(file.seed, file.log)` або `pnpm replay <file>`.
 */
export interface ReplayFile {
  readonly format: typeof REPLAY_FILE_FORMAT;
  readonly seed: number;
  readonly log: GameLog;
}

export function toReplayFile(state: GameState): ReplayFile {
  return { format: REPLAY_FILE_FORMAT, seed: state.seed, log: gameLog(state) };
}

/** Блоки ```json у markdown (тексті issue). */
const JSON_BLOCK = /```json\s*\n([\s\S]*?)\n\s*```/g;

/**
 * Розбирає replay-файл: сам JSON або markdown (текст issue), де він лежить у блоці ```json.
 * У markdown перевага за останнім блоком (сервер додає replay в кінці issue, після опису гравця).
 * Дії не перевіряє — це робить `replay`.
 */
export function parseReplayFile(text: string): ReplayFile {
  const blocks = Array.from(text.matchAll(JSON_BLOCK), (match) => match[1] ?? '');
  let invalid: Error | null = null;
  for (const candidate of [text, ...blocks.reverse()]) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isRecord(value) || value.format !== REPLAY_FILE_FORMAT) continue;
    try {
      return validate(value);
    } catch (error) {
      invalid ??= error as Error;
    }
  }
  throw invalid ?? new Error(`Не знайдено replay-файл (JSON з "format": "${REPLAY_FILE_FORMAT}")`);
}

function validate(value: Record<string, unknown>): ReplayFile {
  const { seed, log } = value;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0) {
    throw new Error('Replay-файл: seed має бути невідʼємним цілим');
  }
  if (
    !isRecord(log) ||
    typeof log.version !== 'number' ||
    typeof log.playerCount !== 'number' ||
    !Array.isArray(log.actions)
  ) {
    throw new Error('Replay-файл: log має містити version, playerCount і actions');
  }
  return { format: REPLAY_FILE_FORMAT, seed, log: log as unknown as GameLog };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
