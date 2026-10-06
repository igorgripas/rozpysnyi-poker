import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { type Plugin, defaultClientConditions, defineConfig } from 'vite';
import { stampServiceWorker } from './src/swVersion.ts';

// Адреса сервера для dev-проксі Socket.IO (див. apps/server).
const serverUrl = process.env.POKER_SERVER_URL ?? 'http://localhost:3000';

/**
 * Підставляє в зібраний sw.js версію — хеш вмісту збірки: з кожним деплоєм sw.js змінюється,
 * і відкриті вкладки бачать «Доступна нова версія».
 */
function serviceWorkerVersion(): Plugin {
  return {
    name: 'poker:sw-version',
    apply: 'build',
    writeBundle(options, bundle) {
      const hash = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name);
        if (item?.type === 'chunk') hash.update(item.code);
        else if (item !== undefined) hash.update(item.source);
      }
      const file = join(options.dir ?? 'dist', 'sw.js');
      const version = hash.digest('hex').slice(0, 12);
      writeFileSync(file, stampServiceWorker(readFileSync(file, 'utf8'), version));
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerVersion()],
  // Пакети монорепо підключаються з вихідних TS-файлів (умова `source`).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    proxy: { '/socket.io': { target: serverUrl, ws: true } },
  },
});
