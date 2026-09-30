import {
  type ClientEvent,
  type ClientMessage,
  type ClientResponses,
  type ClientToServerEvents,
  PROTOCOL_VERSION,
  type Result,
  type ServerMessage,
  type ServerToClientEvents,
  type Session,
  handshakeSchema,
  parseClientMessage,
} from '@poker/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import type { RandomSource } from './random.js';
import { RoomManager, fail } from './rooms.js';

export interface PokerServerOptions {
  random?: RandomSource;
  /** Базова адреса веб-клієнта для посилань-запрошень. */
  publicUrl?: string;
  /** Дозволені джерела CORS для Socket.IO (за замовчуванням — будь-які). */
  corsOrigin?: string | string[];
  logger?: boolean;
  /** Затримка перед ходом бота, мс. */
  botDelayMs?: number;
}

/** Сесія, привʼязана до зʼєднання після create/join/resume. */
interface SocketData {
  session: Pick<Session, 'code' | 'playerId'> | null;
}

type PokerSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type PokerIo = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

type Handler<E extends ClientEvent> = (
  socket: PokerSocket,
  payload: ClientMessage<E>,
) => Result<ClientResponses[E]>;

export interface PokerServer {
  readonly app: FastifyInstance;
  readonly io: PokerIo;
  readonly rooms: RoomManager;
  /** Запускає сервер і повертає його адресу. */
  listen(options: { port: number; host?: string }): Promise<string>;
  close(): Promise<void>;
}

/** Авторитетний сервер: Fastify (HTTP) + Socket.IO (кімнати й гра). */
export function createPokerServer(options: PokerServerOptions = {}): PokerServer {
  const app = Fastify({ logger: options.logger ?? false });
  const rooms = new RoomManager({
    ...(options.random && { random: options.random }),
    ...(options.publicUrl !== undefined && { publicUrl: options.publicUrl }),
    ...(options.botDelayMs !== undefined && { botDelayMs: options.botDelayMs }),
  });
  const io: PokerIo = new Server(app.server, {
    cors: { origin: options.corsOrigin ?? true },
  });

  app.get('/health', () => ({ ok: true, protocolVersion: PROTOCOL_VERSION }));

  /** Зʼєднання кожного гравця: `code/playerId` → сокети. */
  const connections = new Map<string, Set<PokerSocket>>();
  const key = (code: string, playerId: string) => `${code}/${playerId}`;

  function socketsIn(code: string): PokerSocket[] {
    const result: PokerSocket[] = [];
    for (const [k, sockets] of connections) {
      if (k.startsWith(`${code}/`)) result.push(...sockets);
    }
    return result;
  }

  /** Надсилає гравцеві стан кімнати й, якщо гра йде, його `viewFor`. */
  function sendState(socket: PokerSocket): void {
    const session = socket.data.session;
    if (session === null) return;
    socket.emit('room:state', rooms.roomState(session.code, session.playerId));
    const view = rooms.view(session.code, session.playerId);
    if (view !== null) socket.emit('game:view', view as ServerMessage<'game:view'>);
  }

  rooms.subscribe((code) => {
    for (const socket of socketsIn(code)) sendState(socket);
  });

  function unbind(socket: PokerSocket): void {
    const session = socket.data.session;
    if (session === null) return;
    socket.data.session = null;
    const k = key(session.code, session.playerId);
    const sockets = connections.get(k);
    sockets?.delete(socket);
    if (sockets !== undefined && sockets.size === 0) {
      connections.delete(k);
      rooms.setConnected(session.code, session.playerId, false);
    }
  }

  function bind(socket: PokerSocket, session: Session): void {
    unbind(socket);
    socket.data.session = { code: session.code, playerId: session.playerId };
    const k = key(session.code, session.playerId);
    const sockets = connections.get(k) ?? new Set();
    connections.set(k, sockets.add(socket));
    rooms.setConnected(session.code, session.playerId, true);
    // Якщо гравець уже був підключений, стан не змінився — надсилаємо його новому зʼєднанню.
    sendState(socket);
  }

  /** Обгортка обробника: валідує payload, вимагає сесію (для подій, крім входу). */
  function withSession<E extends ClientEvent>(
    handler: (
      session: NonNullable<SocketData['session']>,
      payload: ClientMessage<E>,
    ) => Result<ClientResponses[E]>,
  ): Handler<E> {
    return (socket, payload) => {
      const session = socket.data.session;
      if (session === null) return fail('notInRoom', 'Спершу створіть кімнату або увійдіть у неї');
      return handler(session, payload);
    };
  }

  function entering<E extends 'room:create' | 'room:join' | 'room:resume'>(
    enter: (payload: ClientMessage<E>) => Result<Session>,
  ): Handler<E> {
    return (socket, payload) => {
      const result = enter(payload);
      if (result.ok) bind(socket, result.data);
      return result;
    };
  }

  const handlers: { [E in ClientEvent]: Handler<E> } = {
    'room:create': entering(({ name }) => rooms.create(name)),
    'room:join': entering(({ code, name }) => rooms.join(code, name)),
    'room:resume': entering(({ code, token }) => rooms.resume(code, token)),
    'room:addBot': withSession(({ code, playerId }) => rooms.addBot(code, playerId)),
    'room:removeBot': withSession(({ code, playerId }, { seat }) =>
      rooms.removeBot(code, playerId, seat),
    ),
    'room:shuffle': withSession(({ code, playerId }) => rooms.shuffle(code, playerId)),
    'room:start': withSession(({ code, playerId }) => rooms.start(code, playerId)),
    'game:bid': withSession(({ code, playerId }, { bid }) => rooms.bid(code, playerId, bid)),
    'game:play': withSession(({ code, playerId }, { card, call }) =>
      rooms.play(code, playerId, card, call),
    ),
  };

  io.use((socket, next) => {
    if (handshakeSchema.safeParse(socket.handshake.auth).success) return next();
    const error = new Error(`Потрібна версія протоколу ${PROTOCOL_VERSION}`) as Error & {
      data?: unknown;
    };
    error.data = { code: 'versionMismatch', protocolVersion: PROTOCOL_VERSION };
    next(error);
  });

  io.on('connection', (socket) => {
    socket.data.session = null;
    for (const event of Object.keys(handlers) as ClientEvent[]) {
      socket.on(event, (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return;
        const parsed = parseClientMessage(event, payload);
        const handler = handlers[event] as Handler<ClientEvent>;
        (ack as (result: unknown) => void)(parsed.ok ? handler(socket, parsed.data) : parsed);
      });
    }
    socket.on('disconnect', () => unbind(socket));
  });

  return {
    app,
    io,
    rooms,
    async listen({ port, host }) {
      const address = await app.listen({ port, ...(host !== undefined && { host }) });
      return address;
    },
    async close() {
      rooms.close();
      await io.close();
      await app.close();
    },
  };
}
