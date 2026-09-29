// Збирає промпт для агента: шаблон з prompts/<kind>.md + дані задачі.
// Використання: node render-prompt.mjs <implement|review|fix>   (дані — через env)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER, REPO, closesIssues, ghJson } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const kind = process.argv[2];
const env = process.env;

/** Текст issue: заголовок, опис і коментарі лише від власника (решта — потенційно недовірені). */
function issueText(number) {
  const i = ghJson([
    'issue',
    'view',
    String(number),
    '--repo',
    REPO,
    '--json',
    'number,title,body,comments',
  ]);
  const comments = i.comments
    .filter((c) => c.author?.login === OWNER)
    .map((c) => `Коментар власника:\n${c.body}`)
    .join('\n\n');
  return `<issue number="${i.number}">\n#${i.number} ${i.title}\n\n${i.body}${comments ? `\n\n${comments}` : ''}\n</issue>`;
}

const issuesText = (numbers) =>
  numbers.length ? numbers.map(issueText).join('\n\n') : "(пов'язаних задач не знайдено)";

const vars = {};
if (kind === 'implement') {
  const numbers = (env.ISSUES || env.ISSUE).split(/\s+/).filter(Boolean).map(Number);
  vars.ISSUE_LIST = numbers.map((n) => `#${n}`).join(', ');
  vars.ISSUES = issuesText(numbers);
} else {
  const pr = ghJson(['pr', 'view', env.PR, '--repo', REPO, '--json', 'number,title,body']);
  vars.PR_NUMBER = String(pr.number);
  vars.PR_TITLE = pr.title;
  vars.ISSUES = issuesText(closesIssues(pr.body));
  if (kind === 'fix') {
    vars.REASON = env.REASON === 'ci' ? 'CI впав' : 'рецензент попросив змін';
    vars.CONTEXT = readFileSync(env.CONTEXT_FILE, 'utf8');
  }
}

const template = readFileSync(join(here, 'prompts', `${kind}.md`), 'utf8');
process.stdout.write(template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''));
