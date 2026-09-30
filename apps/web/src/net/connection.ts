import {
  type ClientEvent,
  type ClientMessageInput,
  type ClientResponses,
  type ClientToServerEvents,
  type ErrorCode,
  PROTOCOL_VERSION,
  type RoomState,
  type ServerToClientEvents,
  type WirePlayerView,
  serverMessageSchemas,
} from '@poker/protocol';
import { type Socket, io } from 'socket.io-client';

/** Помилка запиту: від сервера або мережева (сервер не відповів). */
export interface ClientError {
  readonly code: ErrorCode | 'network';
  readonly message: string;
}

export type ClientResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ClientError };

/** Подія сервера: стан кімнати або погляд гравця на гру. */
export type ServerUpdate =
  | { readonly type: 'room'; readonly room: RoomState }
  | {
      readonly type: 'view';
      readonly view: WirePlayerView;
    };

/** Зʼєднання з сервером; у тестах його підмінюють. */
export interface Connection {
  request<E extends ClientEvent>(
    event: E,
    payload: ClientMessageInput<E>,
  ): Promise<ClientResult<ClientResponses[E]>>;
  subscribe(listener: (update: ServerUpdate) => void): () => void;
  close(): void;
}

/** Скільки чекати відповіді сервера, мс. */
const REQUEST_TIMEOUT_MS = 10_000;

const NETWORK_ERROR: ClientError = {
  code: 'network',
  message: 'Немає звʼязку з сервером. Спробуйте ще раз.',
};

/** Зʼєднання Socket.IO; `url` — адреса сервера (за замовчуванням той самий хост). */
export function createSocketConnection(url?: string): Connection {
  const options = { auth: { protocolVersion: PROTOCOL_VERSION } };
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
    url === undefined ? io(options) : io(url, options);
  const listeners = new Set<(update: ServerUpdate) => void>();
  const notify = (update: ServerUpdate) => {
    for (const listener of listeners) listener(update);
  };

  // Вхідні повідомлення перевіряються схемами протоколу: зіпсоване не потрапляє в інтерфейс.
  socket.on('room:state', (payload) => {
    const parsed = serverMessageSchemas['room:state'].safeParse(payload);
    if (parsed.success) notify({ type: 'room', room: parsed.data });
    else console.error('Некоректний room:state', parsed.error);
  });
  socket.on('game:view', (payload) => {
    const parsed = serverMessageSchemas['game:view'].safeParse(payload);
    if (parsed.success) notify({ type: 'view', view: parsed.data });
    else console.error('Некоректний game:view', parsed.error);
  });

  return {
    request(event, payload) {
      return new Promise((resolve) => {
        // Типи Socket.IO не виводять перевантаження для узагальненої події.
        const timed = socket.timeout(REQUEST_TIMEOUT_MS) as unknown as {
          emit(
            event: string,
            payload: unknown,
            ack: (error: Error | null, result: unknown) => void,
          ): void;
        };
        timed.emit(event, payload, (error, result) => {
          resolve(error ? { ok: false, error: NETWORK_ERROR } : (result as never));
        });
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket.close();
    },
  };
}
