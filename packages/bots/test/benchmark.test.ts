import { describe, expect, it } from 'vitest';
import { formatBenchmark, runBenchmark } from '../src/index.js';

describe('бенчмарк ботів', () => {
  const result = runBenchmark({ games: 48, from: 1 });

  it('грає задану кількість ігор на 3–6 гравців (R-1.2), по одному евристичному боту', () => {
    expect(result.games).toBe(48);
    expect(result.byPlayers.map((row) => row.players)).toEqual([3, 4, 5, 6]);
    expect(result.byPlayers.reduce((sum, row) => sum + row.games, 0)).toBe(48);
  });

  it('евристичний бот значуще переграє випадкового за фінальним підсумком', () => {
    expect(result.meanDiff).toBeGreaterThan(0);
    expect(result.z).toBeGreaterThan(3);
    expect(result.significant).toBe(true);
  });

  it('евристичний бот перемагає частіше, ніж випадковий гравець на його місці', () => {
    expect(result.winRate).toBeGreaterThan(result.baselineWinRate);
  });

  it('детермінований: ті самі seed дають ті самі результати', () => {
    expect(runBenchmark({ games: 8, from: 5 })).toEqual(runBenchmark({ games: 8, from: 5 }));
  });

  it('звіт у markdown містить метрики', () => {
    const report = formatBenchmark(result);
    expect(report).toContain('48');
    expect(report).toContain(result.z.toFixed(1));
    expect(report).toMatch(/\| N \|/);
  });
});
