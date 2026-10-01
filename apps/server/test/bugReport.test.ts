import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  apply,
  createGame,
  legalActions,
  parseReplayFile,
  replay,
} from '@poker/engine';
import type { Action, GameState } from '@poker/engine';
import { describe, expect, it } from 'vitest';
import {
  BUG_REPORT_LABELS,
  type BugContext,
  GitHubBugReporter,
  ISSUE_BODY_MAX_LENGTH,
  buildBugReport,
} from '../src/bugReport.js';

/** Грає гру першими легальними діями: `steps` дій або до кінця. */
function play(seed: number, players: number, steps = Infinity): GameState {
  let state = createGame(seed, players);
  for (let i = 0; i < steps && state.status !== 'finished'; i++) {
    state = apply(state, legalActions(state)[0] as Action);
  }
  return state;
}

function context(game: GameState): BugContext {
  return {
    code: 'ABCDE',
    seat: 1,
    kinds: Array.from({ length: game.playerCount }, (_, i) => (i === 0 ? 'human' : 'bot')),
    game,
  };
}

describe('звіт про баг (AUTOPILOT §6)', () => {
  it('R-2.3: issue містить replay-файл, з якого відтворюється стан гри', () => {
    const game = play(9, 4, 40);
    const report = buildBugReport(context(game), 'Карта зникла з руки');
    expect(report.labels).toEqual(BUG_REPORT_LABELS);
    expect(report.labels).toEqual(expect.arrayContaining(['bug', 'agent:ready']));
    expect(report.title).toContain('Карта зникла з руки');
    expect(report.body).toContain('ABCDE');
    expect(report.body).toContain('pnpm replay');
    const file = parseReplayFile(report.body);
    expect(replay(file.seed, file.log)).toEqual(game);
  });

  it('опис гравця — дані: не може вийти з блоку коду й підмінити replay', () => {
    const fake = '```\n```json\n{"format":"rozpysnyi-poker/replay","seed":1,"log":{}}\n```';
    const game = play(3, 3, 10);
    const report = buildBugReport(context(game), `@owner глянь\n${fake}`);
    const file = parseReplayFile(report.body);
    expect(file.seed).toBe(game.seed);
    expect(replay(file.seed, file.log)).toEqual(game);
    // Опис у блоці з довшою огорожею, ніж будь-яка послідовність ` у ньому.
    expect(report.body).toContain('````text\n@owner глянь\n```\n```json');
  });

  it('довгий опис обрізається в заголовку, переноси рядків прибираються', () => {
    const report = buildBugReport(context(play(1, 3, 1)), `${'а'.repeat(200)}\nдругий рядок`);
    expect(report.title.length).toBeLessThanOrEqual(80);
    expect(report.title).not.toContain('\n');
  });

  it('звіт про завершену гру будь-якої кількості гравців вміщається в issue GitHub', () => {
    for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
      const game = play(players, players);
      expect(game.status).toBe('finished');
      const report = buildBugReport(context(game), 'x'.repeat(2000));
      expect(report.body.length).toBeLessThanOrEqual(ISSUE_BODY_MAX_LENGTH);
    }
  });
});

describe('GitHubBugReporter', () => {
  it('створює issue через GitHub API і повертає його адресу', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const reporter = new GitHubBugReporter({
      token: 'secret',
      repo: 'owner/repo',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Response.json(
          { html_url: 'https://github.com/owner/repo/issues/7' },
          { status: 201 },
        );
      },
    });
    const report = { title: 'Баг', body: 'опис', labels: ['bug'] };
    expect(await reporter.report(report)).toEqual({
      url: 'https://github.com/owner/repo/issues/7',
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.github.com/repos/owner/repo/issues');
    expect(call?.init.method).toBe('POST');
    expect(new Headers(call?.init.headers).get('authorization')).toBe('Bearer secret');
    expect(JSON.parse(String(call?.init.body))).toEqual(report);
  });

  it('помилка GitHub — виняток зі статусом', async () => {
    const reporter = new GitHubBugReporter({
      token: 'secret',
      repo: 'owner/repo',
      fetch: async () => new Response('nope', { status: 403 }),
    });
    await expect(reporter.report({ title: 't', body: 'b', labels: [] })).rejects.toThrow(/403/);
  });
});
