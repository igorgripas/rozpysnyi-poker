// Required check `guard`: захищені файли змінюються лише з мітки `spec-change` від власника.
import { OWNER, REPO, comment, gh, ghJson, isProtected } from './lib.mjs';

const { PR } = process.env;
const files = gh(['api', `repos/${REPO}/pulls/${PR}/files`, '--paginate', '--jq', '.[].filename'])
  .split('\n')
  .filter(Boolean);
const touched = files.filter(isProtected);
if (!touched.length) {
  console.log('Захищені файли не змінено.');
  process.exit(0);
}

const pr = ghJson(['pr', 'view', PR, '--repo', REPO, '--json', 'labels,author,comments']);
const labels = pr.labels.map((l) => l.name);
const isAgent = labels.includes('agent');

if (!isAgent && pr.author?.login === OWNER) {
  console.log(`PR власника змінює захищені файли: ${touched.join(', ')} — дозволено.`);
  process.exit(0);
}

const events = ghJson(['api', `repos/${REPO}/issues/${PR}/events`, '--paginate', '--slurp'])
  .flat()
  .filter((e) => e.event === 'labeled' && e.label?.name === 'spec-change');
const approvedBy = events.at(-1)?.actor?.login;
if (labels.includes('spec-change') && approvedBy === OWNER) {
  console.log(`spec-change схвалено ${OWNER}: ${touched.join(', ')}`);
  process.exit(0);
}

const marker = '<!-- guard -->';
if (isAgent && !pr.comments.some((c) => c.body.includes(marker))) {
  comment(
    PR,
    `${marker}\n🔒 PR змінює захищені файли:\n${touched.map((f) => `- \`${f}\``).join('\n')}\n\n@${OWNER}, переглянь зміни і постав мітку \`spec-change\`, щоб дозволити merge.`,
  );
}
console.error(`Змінено захищені файли без схвалення: ${touched.join(', ')}`);
process.exit(1);
