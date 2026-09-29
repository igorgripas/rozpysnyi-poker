// Після роботи агента: пуш гілки й PR з auto-merge для виконаних задач пакета;
// невиконані повертаються в чергу, а задача, на якій агент зупинився, — людині.
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

const { ISSUES, ISSUE, BRANCH, RESULT_FILE, AGENT_GH_TOKEN, GITHUB_WORKSPACE } = process.env;
const batch = (ISSUES || ISSUE).split(/\s+/).filter(Boolean).map(Number);
const { raw, report, error } = readResult(RESULT_FILE);
const ahead = Number(
  run('git', ['-C', GITHUB_WORKSPACE, 'rev-list', '--count', 'origin/main..HEAD']).trim(),
);

/** Повертає задачі в чергу; першу з них (на якій зупинився агент) — людині. */
function handOver(issues, reason) {
  issues.forEach((issue, idx) => {
    removeLabels(issue, ['agent:in-progress']);
    if (idx === 0) {
      addLabels(issue, ['needs-human']);
      comment(
        issue,
        `🛑 Автопілот зупинився: ${reason}\n\n${report?.summary ?? ''}\n\nЛог: ${RUN_URL}`,
      );
    }
  });
  console.log(`needs-human #${issues[0]}: ${reason}`);
}

if (!report) {
  handOver(batch, `агент не повернув звіт (${failureReason(raw, error)}).`);
  process.exit(0);
}
if (ahead === 0) {
  handOver(batch, report.blocked_reason || 'агент не створив жодного коміту.');
  process.exit(0);
}

// Старі звіти без `completed`: при status=done вважаємо виконаним увесь пакет.
const completed = Array.isArray(report.completed)
  ? batch.filter((n) => report.completed.includes(n))
  : report.status === 'done'
    ? batch
    : [];
const rest = batch.filter((n) => !completed.includes(n));

if (!completed.length) {
  handOver(batch, report.blocked_reason || 'агент позначив задачу як заблоковану.');
  process.exit(0);
}

const titles = completed.map(
  (n) => ghJson(['issue', 'view', String(n), '--repo', REPO, '--json', 'title']).title,
);
let title = titles[0];
if (titles.length > 1) {
  const ids = titles.map((t) => t.match(/^(T\d+):/)?.[1] ?? '').filter(Boolean);
  const names = titles.map((t) => t.replace(/^T\d+:\s*/, '')).join('; ');
  title = `${ids.length === titles.length ? ids.join(', ') : 'Пакет'}: ${names}`;
  if (title.length > 200) title = `${title.slice(0, 197)}...`;
}

try {
  pushFromWorkspace({
    workspace: GITHUB_WORKSPACE,
    branch: BRANCH,
    token: AGENT_GH_TOKEN,
    force: true,
  });

  const body = [
    ...completed.map((n) => `Closes #${n}`),
    '',
    '## Що зроблено',
    report.summary,
    rest.length
      ? `\n## Не виконано в цьому PR\n${rest.map((n) => `- #${n}`).join('\n')}\n\n${report.blocked_reason ?? ''}`
      : '',
    report.followups?.length
      ? `\n## Пропозиції (створено issues з міткою triage)\n${report.followups.map((f) => `- ${f.title}`).join('\n')}`
      : '',
    '',
    `_Автопілот · [лог](${RUN_URL}) · вартість ≈ $${(raw.total_cost_usd ?? 0).toFixed(2)}_`,
  ].join('\n');
  const bodyFile = `${process.env.RUNNER_TEMP ?? '/tmp'}/pr-body.md`;
  writeFileSync(bodyFile, body);

  const auth = { token: AGENT_GH_TOKEN };
  const url = gh(
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
  console.log(`PR: ${url} (задачі: ${completed.join(', ')})`);
} catch (e) {
  handOver(batch, `не вдалося опублікувати PR: ${redact(e.stderr || e.message, AGENT_GH_TOKEN)}`);
  process.exit(0);
}

if (rest.length) {
  if (report.blocked_reason) handOver(rest, report.blocked_reason);
  else for (const n of rest) removeLabels(n, ['agent:in-progress']);
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
    `${f.body}\n\n_Запропоновано агентом під час ${completed.map((n) => `#${n}`).join(', ')}._`,
  ]);
}
