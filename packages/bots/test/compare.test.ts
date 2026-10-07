import { describe, expect, it } from 'vitest';
import {
  compareBots,
  createHeuristicBot,
  createRandomBot,
  formatComparison,
} from '../src/index.js';

describe('A/B-порівняння версій бота на тих самих роздачах (#211)', () => {
  it('R-7.1–R-7.4: однакові версії на тих самих seed дають нульову парну різницю', () => {
    const result = compareBots({
      games: 12,
      from: 1,
      candidate: createHeuristicBot,
      base: createHeuristicBot,
    });
    expect(result.games).toBe(12);
    expect(result.meanDiff).toBe(0);
    expect(result.standardError).toBe(0);
    expect(result.candidate).toEqual(result.base);
    expect(result.significant).toBe(false);
    expect(result.byPlayers.map((row) => row.players)).toEqual([3, 4, 5, 6]);
  });

  it('R-7.7: слабша версія значуще програє базовій за фінальним підсумком', () => {
    let seed = 0;
    const result = compareBots({
      games: 24,
      from: 1,
      candidate: () => createRandomBot(++seed),
      base: createHeuristicBot,
    });
    expect(result.meanDiff).toBeLessThan(0);
    expect(result.candidate.mean).toBeLessThan(result.base.mean);
    expect(result.candidate.exactRate).toBeLessThan(result.base.exactRate);
    expect(result.z).toBeLessThan(-2);
    expect(result.significant).toBe(true);
    expect(formatComparison(result, { candidate: 'random', base: 'heuristic' })).toContain(
      'кандидат значуще слабший',
    );
  });

  it('детерміноване, звіт містить середні бали й частку влучних замовлень обох версій', () => {
    const run = () =>
      compareBots({ games: 8, from: 5, candidate: createHeuristicBot, base: createHeuristicBot });
    expect(run()).toEqual(run());
    const result = run();
    const report = formatComparison(result, { candidate: 'робоче дерево', base: 'HEAD' });
    expect(report).toContain('робоче дерево');
    expect(report).toContain('HEAD');
    expect(report).toContain(`${(result.base.exactRate * 100).toFixed(1)}%`);
    expect(report).toContain('немає значущої різниці');
    expect(() =>
      compareBots({ games: 1, from: 1, candidate: createHeuristicBot, base: createHeuristicBot }),
    ).toThrow(RangeError);
  });
});
