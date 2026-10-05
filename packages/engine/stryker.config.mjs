// Mutation testing рушія (T57). Запускається лише в nightly (`pnpm mutation`), не в `pnpm verify`.
// Поріг `break` не знижувати: якщо score впав — дописати тести.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // pnpm не робить плагін видимим для core, тож підключаємо явно.
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  // Vitest 5 фільтрує тести за `fullTestName` (частини через « > »), а vitest-runner 10.0.0 — через
  // пробіл; без латки `patches/@stryker-mutator__vitest-runner@10.0.0.patch` жоден тест не запускався б.
  vitest: { configFile: 'vitest.config.ts' },
  mutate: ['src/**/*.ts'],
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 80, break: 80 },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
