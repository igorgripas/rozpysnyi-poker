// Перевірка деплою на Render (T51). Використання:
//   node render-deploy.mjs wait      — чекає деплою коміту SHA для сервісів RENDER_SERVICES
//   node render-deploy.mjs rollback  — відкочує сервіси з DEPLOYED до попереднього live-деплою
// Ключ — RENDER_API_KEY (environment `production`, лише з main).
import { appendFileSync } from 'node:fs';

const API = 'https://api.render.com/v1';
const { RENDER_API_KEY, SHA, RENDER_SERVICES = '', DEPLOYED = '' } = process.env;
const FAILED = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled']);
/** Скільки чекати, поки Render узагалі створить деплой коміту (buildFilter може його пропустити). */
const APPEAR_MS = 5 * 60_000;
const FINISH_MS = 25 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${RENDER_API_KEY.trim()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok)
    throw new Error(
      `Render API ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`,
    );
  return res.status === 204 ? null : res.json();
}

function output(name, value) {
  const line = `${name}<<__EOF__\n${value}\n__EOF__\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  console.log(`${name}=${value}`);
}

async function serviceId(name) {
  const list = await api(`/services?name=${encodeURIComponent(name)}&limit=20`);
  const found = list.map((x) => x.service).find((s) => s.name === name);
  if (!found) throw new Error(`Сервіс ${name} не знайдено на Render`);
  return found.id;
}

const deploys = async (id) => (await api(`/services/${id}/deploys?limit=20`)).map((x) => x.deploy);

/** Чекає деплою коміту; повертає {status, previous} або null, якщо деплою цього коміту немає. */
async function waitFor(name, id) {
  const started = Date.now();
  while (Date.now() - started < FINISH_MS) {
    const list = await deploys(id);
    const mine = list.find((d) => d.commit?.id === SHA);
    if (!mine) {
      if (Date.now() - started > APPEAR_MS) return null;
    } else if (mine.status === 'live') {
      const previous = list.find(
        (d) => d.id !== mine.id && ['live', 'deactivated'].includes(d.status),
      );
      return { status: 'live', deploy: mine.id, previous: previous?.id ?? '' };
    } else if (FAILED.has(mine.status)) {
      return { status: mine.status, deploy: mine.id, previous: '' };
    } else if (mine.status === 'deactivated') {
      return null; // уже витіснений новішим деплоєм — перевірить його прогін
    }
    console.log(`${name}: ${mine?.status ?? 'деплою ще немає'}…`);
    await sleep(15_000);
  }
  throw new Error(
    `${name}: деплой коміту ${SHA.slice(0, 7)} не завершився за ${FINISH_MS / 60_000} хв`,
  );
}

const command = process.argv[2];
if (command === 'wait') {
  const deployed = [];
  const failures = [];
  for (const name of RENDER_SERVICES.split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const id = await serviceId(name);
    const result = await waitFor(name, id);
    if (result === null) {
      console.log(`${name}: коміт ${SHA.slice(0, 7)} цей сервіс не змінює — деплою немає`);
    } else if (result.status === 'live') {
      console.log(`${name}: live (${result.deploy}), попередній ${result.previous || '—'}`);
      deployed.push(`${name}:${id}:${result.previous}`);
    } else {
      failures.push(`${name}: ${result.status} (${result.deploy})`);
    }
  }
  output('deployed', deployed.join(' '));
  output('failures', failures.join('; '));
  if (failures.length) process.exit(1);
} else if (command === 'rollback') {
  for (const item of DEPLOYED.split(/\s+/).filter(Boolean)) {
    const [name, id, previous] = item.split(':');
    if (!previous) {
      console.log(`${name}: немає попереднього деплою — відкочувати нікуди`);
      continue;
    }
    await api(`/services/${id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ deployId: previous }),
    });
    console.log(`${name}: відкат до ${previous}`);
  }
} else {
  console.error('Команда: wait | rollback');
  process.exit(2);
}
