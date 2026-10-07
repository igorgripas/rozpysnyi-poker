/**
 * A/B-порівняння евристичного бота (#211): поточна версія з робочого дерева проти базової
 * з git-ref на тих самих seed. Базову версію береться з тимчасового `git worktree` — замороженої
 * копії коду в репо немає. Рушій для обох версій спільний (поточний), тож різниця лише в боті.
 * Звіт друкується в консоль і дописується у звіт CI (`GITHUB_STEP_SUMMARY`), якщо він є.
 *
 * Запуск: `pnpm compare [--base HEAD] [--games 2000] [--from 1]`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { type Bot, compareBots, createHeuristicBot, formatComparison } from '../src/index.js';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'HEAD' },
    games: { type: 'string', default: '2000' },
    from: { type: 'string', default: '1' },
  },
});

const botsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: botsDir, encoding: 'utf8' }).trim();

const base = values.base;
const commit = git('rev-parse', '--verify', `${base}^{commit}`);
const root = git('rev-parse', '--show-toplevel');
const tmp = mkdtempSync(join(tmpdir(), 'poker-bots-base-'));
const worktree = join(tmp, 'tree');
git('worktree', 'add', '--detach', '--quiet', worktree, commit);
try {
  // Базовий бот імпортує `@poker/engine` — підставляємо поточні залежності пакета ботів.
  symlinkSync(
    join(root, 'packages/bots/node_modules'),
    join(worktree, 'packages/bots/node_modules'),
  );
  const module = (await import(
    pathToFileURL(join(worktree, 'packages/bots/src/heuristic.ts')).href
  )) as { createHeuristicBot: () => Bot };

  const started = performance.now();
  const result = compareBots({
    games: Number(values.games),
    from: Number(values.from),
    candidate: createHeuristicBot,
    base: module.createHeuristicBot,
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const labels = { candidate: 'робоче дерево', base: `${base} (${commit.slice(0, 7)})` };
  const report = `${formatComparison(result, labels)}\nЧас: ${seconds} с.\n`;
  console.log(report);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${report}\n`);
} finally {
  git('worktree', 'remove', '--force', worktree);
  rmSync(tmp, { recursive: true, force: true });
}
