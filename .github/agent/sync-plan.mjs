// Синхронізує docs/PLAN.md → GitHub Issues (створює нові, оновлює опис існуючих).
// Задачі етапу M0 виконуються вручну й не синхронізуються.
import { readFileSync } from 'node:fs';
import { REPO, gh, ghJson } from './lib.mjs';

const LABELS = {
  'agent:ready': ['0e8a16', 'Готово для агента'],
  'agent:in-progress': ['fbca04', 'Агент працює'],
  'agent:stale': ['d4c5f9', 'Job агента впав без PR'],
  'agent:attempt-1': ['ededed', 'Спроба фіксу 1'],
  'agent:attempt-2': ['ededed', 'Спроба фіксу 2'],
  'agent:attempt-3': ['ededed', 'Спроба фіксу 3'],
  'agent:conflict': ['e99695', 'PR конфліктує з main, фіксер зливає'],
  agent: ['1d76db', 'PR створено агентом'],
  'needs-human': ['b60205', 'Потрібне рішення людини'],
  'spec-change': ['5319e7', 'Власник дозволив змінити захищені файли'],
  triage: ['c5def5', 'Пропозиція, чекає рішення людини'],
  digest: ['bfdadc', 'Щоденний звіт'],
  bug: ['d73a4a', 'Баг'],
  P0: ['b60205', 'Критично'],
  P1: ['d93f0b', 'Звичайний пріоритет'],
  P2: ['fef2c0', 'Низький пріоритет'],
};

const plan = readFileSync(new URL('../../docs/PLAN.md', import.meta.url), 'utf8');
const tasks = [];
let stage = null;
for (const line of plan.split('\n')) {
  const h = line.match(/^## (M\d+) — (.+)$/);
  if (h) stage = { id: h[1], name: h[2] };
  const t = line.match(/^- \*\*(T\d+) — (.+?)\*\* · (.+?) · (.+)$/);
  if (t && stage)
    tasks.push({ id: t[1], title: t[2], deps: parseDeps(t[3]), criteria: t[4], stage });
}

function parseDeps(text) {
  const ids = [];
  for (const part of text.split(',').map((s) => s.trim())) {
    const range = part.match(/^T(\d+)[–-]T(\d+)$/);
    if (range) for (let n = Number(range[1]); n <= Number(range[2]); n++) ids.push(`T${n}`);
    else if (/^T\d+$/.test(part)) ids.push(part);
  }
  return ids;
}

const stages = [...new Set(tasks.map((t) => t.stage.id))];
for (const [name, [color, description]] of Object.entries(LABELS)) {
  gh([
    'label',
    'create',
    name,
    '--repo',
    REPO,
    '--color',
    color,
    '--description',
    description,
    '--force',
  ]);
}
for (const s of stages)
  gh(['label', 'create', `epic:${s}`, '--repo', REPO, '--color', '006b75', '--force']);

const existing = ghJson([
  'issue',
  'list',
  '--repo',
  REPO,
  '--state',
  'all',
  '--limit',
  '1000',
  '--json',
  'number,title,body',
]);
const byId = new Map();
for (const i of existing) {
  const m = i.title.match(/^(T\d+):/);
  if (m) byId.set(m[1], i);
}

for (const t of tasks.filter((t) => t.stage.id !== 'M0')) {
  const deps = t.deps.map((d) => byId.get(d)?.number).filter(Boolean);
  const body = [
    t.criteria,
    '',
    `Етап: ${t.stage.id} — ${t.stage.name}. Джерело: \`docs/PLAN.md\`, правила: \`docs/RULES.md\`.`,
    deps.length ? `\nDepends on ${deps.map((n) => `#${n}`).join(', ')}` : '',
  ].join('\n');
  const title = `${t.id}: ${t.title}`;
  const found = byId.get(t.id);
  if (!found) {
    const labels = [
      `epic:${t.stage.id}`,
      'P1',
      /needs-human/.test(t.criteria) ? 'needs-human' : 'agent:ready',
    ];
    const url = gh([
      'issue',
      'create',
      '--repo',
      REPO,
      '--title',
      title,
      '--body',
      body,
      '--label',
      labels.join(','),
    ]).trim();
    byId.set(t.id, { number: Number(url.split('/').pop()), title, body });
    console.log(`+ ${title}`);
  } else if (found.body.trim() !== body.trim() || found.title !== title) {
    gh(['issue', 'edit', String(found.number), '--repo', REPO, '--title', title, '--body', body]);
    console.log(`~ ${title}`);
  }
}
