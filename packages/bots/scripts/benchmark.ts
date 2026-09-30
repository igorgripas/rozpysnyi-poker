/**
 * Бенчмарк ботів (T22): евристичний бот проти випадкових на N = 3…6.
 * Звіт друкується в консоль і дописується у звіт CI (`GITHUB_STEP_SUMMARY`), якщо він є.
 * Падає, якщо перевага евристичного бота не значуща.
 *
 * Запуск: `pnpm benchmark [--games 10000] [--from 1]`.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { formatBenchmark, runBenchmark } from '../src/index.js';

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '10000' },
    from: { type: 'string', default: '1' },
  },
});

const started = performance.now();
const result = runBenchmark({ games: Number(values.games), from: Number(values.from) });
const seconds = ((performance.now() - started) / 1000).toFixed(1);
const report = `${formatBenchmark(result)}\nЧас: ${seconds} с.\n`;

console.log(report);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, `${report}\n`);
if (!result.significant) process.exit(1);
