/** Версія формату логу дій; збільшується при несумісних змінах replay. */
export const ENGINE_LOG_VERSION = 1;

/** Лог дій без прив'язки до типів рушія: мігрується до розбору дій. */
export interface VersionedLog {
  readonly version: number;
}

/** Міграція логу з версії `v` (ключ) на `v + 1`. */
export type LogMigration = <T extends VersionedLog>(log: T) => T;

/**
 * Міграції збережених логів. Коли зміна рушія ламає відтворення старих ігор
 * (фікстури `test/golden/compat/`), збільшуємо `ENGINE_LOG_VERSION` і додаємо сюди
 * перетворення з попередньої версії. Якщо гру перенести неможливо, міграції немає —
 * `migrateLog` кидає `UnsupportedLogVersionError`, і сервер пояснює це гравцям.
 */
export const LOG_MIGRATIONS: Readonly<Record<number, LogMigration>> = {};

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
export function migrateLog<T extends VersionedLog>(
  log: T,
  migrations: Readonly<Record<number, LogMigration>> = LOG_MIGRATIONS,
): T {
  const original = log.version;
  if (!Number.isInteger(original) || original > ENGINE_LOG_VERSION) {
    throw new UnsupportedLogVersionError(original);
  }
  let current = log;
  while (current.version < ENGINE_LOG_VERSION) {
    const migration = migrations[current.version];
    const next = migration?.(current);
    if (next === undefined || next.version !== current.version + 1) {
      throw new UnsupportedLogVersionError(original);
    }
    current = next;
  }
  return current;
}
