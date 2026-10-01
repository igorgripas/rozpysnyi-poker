import { PostgresRoomStore } from './postgres.js';
import { createPokerServer } from './server.js';

// Точка входу: PORT, HOST і PUBLIC_URL (адреса веб-клієнта для посилань) — зі змінних оточення.
// DATABASE_URL — Postgres для кімнат: з ним ігри переживають рестарт сервера.
const databaseUrl = process.env.DATABASE_URL;
const server = createPokerServer({
  publicUrl: process.env.PUBLIC_URL ?? '',
  logger: true,
  ...(databaseUrl !== undefined &&
    databaseUrl !== '' && {
      store: new PostgresRoomStore({
        connectionString: databaseUrl,
        onError: (error) => console.error('Postgres: обрив зʼєднання', error),
      }),
    }),
});
await server.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
});
