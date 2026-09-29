// Обирає наступну задачу для агента або нічого, якщо агент зайнятий / на паузі / вичерпав ліміт.
import { REPO, addLabels, comment, dependsOn, ghJson, removeLabels, setOutput } from './lib.mjs';

const PRIORITY = { P0: 0, P1: 1, P2: 2 };
const cap = Number(process.env.AGENT_DAILY_PR_CAP || 10);

function done(issue, reason) {
  console.log(issue ? `Обрано #${issue}` : `Нічого не обрано: ${reason}`);
  setOutput('issue', issue ? String(issue) : '');
  process.exit(0);
}

if (process.env.AGENT_PAUSED === 'true') done(null, 'AGENT_PAUSED=true');

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
  'number',
]);
if (openPrs.length) done(null, `відкритий PR агента #${openPrs[0].number}`);

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
if (createdToday.length >= cap) done(null, `денний ліміт ${cap} PR вичерпано`);

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
const labelsOf = (i) => new Set(i.labels.map((l) => l.name));

// Задачі, що «застрягли» в роботі без PR (впав job) — повертаємо в чергу, вдруге — людині.
for (const i of all.filter((i) => i.state === 'OPEN' && labelsOf(i).has('agent:in-progress'))) {
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
const candidates = ready
  .filter((i) => !labelsOf(i).has('needs-human'))
  .filter((i) => dependsOn(i.body).every((n) => state.get(n) !== 'OPEN'))
  .map((i) => {
    const p = [...labelsOf(i)].find((l) => l in PRIORITY);
    return { number: i.number, prio: p ? PRIORITY[p] : 1 };
  })
  .sort((a, b) => a.prio - b.prio || a.number - b.number);

if (!candidates.length) done(null, 'немає готових задач із закритими залежностями');
const issue = candidates[0].number;
addLabels(issue, ['agent:in-progress']);
done(issue);
