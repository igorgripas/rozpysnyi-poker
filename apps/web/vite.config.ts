import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// Адреса сервера для dev-проксі Socket.IO (див. apps/server).
const serverUrl = process.env.POKER_SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Пакети монорепо підключаються з вихідних TS-файлів (умова `source`).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    proxy: { '/socket.io': { target: serverUrl, ws: true } },
  },
});
