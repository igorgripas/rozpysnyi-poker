// Щоденний звіт автопілота — коментар у закріпленому issue з міткою `digest`.
import { REPO, comment, gh, ghJson } from './lib.mjs';

const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19);
const list = (kind, args) =>
  ghJson([kind, 'list', '--repo', REPO, '--limit', '100', '--json', 'number,title,url', ...args]);
const fmt = (items) =>
  items.length ? items.map((i) => `- [#${i.number}](${i.url}) ${i.title}`).join('\n') : '- —';

const merged = list('pr', ['--state', 'merged', '--search', `merged:>=${since}`]);
const openAgent = list('pr', ['--state', 'open', '--label', 'agent']);
const needsHuman = list('issue', ['--state', 'open', '--label', 'needs-human']);
const needsHumanPr = list('pr', ['--state', 'open', '--label', 'needs-human']);
const triage = list('issue', ['--state', 'open', '--label', 'triage']);
const ready = list('issue', ['--state', 'open', '--label', 'agent:ready']);
const closed = list('issue', ['--state', 'closed', '--search', `closed:>=${since}`]);
const paused = process.env.AGENT_PAUSED === 'true';

const body = `## Звіт за ${new Date().toISOString().slice(0, 10)}${paused ? ' · ⏸ автопілот на паузі' : ''}

### ✅ Змерджено за добу (${merged.length})
${fmt(merged)}

### ⏳ PR агента в роботі
${fmt(openAgent)}

### 🛑 Потрібна людина (${needsHuman.length + needsHumanPr.length})
${fmt([...needsHuman, ...needsHumanPr])}

### 💡 Пропозиції агента на розгляд (triage)
${fmt(triage)}

Закрито задач за добу: ${closed.length} · у черзі \`agent:ready\`: ${ready.length}`;

let digest = list('issue', ['--state', 'open', '--label', 'digest'])[0];
if (!digest) {
  const url = gh([
    'issue',
    'create',
    '--repo',
    REPO,
    '--title',
    '📋 Щоденний звіт автопілота',
    '--label',
    'digest',
    '--body',
    'Тут автопілот щодня публікує звіт. Підпишись на issue, щоб отримувати сповіщення.',
  ]).trim();
  digest = { number: Number(url.split('/').pop()) };
  gh(['issue', 'pin', String(digest.number), '--repo', REPO]);
}
comment(digest.number, body);
