/**
 * Бенчмарк ботів (T22): евристичний бот проти випадкових на N = 3…6.
 * Звіт друкується в консоль і дописується у звіт CI (`GITHUB_STEP_SUMMARY`), якщо він є.
 * Падає, якщо перевага евристичного бота не значуща. Окремо — самогра лише евристичних ботів:
 * точність замовлень для калібрування оцінки руки.
 *
 * Запуск: `pnpm benchmark [--games 10000] [--from 1] [--self-play 1000]`.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { formatBenchmark, formatSelfPlay, runBenchmark, runSelfPlay } from '../src/index.js';

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '10000' },
    from: { type: 'string', default: '1' },
    'self-play': { type: 'string', default: '1000' },
  },
});

const started = performance.now();
const from = Number(values.from);
const result = runBenchmark({ games: Number(values.games), from });
const selfPlay = runSelfPlay({ games: Number(values['self-play']), from });
const seconds = ((performance.now() - started) / 1000).toFixed(1);
const report = `${formatBenchmark(result)}\n${formatSelfPlay(selfPlay)}\nЧас: ${seconds} с.\n`;

console.log(report);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, `${report}\n`);
if (!result.significant) process.exit(1);
