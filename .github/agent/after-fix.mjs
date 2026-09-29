// Після фіксу: пуш нових комітів; зняття `spec-change`, якщо змінено захищені файли.
import {
  REPO,
  RUN_URL,
  addLabels,
  comment,
  gh,
  ghJson,
  isProtected,
  pushFromWorkspace,
  readResult,
  removeLabels,
  run,
} from './lib.mjs';

const { PR, BRANCH, RESULT_FILE, AGENT_GH_TOKEN, GITHUB_WORKSPACE } = process.env;
const { report } = readResult(RESULT_FILE);
const ahead = Number(
  run('git', ['-C', GITHUB_WORKSPACE, 'rev-list', '--count', `origin/${BRANCH}..HEAD`]).trim(),
);

if (report?.status !== 'done' || ahead === 0) {
  addLabels(PR, ['needs-human']);
  comment(
    PR,
    `🛑 Фіксер не зміг виправити: ${report?.blocked_reason ?? report?.summary ?? 'без звіту'}\n\nЛог: ${RUN_URL}`,
  );
  process.exit(0);
}

const touched = run('git', [
  '-C',
  GITHUB_WORKSPACE,
  'diff',
  '--name-only',
  `origin/${BRANCH}..HEAD`,
])
  .split('\n')
  .filter(Boolean)
  .filter(isProtected);
pushFromWorkspace({ workspace: GITHUB_WORKSPACE, branch: BRANCH, token: AGENT_GH_TOKEN });

const labels = ghJson(['pr', 'view', PR, '--repo', REPO, '--json', 'labels']).labels.map(
  (l) => l.name,
);
if (touched.length && labels.includes('spec-change')) {
  removeLabels(PR, ['spec-change']);
  comment(
    PR,
    `Фіксер змінив захищені файли (${touched.join(', ')}). Мітку \`spec-change\` знято — потрібне повторне схвалення.`,
  );
}
gh(['pr', 'comment', PR, '--repo', REPO, '--body', `🔧 Виправлено: ${report.summary}`]);
