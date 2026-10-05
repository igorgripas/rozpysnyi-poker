/**
 * Відтворення гри з replay-файлу (AUTOPILOT §6): JSON або текст issue з блоком ```json.
 * Друкує, до чого дійшла гра; дія, яку рушій відхиляє, — помилка з її номером у лозі.
 *
 * Запуск: `pnpm replay <file>` (напр., `gh issue view 123 --json body -q .body > bug.md`).
 */
import { readFileSync } from 'node:fs';
import {
  type GameState,
  apply,
  createGame,
  migrateLog,
  parseReplayFile,
  scoreTable,
} from '../src/index.js';

const path = process.argv[2];
if (path === undefined) {
  console.error('Використання: pnpm replay <file>');
  process.exit(2);
}

const file = parseReplayFile(readFileSync(path, 'utf8'));
const { playerCount, options, rulesVersion, actions } = migrateLog(file.log);
let state: GameState = createGame(file.seed, playerCount, options, rulesVersion);
for (const [index, action] of actions.entries()) {
  try {
    state = apply(state, action);
  } catch (error) {
    console.error(`✗ Дія #${index} ${JSON.stringify(action)}: ${(error as Error).message}`);
    process.exit(1);
  }
}

console.log(`Seed ${file.seed}, гравців: ${playerCount}, дій: ${actions.length}.`);
if (state.status === 'finished') {
  console.log('Гра завершена.');
} else {
  const { hand } = state;
  console.log(
    `Роздача #${hand.spec.index + 1}, карт: ${hand.spec.cards}, статус: ${state.status}, ` +
      `хід місця: ${state.turn ?? '—'}, козир: ${hand.trump ?? 'б/к'}.`,
  );
  console.log(`Замовлення: ${JSON.stringify(hand.bids)}, взято: ${JSON.stringify(hand.taken)}.`);
}
console.log(`Бали: ${JSON.stringify(scoreTable(state).summary.map((s) => s.final))}.`);
