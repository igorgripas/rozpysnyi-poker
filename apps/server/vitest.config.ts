import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  // Тести запускаються в SSR-оточенні: там умови резолву задаються окремо.
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Справжній Postgres для тестів сховища (T54).
    globalSetup: ['test/postgres-setup.ts'],
  },
});
