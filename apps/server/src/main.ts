import { createPokerServer } from './server.js';

// Точка входу: PORT, HOST і PUBLIC_URL (адреса веб-клієнта для посилань) — зі змінних оточення.
const server = createPokerServer({ publicUrl: process.env.PUBLIC_URL ?? '', logger: true });
await server.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
});
