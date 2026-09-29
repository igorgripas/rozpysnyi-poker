// Перед фіксом: ліміт спроб, збір контексту (лог CI або зауваження рецензента).
import { writeFileSync } from 'node:fs';
import {
  REPO,
  addLabels,
  closesIssues,
  comment,
  gh,
  ghJson,
  removeLabels,
  setOutput,
} from './lib.mjs';

const MAX_ATTEMPTS = 3;
const { PR, REASON, RUN_ID, CONTEXT_FILE, AGENT_GH_TOKEN } = process.env;
const pr = ghJson([
  'pr',
  'view',
  PR,
  '--repo',
  REPO,
  '--json',
  'labels,body,headRefName,comments,state',
]);
const labels = pr.labels.map((l) => l.name);
const attempts = Math.max(
  0,
  ...labels.map((l) => Number(l.match(/^agent:attempt-(\d+)$/)?.[1] ?? 0)),
);

if (pr.state !== 'OPEN' || labels.includes('needs-human')) {
  setOutput('skip', 'true');
  process.exit(0);
}
if (attempts >= MAX_ATTEMPTS) {
  gh(['pr', 'merge', PR, '--repo', REPO, '--disable-auto'], { token: AGENT_GH_TOKEN });
  addLabels(PR, ['needs-human']);
  for (const issue of closesIssues(pr.body)) addLabels(issue, ['needs-human']);
  comment(
    PR,
    `🛑 ${MAX_ATTEMPTS} спроби виправлення не допомогли. Auto-merge вимкнено, потрібна людина.`,
  );
  setOutput('skip', 'true');
  process.exit(0);
}
removeLabels(PR, attempts ? [`agent:attempt-${attempts}`] : []);
addLabels(PR, [`agent:attempt-${attempts + 1}`]);

let context;
if (REASON === 'ci') {
  const log = gh(['run', 'view', RUN_ID, '--repo', REPO, '--log-failed']);
  context = log.split('\n').slice(-400).join('\n');
} else {
  const review = [...pr.comments].reverse().find((c) => c.body.includes('<!-- agent-review -->'));
  context = review?.body ?? '(зауваження рецензента не знайдено)';
}
writeFileSync(CONTEXT_FILE, context);
setOutput('skip', 'false');
setOutput('branch', pr.headRefName);
