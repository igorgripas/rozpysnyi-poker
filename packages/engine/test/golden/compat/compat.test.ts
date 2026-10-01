/**
 * Сумісність збережених ігор (T56): кожна фікстура — seed і лог незавершеної гри у форматі,
 * у якому його зберігає сервер. Поточний рушій має відтворити лог (через міграцію, якщо
 * версія стара) і прийти до того самого стану. Захищені файли — змінюються лише через PR
 * з міткою `spec-change`.
 *
 * Нова фікстура: `pnpm --filter @poker/engine compat:fixture --seed S --players N --actions A`.
 * Якщо зміна рушія ламає фікстуру, старі збережені ігри теж не відтворяться: треба збільшити
 * `ENGINE_LOG_VERSION`, додати міграцію в `LOG_MIGRATIONS` і фікстуру нової версії.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_LOG_VERSION, migrateLog, replay } from '../../../src/index.js';
import { type CompatFixture, compatSnapshot } from '../../support/compat.js';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .sort();
const fixtures = files.map(
  (file) => [file, JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as CompatFixture] as const,
);

describe('сумісність збережених ігор', () => {
  it(`R-2.3: є фікстура поточної версії логу ${ENGINE_LOG_VERSION} для кожної кількості гравців`, () => {
    const current = fixtures.filter(([, fixture]) => fixture.log.version === ENGINE_LOG_VERSION);
    const counts = new Set(current.map(([, fixture]) => fixture.log.playerCount));
    expect([...counts].sort()).toEqual([3, 4, 5, 6]);
  });

  for (const [file, fixture] of fixtures) {
    describe(file, () => {
      it(`R-2.3: ${fixture.title} (${fixture.rules.join(', ')})`, () => {
        expect(fixture.log.version).toBeLessThanOrEqual(ENGINE_LOG_VERSION);
        const state = replay(fixture.seed, fixture.log);
        expect(state.status).not.toBe('finished');
        expect(compatSnapshot(state)).toEqual(fixture.expect);
      });

      it('R-2.3: відтворена гра зберігається в поточній версії й відтворюється знову', () => {
        const state = replay(fixture.seed, fixture.log);
        const log = migrateLog(fixture.log);
        expect(log.version).toBe(ENGINE_LOG_VERSION);
        expect(replay(fixture.seed, JSON.parse(JSON.stringify(log)))).toEqual(state);
      });
    });
  }
});
