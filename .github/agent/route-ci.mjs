// Реакція на завершений CI у PR: зелений → рецензія, червоний (PR агента) → фіксер.
import { OWNER, REPO, gh, ghJson, setOutput } from './lib.mjs';

const { CONCLUSION, HEAD_SHA, HEAD_BRANCH, RUN_ID } = process.env;
const prs = ghJson([
  'pr',
  'list',
  '--repo',
  REPO,
  '--head',
  HEAD_BRANCH,
  '--state',
  'open',
  '--json',
  'number,labels,author,headRefOid',
]);
const pr = prs[0];
const out = (action) => {
  setOutput('action', action);
  setOutput('pr', pr ? String(pr.number) : '');
  console.log(`action=${action} pr=${pr?.number ?? '-'}`);
  process.exit(0);
};

if (!pr) out('none');
if (pr.headRefOid !== HEAD_SHA) out('none'); // застарілий прогін, уже є новіший коміт
const isAgent = pr.labels.some((l) => l.name === 'agent');
if (!isAgent && pr.author?.login !== OWNER) out('none'); // чужі PR автопілот не обслуговує

if (CONCLUSION === 'success') out('review');
if (CONCLUSION === 'failure' && isAgent) {
  gh([
    'workflow',
    'run',
    'agent-fix.yml',
    '--repo',
    REPO,
    '-f',
    `pr=${pr.number}`,
    '-f',
    'reason=ci',
    '-f',
    `run_id=${RUN_ID}`,
  ]);
  out('fix');
}
out('none');
