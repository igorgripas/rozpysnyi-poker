import { createPokerServer } from './server.js';
import { FileRoomStore } from './store.js';

// Точка входу: PORT, HOST і PUBLIC_URL (адреса веб-клієнта для посилань) — зі змінних оточення.
// DATA_DIR — каталог для знімків кімнат: з ним ігри переживають рестарт сервера.
const dataDir = process.env.DATA_DIR;
const server = createPokerServer({
  publicUrl: process.env.PUBLIC_URL ?? '',
  logger: true,
  ...(dataDir !== undefined && dataDir !== '' && { store: new FileRoomStore(dataDir) }),
});
await server.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
});
