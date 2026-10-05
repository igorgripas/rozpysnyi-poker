// Спільні хелпери для керувальних скриптів автопілота. Запускаються лише з main.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

export const REPO = process.env.GITHUB_REPOSITORY ?? process.env.REPO;
export const OWNER = process.env.GITHUB_REPOSITORY_OWNER ?? REPO?.split('/')[0];
export const RUN_URL = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '(локальний запуск)';

/** Шляхи, які агент не може змінювати без мітки `spec-change` від власника. */
export const PROTECTED = [
  /^docs\/RULES\.md$/,
  /^packages\/engine\/test\/golden\//,
  /^\.github\//,
  /^apps\/web\/smoke\//,
  /^CLAUDE\.md$/,
];
export const isProtected = (file) => PROTECTED.some((re) => re.test(file));

export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
}

/** Виклик gh; `token` підміняє GH_TOKEN (напр. PAT агента замість GITHUB_TOKEN). */
export function gh(args, { token, input } = {}) {
  const env = token ? { ...process.env, GH_TOKEN: token.trim() } : process.env;
  return run('gh', args, { env, input });
}
export const ghJson = (args, opts) => JSON.parse(gh(args, opts) || 'null');

export function setOutput(name, value) {
  const line = `${name}<<__EOF__\n${value}\n__EOF__\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  else console.log(`[output] ${name}=${value}`);
}

/** DRY_RUN=1 — лише логувати зміни міток і коментарі (для локальної перевірки). */
const DRY = Boolean(process.env.DRY_RUN);

export function addLabels(number, labels, opts) {
  if (DRY) return console.log(`[dry] #${number} +${labels.join(',')}`);
  if (labels.length)
    gh(['issue', 'edit', String(number), '--repo', REPO, '--add-label', labels.join(',')], opts);
}
export function removeLabels(number, labels, opts) {
  if (DRY) return console.log(`[dry] #${number} -${labels.join(',')}`);
  for (const label of labels) {
    try {
      gh(['issue', 'edit', String(number), '--repo', REPO, '--remove-label', label], opts);
    } catch {
      // мітки могло й не бути
    }
  }
}
export function comment(number, body, opts) {
  if (DRY) return console.log(`[dry] #${number} коментар: ${body.slice(0, 80)}`);
  gh(['issue', 'comment', String(number), '--repo', REPO, '--body-file', '-'], {
    ...opts,
    input: body,
  });
}

/** Номери з рядка `Depends on #1, #2`. */
export function dependsOn(body = '') {
  const line = body.match(/Depends on:?([^\n]*)/i);
  return line ? [...line[1].matchAll(/#(\d+)/g)].map((m) => Number(m[1])) : [];
}

/** Номери issues з рядків `Closes #N` у тілі PR (PR може закривати пакет задач). */
export function closesIssues(body = '') {
  return [...body.matchAll(/(?:Closes|Fixes|Resolves)\s+#(\d+)/gi)].map((m) => Number(m[1]));
}

/** Короткий опис, чому агент не повернув звіт (текст помилки CLI, а не лише subtype). */
export function failureReason(raw, error) {
  if (!raw) return error ?? 'немає result.json';
  const text = typeof raw.result === 'string' ? raw.result.slice(0, 300) : '';
  return [raw.subtype, raw.is_error ? 'is_error' : '', text].filter(Boolean).join(': ');
}

export function readResult(path) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return { raw, report: raw.structured_output ?? null };
  } catch (e) {
    return { raw: null, report: null, error: String(e) };
  }
}

/** Прибирає токени з тексту, що може потрапити в публічний коментар. */
export function redact(text, ...secrets) {
  let out = String(text);
  for (const secret of secrets.filter(Boolean)) out = out.split(secret).join('***');
  return out.replace(
    /(x-access-token:|basic |gh[pousr]_|github_pat_)[A-Za-z0-9_=+/:-]+/gi,
    '$1***',
  );
}

/**
 * Переносить коміти з робочої копії (де працював агент) у чистий репозиторій і пушить з PAT.
 * Робоча копія вважається недовіреною: її git-config і хуки не використовуються.
 * Токен передається заголовком (не в URL), щоб не потрапити в повідомлення про помилки.
 */
export function pushFromWorkspace({ workspace, branch, token, force = false }) {
  const dir = `${process.env.RUNNER_TEMP ?? '/tmp'}/push-${Date.now()}`;
  const basic = Buffer.from(`x-access-token:${token.trim()}`).toString('base64');
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${basic}`);
  run('git', ['init', '-q', dir]);
  run('git', ['-C', dir, 'fetch', '-q', '--no-tags', workspace, `HEAD:refs/heads/${branch}`]);
  run('git', [
    '-C',
    dir,
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`,
    'push',
    '-q',
    ...(force ? ['--force'] : []),
    `https://github.com/${REPO}.git`,
    `refs/heads/${branch}:refs/heads/${branch}`,
  ]);
}
