import { createRng } from '@poker/engine';
import {
  type PokerServer,
  type PokerServerOptions,
  type RandomSource,
  createPokerServer,
} from '@poker/server';

/** Детермінована випадковість сервера: той самий seed — ті самі код кімнати, місця й роздачі. */
function seededRandom(seed: number): RandomSource {
  const rng = createRng(seed);
  let counter = 0;
  return {
    int: (max) => rng.nextInt(max),
    token: () => `e2e-token-${seed}-${String(++counter).padStart(12, '0')}`,
    id: () => `e2e${++counter}`,
  };
}

export interface SeededServer {
  /** Адреса для параметра `?server=` веб-клієнта. */
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Окремий сервер у процесі тесту з фіксованим seed, миттєвими ботами й без паузи після взятки:
 * екрани відтворюються піксель у піксель незалежно від інших тестів і повторів.
 * Ліміт запитів зʼєднання знято: з миттєвими ботами гравець ходить частіше, ніж людина.
 * `overrides` — інші опції сервера для окремого тесту.
 */
export async function startSeededServer(
  seed: number,
  publicUrl: string,
  overrides: PokerServerOptions = {},
): Promise<SeededServer> {
  const server: PokerServer = createPokerServer({
    random: seededRandom(seed),
    publicUrl,
    botDelayMs: 0,
    trickPauseMs: 0,
    connectionLimits: { requests: Number.POSITIVE_INFINITY },
    ...overrides,
  });
  const url = await server.listen({ port: 0, host: '127.0.0.1' });
  return {
    url,
    async close() {
      // Keep-alive зʼєднання браузера інакше тримають HTTP-сервер відкритим. Клієнт
      // перепідключається, поки сервер закривається (`io.close()` чекає на всі зʼєднання),
      // тож рвемо їх, доки закриття не завершиться.
      const http = server.app.server;
      const closing = server.close();
      http.closeAllConnections();
      const timer = setInterval(() => http.closeAllConnections(), 50);
      try {
        await closing;
      } finally {
        clearInterval(timer);
      }
    },
  };
}
