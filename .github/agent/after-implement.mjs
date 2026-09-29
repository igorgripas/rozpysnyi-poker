// Після роботи агента: пуш гілки, PR з auto-merge, або передача задачі людині.
import { writeFileSync } from 'node:fs';
import {
  REPO,
  RUN_URL,
  addLabels,
  comment,
  failureReason,
  redact,
  gh,
  ghJson,
  pushFromWorkspace,
  readResult,
  removeLabels,
  run,
} from './lib.mjs';

const { ISSUE, BRANCH, RESULT_FILE, AGENT_GH_TOKEN, GITHUB_WORKSPACE } = process.env;
const issue = Number(ISSUE);
const { raw, report, error } = readResult(RESULT_FILE);
const ahead = Number(
  run('git', ['-C', GITHUB_WORKSPACE, 'rev-list', '--count', 'origin/main..HEAD']).trim(),
);

function handOver(reason) {
  removeLabels(issue, ['agent:in-progress']);
  addLabels(issue, ['needs-human']);
  comment(
    issue,
    `🛑 Автопілот зупинився: ${reason}\n\n${report?.summary ?? ''}\n\nЛог: ${RUN_URL}`,
  );
  console.log(`needs-human: ${reason}`);
}

if (!report) {
  handOver(`агент не повернув звіт (${failureReason(raw, error)}).`);
  process.exit(0);
}
if (report.status !== 'done') {
  handOver(report.blocked_reason || 'агент позначив задачу як заблоковану.');
  process.exit(0);
}
if (ahead === 0) {
  handOver('агент завершив роботу, але не створив жодного коміту.');
  process.exit(0);
}

let url;
try {
  pushFromWorkspace({
    workspace: GITHUB_WORKSPACE,
    branch: BRANCH,
    token: AGENT_GH_TOKEN,
    force: true,
  });

  const { title } = ghJson(['issue', 'view', String(issue), '--repo', REPO, '--json', 'title']);
  const body = [
    `Closes #${issue}`,
    '',
    '## Що зроблено',
    report.summary,
    report.followups?.length
      ? `\n## Пропозиції (створено issues з міткою triage)\n${report.followups.map((f) => `- ${f.title}`).join('\n')}`
      : '',
    '',
    `_Автопілот · [лог](${RUN_URL}) · вартість ≈ $${(raw.total_cost_usd ?? 0).toFixed(2)}_`,
  ].join('\n');
  const bodyFile = `${process.env.RUNNER_TEMP ?? '/tmp'}/pr-body.md`;
  writeFileSync(bodyFile, body);

  const auth = { token: AGENT_GH_TOKEN };
  url = gh(
    [
      'pr',
      'create',
      '--repo',
      REPO,
      '--head',
      BRANCH,
      '--base',
      'main',
      '--title',
      title,
      '--body-file',
      bodyFile,
      '--label',
      'agent',
    ],
    auth,
  ).trim();
  gh(['pr', 'merge', url, '--auto', '--squash', '--delete-branch'], auth);
  console.log(`PR: ${url}`);
} catch (e) {
  handOver(`не вдалося опублікувати PR: ${redact(e.stderr || e.message, AGENT_GH_TOKEN)}`);
  process.exit(0);
}

for (const f of report.followups ?? []) {
  gh([
    'issue',
    'create',
    '--repo',
    REPO,
    '--title',
    f.title,
    '--label',
    'triage',
    '--body',
    `${f.body}\n\n_Запропоновано агентом під час #${issue}._`,
  ]);
}
