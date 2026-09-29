// Збирає промпт для агента: шаблон з prompts/<kind>.md + дані задачі.
// Використання: node render-prompt.mjs <implement|review|fix>   (дані — через env)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER, REPO, closesIssue, ghJson } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const kind = process.argv[2];
const env = process.env;

/** Текст issue: заголовок, опис і коментарі лише від власника (решта — потенційно недовірені). */
function issueText(number) {
  if (!number) return '(задачу не знайдено)';
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
  return `#${i.number} ${i.title}\n\n${i.body}${comments ? `\n\n${comments}` : ''}`;
}

const vars = {};
if (kind === 'implement') {
  vars.ISSUE_NUMBER = env.ISSUE;
  vars.ISSUE = issueText(env.ISSUE);
} else {
  const pr = ghJson(['pr', 'view', env.PR, '--repo', REPO, '--json', 'number,title,body']);
  vars.PR_NUMBER = String(pr.number);
  vars.PR_TITLE = pr.title;
  vars.ISSUE = issueText(closesIssue(pr.body));
  if (kind === 'fix') {
    vars.REASON = env.REASON === 'ci' ? 'CI впав' : 'рецензент попросив змін';
    vars.CONTEXT = readFileSync(env.CONTEXT_FILE, 'utf8');
  }
}

const template = readFileSync(join(here, 'prompts', `${kind}.md`), 'utf8');
process.stdout.write(template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''));
