import { describe, expect, it } from 'vitest';
import { ENGINE_LOG_VERSION, UnsupportedLogVersionError, migrateLog } from '../src/index.js';

function errorOf(fn: () => unknown): UnsupportedLogVersionError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedLogVersionError);
    return error as UnsupportedLogVersionError;
  }
  return expect.unreachable();
}

describe('міграції логу', () => {
  it('R-2.3: помилка версії логу має власну назву', () => {
    const error = new UnsupportedLogVersionError(ENGINE_LOG_VERSION + 1);
    expect(error.name).toBe('UnsupportedLogVersionError');
    expect(error).toBeInstanceOf(Error);
  });

  it('R-2.3: лог новішої версії — повідомлення про новішу версію рушія', () => {
    const version = ENGINE_LOG_VERSION + 1;
    const error = errorOf(() => migrateLog({ version }));
    expect(error.version).toBe(version);
    expect(error.message).toBe(
      `Гру збережено новішою версією рушія (лог версії ${version}, підтримується до ${ENGINE_LOG_VERSION})`,
    );
  });

  it('R-2.3: старий лог без шляху міграції — повідомлення про стару версію рушія', () => {
    const version = ENGINE_LOG_VERSION - 1;
    const error = errorOf(() => migrateLog({ version }, {}));
    expect(error.version).toBe(version);
    expect(error.message).toBe(
      `Гру збережено старою версією рушія (лог версії ${version}), її неможливо перенести на версію ${ENGINE_LOG_VERSION}`,
    );
  });

  it('R-2.3: лог поточної версії не вважається новішим', () => {
    expect(new UnsupportedLogVersionError(ENGINE_LOG_VERSION).message).toContain('старою');
  });
});
