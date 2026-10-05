import type { GameLog } from './game.js';

/** Версія формату логу дій; збільшується при несумісних змінах replay. */
export const ENGINE_LOG_VERSION = 2;

/** Лог дій без прив'язки до типів рушія: мігрується до розбору дій. */
export interface VersionedLog {
  readonly version: number;
}

/** Лог довільної версії: поля, крім `version`, міграція перетворює як завгодно. */
export type MigratableLog = VersionedLog & Readonly<Record<string, unknown>>;

/** Міграція логу з версії `v` (ключ) на `v + 1`. */
export type LogMigration = (log: MigratableLog) => MigratableLog;

/**
 * Міграції збережених логів. Коли зміна рушія ламає відтворення старих ігор
 * (фікстури `test/golden/compat/`), збільшуємо `ENGINE_LOG_VERSION` і додаємо сюди
 * перетворення з попередньої версії. Якщо гру перенести неможливо, міграції немає —
 * `migrateLog` кидає `UnsupportedLogVersionError`, і сервер пояснює це гравцям.
 */
export const LOG_MIGRATIONS: Readonly<Record<number, LogMigration>> = {
  // 1 → 2: гра, почата до рішення власника 02.10, догравається за правилами версії 1
  // (мізер і відіграш без козиря, R-3.1).
  1: (log) => ({ ...log, version: 2, rulesVersion: 1 }),
};

/** Лог, який поточний рушій не може відтворити: новішої версії або без шляху міграції. */
export class UnsupportedLogVersionError extends Error {
  override readonly name = 'UnsupportedLogVersionError';

  constructor(readonly version: number) {
    super(
      version > ENGINE_LOG_VERSION
        ? `Гру збережено новішою версією рушія (лог версії ${version}, підтримується до ${ENGINE_LOG_VERSION})`
        : `Гру збережено старою версією рушія (лог версії ${version}), її неможливо перенести на версію ${ENGINE_LOG_VERSION}`,
    );
  }
}

/** Переводить лог на `ENGINE_LOG_VERSION` крок за кроком; лог поточної версії повертає як є. */
export function migrateLog(
  log: VersionedLog,
  migrations: Readonly<Record<number, LogMigration>> = LOG_MIGRATIONS,
): GameLog {
  const original = log.version;
  if (!Number.isInteger(original) || original > ENGINE_LOG_VERSION) {
    throw new UnsupportedLogVersionError(original);
  }
  let current = log as MigratableLog;
  while (current.version < ENGINE_LOG_VERSION) {
    const migration = migrations[current.version];
    const next = migration?.(current);
    if (next === undefined || next.version !== current.version + 1) {
      throw new UnsupportedLogVersionError(original);
    }
    current = next;
  }
  // Міграції ведуть до формату поточної версії; його дії перевіряє вже `replay`.
  return current as unknown as GameLog;
}
