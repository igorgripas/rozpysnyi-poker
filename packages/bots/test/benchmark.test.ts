import { describe, expect, it } from 'vitest';
import { formatBenchmark, formatSelfPlay, runBenchmark, runSelfPlay } from '../src/index.js';

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

  it('R-7.5: у мізері евристичний бот набирає більше за випадкового', () => {
    expect(result.heuristicMisere).toBeGreaterThan(result.randomMisere);
    expect(formatBenchmark(result)).toContain(
      `мізер: евристичний **${result.heuristicMisere.toFixed(1)}**`,
    );
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

describe('самогра евристичних ботів: точність замовлень (#108)', () => {
  const result = runSelfPlay({ games: 40, from: 1 });

  it('R-7.1–R-7.5: рахує замовлення й мізери всіх гравців у всіх роздачах', () => {
    expect(result.games).toBe(40);
    expect(result.bids).toBeGreaterThan(0);
    expect(result.miseres).toBe(10 * (3 + 4 + 5 + 6));
    expect(result.exactRate + result.overRate + result.underRate).toBeCloseTo(1, 10);
  });

  it('R-5.2, R-5.4: з памʼяттю зіграних карт бот влучає в замовлення частіше, ніж без неї', () => {
    // Без памʼяті на цих seed: 55,7 % точних замовлень і 5,3 бала за роздачу.
    expect(result.exactRate).toBeGreaterThan(0.57);
    expect(result.bidPoints).toBeGreaterThan(5.6);
  });

  it('R-7.3: з планом розіграшу бот скидає зайві старші карти й влучає ще частіше (#209)', () => {
    // Без плану на цих seed: 58,0 % точних замовлень, 13,3 % недоборів і 6,0 бала за роздачу.
    expect(result.exactRate).toBeGreaterThan(0.6);
    expect(result.underRate).toBeLessThan(0.12);
    expect(result.bidPoints).toBeGreaterThan(6.6);
  });

  it('детермінована й дає звіт у markdown', () => {
    expect(runSelfPlay({ games: 4, from: 3 })).toEqual(runSelfPlay({ games: 4, from: 3 }));
    expect(formatSelfPlay(result)).toContain(`${(result.exactRate * 100).toFixed(1)}%`);
    expect(() => runSelfPlay({ games: 0, from: 1 })).toThrow(RangeError);
  });
});
