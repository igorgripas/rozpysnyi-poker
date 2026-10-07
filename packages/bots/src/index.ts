export type { Bot } from './bot.js';
export { createRandomBot } from './random.js';
export { playGame } from './play.js';
export { createHeuristicBot } from './heuristic.js';
export {
  SIGNIFICANCE_Z,
  formatBenchmark,
  formatSelfPlay,
  runBenchmark,
  runSelfPlay,
} from './benchmark.js';
export type {
  BenchmarkOptions,
  BenchmarkResult,
  BenchmarkRow,
  SelfPlayResult,
} from './benchmark.js';
export { COMPARE_Z, compareBots, formatComparison } from './compare.js';
export type { CompareOptions, CompareResult, CompareRow, CompareSide } from './compare.js';
