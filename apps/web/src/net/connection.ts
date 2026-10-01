import {
  type ClientEvent,
  type ClientMessageInput,
  type ClientResponses,
  type ClientToServerEvents,
  type ErrorCode,
  PROTOCOL_VERSION,
  type RoomState,
  type ServerMessage,
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

/**
 * Стан зʼєднання: `connecting` — перше підключення, `online` — є звʼязок,
 * `offline` — звʼязку немає (Socket.IO перепідключається сам), `waking` — сервер
 * попередив про перезапуск і ще не повернувся, `outdated` — сервер відхилив версію
 * протоколу, потрібно оновити сторінку.
 */
export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'waking' | 'outdated';

/** Подія голосового чату від сервера (T63). */
export type VoiceMessage =
  | ({ readonly type: 'joined' } & ServerMessage<'voice:joined'>)
  | ({ readonly type: 'left' } & ServerMessage<'voice:left'>)
  | ({ readonly type: 'signal' } & ServerMessage<'voice:signal'>);

/** Подія зʼєднання: стан кімнати, погляд гравця на гру, голос або зміна стану звʼязку. */
export type ServerUpdate =
  | { readonly type: 'room'; readonly room: RoomState }
  | { readonly type: 'view'; readonly view: WirePlayerView }
  | { readonly type: 'voice'; readonly message: VoiceMessage }
  | { readonly type: 'status'; readonly status: ConnectionStatus };

/** Зʼєднання з сервером; у тестах його підмінюють. */
export interface Connection {
  request<E extends ClientEvent>(
    event: E,
    payload: ClientMessageInput<E>,
  ): Promise<ClientResult<ClientResponses[E]>>;
  subscribe(listener: (update: ServerUpdate) => void): () => void;
  close(): void;
}

/** Перша затримка перед повторним підключенням, мс. */
const RECONNECT_DELAY_MS = 1000;
/** Найбільша затримка між спробами перепідключення, мс. */
const RECONNECT_DELAY_MAX_MS = 5000;

/** Скільки чекати відповіді сервера, мс. */
const REQUEST_TIMEOUT_MS = 10_000;

export const NETWORK_ERROR: ClientError = {
  code: 'network',
  message: 'Немає звʼязку з сервером. Спробуйте ще раз.',
};

/** Зʼєднання Socket.IO; `url` — адреса сервера (за замовчуванням той самий хост). */
export function createSocketConnection(url?: string): Connection {
  // Перепідключення без ліміту спроб: сервер може прокидатися або передеплоюватися хвилину.
  const options = {
    auth: { protocolVersion: PROTOCOL_VERSION },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: RECONNECT_DELAY_MS,
    reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
  };
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

  socket.on('voice:joined', (payload) => {
    const parsed = serverMessageSchemas['voice:joined'].safeParse(payload);
    if (parsed.success) notify({ type: 'voice', message: { type: 'joined', ...parsed.data } });
  });
  socket.on('voice:left', (payload) => {
    const parsed = serverMessageSchemas['voice:left'].safeParse(payload);
    if (parsed.success) notify({ type: 'voice', message: { type: 'left', ...parsed.data } });
  });
  socket.on('voice:signal', (payload) => {
    const parsed = serverMessageSchemas['voice:signal'].safeParse(payload);
    if (parsed.success) notify({ type: 'voice', message: { type: 'signal', ...parsed.data } });
  });

  // Стан звʼязку. Після обриву Socket.IO перепідключається сам, крім розриву сервером.
  // Після `server:restarting` обрив очікуваний: до відновлення сервер «прокидається».
  let waking = false;
  // Відмову в підключенні від сервера (middleware) Socket.IO не повторює: повторюємо самі.
  let retryDelay = RECONNECT_DELAY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const lost = (): ConnectionStatus => (waking ? 'waking' : 'offline');
  socket.on('server:restarting', () => {
    waking = true;
    notify({ type: 'status', status: 'waking' });
  });
  socket.on('connect', () => {
    waking = false;
    retryDelay = RECONNECT_DELAY_MS;
    notify({ type: 'status', status: 'online' });
  });
  socket.on('disconnect', (reason) => {
    notify({ type: 'status', status: lost() });
    if (reason === 'io server disconnect') socket.connect();
  });
  socket.on('connect_error', (error) => {
    const data = (error as Error & { data?: { code?: unknown } }).data;
    const outdated = data?.code === 'versionMismatch';
    if (data?.code === 'unavailable') waking = true;
    notify({ type: 'status', status: outdated ? 'outdated' : lost() });
    if (!outdated && !socket.active && retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        socket.connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RECONNECT_DELAY_MAX_MS);
    }
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
      if (retryTimer !== null) clearTimeout(retryTimer);
      socket.close();
    },
  };
}
