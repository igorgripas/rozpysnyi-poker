// Покриття правил тестами (AUTOPILOT §5 п.1): кожне `R-x.y` з docs/RULES.md має
// згадуватись щонайменше в одному тесті (назви тестів або golden-сценарії).
// Правила, які покриє пізніша задача, перелічені в rules-coverage.pending.json з назвою задачі.
// Скрипт падає, якщо правило не покрите, якщо тести посилаються на неіснуюче правило
// або якщо правило з pending уже покрите (запис треба прибрати).
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'coverage', 'reports', '.git']);
const ID = /R-\d+\.\d+/g;

/** Файли тестів: `*.test.*` і golden-сценарії. */
function isTestFile(path) {
  return /\.test\.[cm]?[jt]sx?$/.test(path) || /\/test\/golden\/.+\.json$/.test(path);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const rules = [
  ...new Set(
    [...readFileSync(join(root, 'docs/RULES.md'), 'utf8').matchAll(/\*\*(R-\d+\.\d+)\b/g)].map(
      (match) => match[1],
    ),
  ),
];
const pending = JSON.parse(readFileSync(join(root, 'scripts/rules-coverage.pending.json'), 'utf8'));

/** Правило → файли тестів, що на нього посилаються. */
const covered = new Map();
for (const path of walk(root)) {
  const file = relative(root, path);
  if (!isTestFile(`/${file}`)) continue;
  for (const [id] of readFileSync(path, 'utf8').matchAll(ID)) {
    covered.set(id, (covered.get(id) ?? new Set()).add(file));
  }
}

const errors = [];
for (const id of rules) {
  if (covered.has(id) && id in pending) {
    errors.push(`${id} уже покрите тестами — прибери його з rules-coverage.pending.json`);
  } else if (!covered.has(id) && !(id in pending)) {
    errors.push(`${id} не покрите жодним тестом`);
  }
}
for (const [id, files] of covered) {
  if (!rules.includes(id)) {
    errors.push(
      `${id} немає в docs/RULES.md, а тести на нього посилаються: ${[...files].join(', ')}`,
    );
  }
}
for (const id of Object.keys(pending)) {
  if (!rules.includes(id)) errors.push(`${id} з rules-coverage.pending.json немає в docs/RULES.md`);
}

const done = rules.filter((id) => covered.has(id)).length;
console.log(`Покриття правил: ${done}/${rules.length} покрито тестами.`);
for (const [id, task] of Object.entries(pending)) console.log(`  очікує: ${id} — ${task}`);
if (errors.length > 0) {
  console.error(errors.map((error) => `✗ ${error}`).join('\n'));
  process.exit(1);
}
