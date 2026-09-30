import { createRng } from '@poker/engine';
import { type PokerServer, type RandomSource, createPokerServer } from '@poker/server';

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
 */
export async function startSeededServer(seed: number, publicUrl: string): Promise<SeededServer> {
  const server: PokerServer = createPokerServer({
    random: seededRandom(seed),
    publicUrl,
    botDelayMs: 0,
    trickPauseMs: 0,
  });
  const url = await server.listen({ port: 0, host: '127.0.0.1' });
  return {
    url,
    async close() {
      // Keep-alive зʼєднання браузера інакше тримають HTTP-сервер відкритим.
      const closing = server.close();
      server.app.server.closeAllConnections();
      await closing;
    },
  };
}
