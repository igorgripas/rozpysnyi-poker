// Публікує вердикт рецензента: commit status `agent-review`, коментар, запуск фіксера.
import { REPO, RUN_URL, addLabels, closesIssue, comment, gh, ghJson, readResult } from './lib.mjs';

const { PR, HEAD_SHA, RESULT_FILE } = process.env;
const { raw, report, error } = readResult(RESULT_FILE);
const pr = ghJson(['pr', 'view', PR, '--repo', REPO, '--json', 'labels,body']);
const isAgent = pr.labels.some((l) => l.name === 'agent');

function status(state, description) {
  gh([
    'api',
    `repos/${REPO}/statuses/${HEAD_SHA}`,
    '-f',
    `state=${state}`,
    '-f',
    'context=agent-review',
    '-f',
    `description=${description.slice(0, 139)}`,
    '-f',
    `target_url=${RUN_URL}`,
  ]);
}

if (!report) {
  status('error', 'Рецензент не повернув вердикт');
  addLabels(PR, ['needs-human']);
  comment(
    PR,
    `<!-- agent-review -->\n⚠️ Рецензент не повернув вердикт (${raw?.subtype ?? error}). Лог: ${RUN_URL}`,
  );
  process.exit(0);
}

const findings = (report.findings ?? [])
  .map((f) => `- **${f.severity}** \`${f.file}${f.line ? `:${f.line}` : ''}\` — ${f.problem}`)
  .join('\n');
const icon = { approve: '✅', changes: '🔧', needs_human: '🛑' }[report.verdict];
comment(
  PR,
  `<!-- agent-review -->\n## ${icon} Рецензія агента: ${report.verdict}\n\n${report.summary}\n\n${findings}\n\n_[лог](${RUN_URL})_`,
);

if (report.verdict === 'approve') {
  status('success', 'Рецензент схвалив');
} else if (report.verdict === 'changes') {
  status('failure', 'Рецензент просить змін');
  if (isAgent)
    gh([
      'workflow',
      'run',
      'agent-fix.yml',
      '--repo',
      REPO,
      '-f',
      `pr=${PR}`,
      '-f',
      'reason=review',
    ]);
} else {
  status('failure', 'Потрібне рішення людини');
  addLabels(PR, ['needs-human']);
  const issue = closesIssue(pr.body);
  if (issue) addLabels(issue, ['needs-human']);
}
