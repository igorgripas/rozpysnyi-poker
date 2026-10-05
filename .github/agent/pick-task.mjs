// Обирає наступний пакет задач (до AGENT_BATCH_SIZE, один етап) або нічого, якщо агент зайнятий /
// на паузі / вичерпав ліміт. Задачі, що потребують `spec-change`, завжди йдуть окремим PR.
import {
  REPO,
  addLabels,
  closesIssues,
  comment,
  dependsOn,
  gh,
  ghJson,
  removeLabels,
  setOutput,
} from './lib.mjs';

const PRIORITY = { P0: 0, P1: 1, P2: 2 };
const cap = Number(process.env.AGENT_DAILY_PR_CAP || 10);
const batchSize = Math.max(1, Number(process.env.AGENT_BATCH_SIZE || 3));

function done(issues, reason) {
  console.log(
    issues.length
      ? `Обрано ${issues.map((n) => `#${n}`).join(', ')}`
      : `Нічого не обрано: ${reason}`,
  );
  setOutput('issue', issues.length ? String(issues[0]) : '');
  setOutput('issues', issues.join(' '));
  process.exit(0);
}

if (process.env.AGENT_PAUSED === 'true') done([], 'AGENT_PAUSED=true');

const MAX_OPEN_PRS = 2;
const openPrs = ghJson([
  'pr',
  'list',
  '--repo',
  REPO,
  '--label',
  'agent',
  '--state',
  'open',
  '--json',
  'number,body,labels,statusCheckRollup',
]);
/** Стан перевірки PR: commit status (`state`) або check run (`conclusion`). */
const checkState = (pr, name) => {
  const check = pr.statusCheckRollup.find((c) => (c.context ?? c.name) === name);
  return check?.state ?? check?.conclusion;
};
// PR, що чекає лише на людину (мітка spec-change чи needs-human), не блокує інші задачі:
// інакше вся черга стоїть, поки власник недоступний. Решта PR агента — блокують.
const waitsForHuman = (pr) =>
  pr.labels.some((l) => l.name === 'needs-human') ||
  (checkState(pr, 'verify') === 'SUCCESS' &&
    checkState(pr, 'agent-review') === 'SUCCESS' &&
    checkState(pr, 'guard') === 'FAILURE');
// PR із конфліктом злиття з main сам не змерджиться: запускаємо фіксер (раз на конфлікт).
for (const pr of openPrs) {
  const state = gh(['api', `repos/${REPO}/pulls/${pr.number}`, '--jq', '.mergeable_state']).trim();
  const labels = pr.labels.map((l) => l.name);
  if (state === 'dirty' && !labels.includes('agent:conflict') && !labels.includes('needs-human')) {
    console.log(`PR #${pr.number}: конфлікт із main — запускаю фіксер`);
    addLabels(pr.number, ['agent:conflict']);
    gh([
      'workflow',
      'run',
      'agent-fix.yml',
      '--repo',
      REPO,
      '-f',
      `pr=${pr.number}`,
      '-f',
      'reason=conflict',
    ]);
  }
}
const blocking = openPrs.filter((pr) => !waitsForHuman(pr));
if (blocking.length) done([], `відкритий PR агента #${blocking[0].number}`);
if (openPrs.length >= MAX_OPEN_PRS) {
  done(
    [],
    `${openPrs.length} PR агента чекають на людину: ${openPrs.map((p) => `#${p.number}`).join(', ')}`,
  );
}
// Задачі з відкритих PR — зайняті: їх не скидаємо як «застряглі» і не беремо вдруге.
const busy = new Set(openPrs.flatMap((pr) => closesIssues(pr.body)));

const today = new Date().toISOString().slice(0, 10);
const createdToday = ghJson([
  'pr',
  'list',
  '--repo',
  REPO,
  '--label',
  'agent',
  '--state',
  'all',
  '--search',
  `created:>=${today}`,
  '--json',
  'number',
  '--limit',
  '100',
]);
if (createdToday.length >= cap) done([], `денний ліміт ${cap} PR вичерпано`);

const all = ghJson([
  'issue',
  'list',
  '--repo',
  REPO,
  '--state',
  'all',
  '--limit',
  '1000',
  '--json',
  'number,state,title,labels',
]);
const state = new Map(all.map((i) => [i.number, i.state]));

// Після merge GitHub закриває issues із затримкою, а dispatch стартує одразу на push у main.
// Задачі зі змерджених PR агента вважаємо закритими, щоб не взяти їх удруге.
const recentlyMerged = ghJson([
  'pr',
  'list',
  '--repo',
  REPO,
  '--label',
  'agent',
  '--state',
  'merged',
  '--limit',
  '20',
  '--json',
  'body',
]);
for (const pr of recentlyMerged) for (const n of closesIssues(pr.body)) state.set(n, 'CLOSED');
const labelsOf = (i) => new Set(i.labels.map((l) => l.name));

// Задачі, що «застрягли» в роботі без PR (впав job) — повертаємо в чергу, вдруге — людині.
for (const i of all.filter(
  (i) =>
    state.get(i.number) === 'OPEN' && labelsOf(i).has('agent:in-progress') && !busy.has(i.number),
)) {
  removeLabels(i.number, ['agent:in-progress']);
  if (labelsOf(i).has('agent:stale')) {
    addLabels(i.number, ['needs-human']);
    comment(
      i.number,
      'Автопілот двічі не зміг завершити задачу (job впав без PR). Потрібна людина.',
    );
  } else {
    addLabels(i.number, ['agent:stale']);
  }
}

const ready = ghJson([
  'issue',
  'list',
  '--repo',
  REPO,
  '--state',
  'open',
  '--label',
  'agent:ready',
  '--limit',
  '500',
  '--json',
  'number,body,labels',
]);
const prio = (i) => {
  const p = [...labelsOf(i)].find((l) => l in PRIORITY);
  return p ? PRIORITY[p] : 1;
};
const epic = (i) => [...labelsOf(i)].find((l) => l.startsWith('epic:')) ?? null;
const solo = (i) => /spec-change/.test(i.body ?? '');
const depsReady = (i, batch) =>
  dependsOn(i.body).every((n) => state.get(n) !== 'OPEN' || batch.has(n));
const sorted = ready
  .filter((i) => state.get(i.number) === 'OPEN' && !busy.has(i.number))
  .filter((i) => !labelsOf(i).has('needs-human') && !labelsOf(i).has('agent:in-progress'))
  .sort((a, b) => prio(a) - prio(b) || a.number - b.number);

const first = sorted.find((i) => depsReady(i, new Set()));
if (!first) done([], 'немає готових задач із закритими залежностями');

// Пакет: задачі того ж етапу, чиї залежності закриті або вже є в пакеті (порядок = топологічний).
const batch = [first];
while (!solo(first) && batch.length < batchSize) {
  const taken = new Set(batch.map((i) => i.number));
  const next = sorted.find(
    (i) => !taken.has(i.number) && !solo(i) && epic(i) === epic(first) && depsReady(i, taken),
  );
  if (!next) break;
  batch.push(next);
}

const numbers = batch.map((i) => i.number);
for (const n of numbers) addLabels(n, ['agent:in-progress']);
done(numbers);
