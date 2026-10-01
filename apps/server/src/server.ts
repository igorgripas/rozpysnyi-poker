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
import {
  BUG_REPORTS_PER_PLAYER,
  type BugContext,
  type BugReporter,
  buildBugReport,
} from './bugReport.js';
import type { RandomSource } from './random.js';
import { RoomManager, fail } from './rooms.js';
import type { RoomStore } from './store.js';

export interface PokerServerOptions {
  random?: RandomSource;
  /** Базова адреса веб-клієнта для посилань-запрошень. */
  publicUrl?: string;
  /** Дозволені джерела CORS для Socket.IO (за замовчуванням — будь-які). */
  corsOrigin?: string | string[];
  logger?: boolean;
  /** Затримка перед ходом бота, мс. */
  botDelayMs?: number;
  /** Пауза після завершення взятки перед ходом бота, мс. */
  trickPauseMs?: number;
  /** Сховище кімнат: із ним сервер переживає рестарт посеред гри. */
  store?: RoomStore;
  /** Як часто чистити сховище від старих ігор, мс (перше очищення — під час старту). */
  cleanupIntervalMs?: number;
  /** Куди надсилати звіти гравців про баги; без нього звіти недоступні. */
  bugReporter?: BugReporter;
}

/** Очищення сховища за замовчуванням — раз на 6 годин. */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Сесія, привʼязана до зʼєднання після create/join/resume. */
interface SocketData {
  session: Pick<Session, 'code' | 'playerId'> | null;
}

type PokerSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type PokerIo = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

type Handler<E extends ClientEvent> = (
  socket: PokerSocket,
  payload: ClientMessage<E>,
) => Result<ClientResponses[E]> | Promise<Result<ClientResponses[E]>>;

export interface PokerServer {
  readonly app: FastifyInstance;
  readonly io: PokerIo;
  readonly rooms: RoomManager;
  /** Запускає сервер і повертає його адресу. */
  listen(options: { port: number; host?: string }): Promise<string>;
  /**
   * Плавна зупинка (SIGTERM): нові дії не приймаються, прийняті дописуються в базу,
   * клієнти отримують `server:restarting`, потім зʼєднання закриваються.
   */
  close(): Promise<void>;
}

/** Авторитетний сервер: Fastify (HTTP) + Socket.IO (кімнати й гра). */
export function createPokerServer(options: PokerServerOptions = {}): PokerServer {
  const app = Fastify({ logger: options.logger ?? false });
  const rooms = new RoomManager({
    ...(options.random && { random: options.random }),
    ...(options.publicUrl !== undefined && { publicUrl: options.publicUrl }),
    ...(options.botDelayMs !== undefined && { botDelayMs: options.botDelayMs }),
    ...(options.trickPauseMs !== undefined && { trickPauseMs: options.trickPauseMs }),
    ...(options.store && { store: options.store }),
    onStoreError: (error) => app.log.error({ err: error }, 'Не вдалося зберегти кімнату'),
  });
  const io: PokerIo = new Server(app.server, {
    cors: { origin: options.corsOrigin ?? true },
  });

  app.get('/health', () => ({ ok: true, protocolVersion: PROTOCOL_VERSION }));

  /** Плавна зупинка, якщо вже почалася: нові дії й підключення відхиляються. */
  let closing: Promise<void> | null = null;
  /** Запити, на які ще не відповіли: зупинка чекає їх. */
  const inflight = new Set<Promise<void>>();

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

  // Стан розсилається після запису зміни в базу: ніхто не бачить того, що може загубитися.
  rooms.subscribe((code) => {
    void rooms.persisted(code).then(() => {
      for (const socket of socketsIn(code)) sendState(socket);
    });
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
    enter: (payload: ClientMessage<E>) => Result<Session> | Promise<Result<Session>>,
  ): Handler<E> {
    return async (socket, payload) => {
      const result = await enter(payload);
      if (result.ok) bind(socket, result.data);
      return result;
    };
  }

  /** Скільки звітів про баги надіслав кожен гравець: `code/playerId` → кількість. */
  const bugReports = new Map<string, number>();
  /**
   * Звіти з ігор, що ще йдуть: код кімнати → звіти. Replay містить seed, з якого видно
   * чужі карти, тож issue (у публічному репозиторії) створюється лише після кінця гри.
   */
  const pendingBugReports = new Map<string, { context: BugContext; description: string }[]>();

  rooms.subscribe((code) => {
    const pending = pendingBugReports.get(code);
    const game = rooms.get(code)?.game;
    if (pending === undefined || game?.status !== 'finished') return;
    pendingBugReports.delete(code);
    for (const { context, description } of pending) {
      options.bugReporter
        ?.report(buildBugReport(context, description, game))
        .catch((error: unknown) =>
          app.log.error({ err: error }, 'Не вдалося створити звіт про баг'),
        );
    }
  });

  async function reportBug(
    session: NonNullable<SocketData['session']>,
    description: string,
  ): Promise<Result<ClientResponses['game:reportBug']>> {
    const context = rooms.bugContext(session.code, session.playerId);
    if (!context.ok) return context;
    const reporter = options.bugReporter;
    if (reporter === undefined) {
      return fail('unavailable', 'Звіти про баги на цьому сервері не налаштовані');
    }
    const k = key(session.code, session.playerId);
    const sent = bugReports.get(k) ?? 0;
    if (sent >= BUG_REPORTS_PER_PLAYER) {
      return fail('rateLimited', 'Ви вже надіслали кілька звітів з цієї гри, дякуємо!');
    }
    bugReports.set(k, sent + 1);
    if (context.data.game.status !== 'finished') {
      const pending = pendingBugReports.get(session.code) ?? [];
      pendingBugReports.set(session.code, [...pending, { context: context.data, description }]);
      return { ok: true, data: { url: null } };
    }
    try {
      return { ok: true, data: await reporter.report(buildBugReport(context.data, description)) };
    } catch (error) {
      bugReports.set(k, sent);
      app.log.error({ err: error }, 'Не вдалося створити звіт про баг');
      return fail('unavailable', 'Не вдалося надіслати звіт, спробуйте пізніше');
    }
  }

  const handlers: { [E in ClientEvent]: Handler<E> } = {
    'room:create': entering(({ name }) => rooms.create(name)),
    // Після рестарту кімнати ще немає в памʼяті: підвантажуємо її з бази за кодом.
    'room:join': entering(async ({ code, name }) => {
      await rooms.load(code.toUpperCase());
      return rooms.join(code, name);
    }),
    'room:resume': entering(async ({ code, token }) => {
      await rooms.load(code.toUpperCase());
      return rooms.resume(code, token);
    }),
    'room:addBot': withSession(({ code, playerId }) => rooms.addBot(code, playerId)),
    'room:removeBot': withSession(({ code, playerId }, { seat }) =>
      rooms.removeBot(code, playerId, seat),
    ),
    'room:shuffle': withSession(({ code, playerId }) => rooms.shuffle(code, playerId)),
    'room:settings': withSession(({ code, playerId }, { turnTimerSec }) =>
      rooms.settings(code, playerId, turnTimerSec),
    ),
    'room:start': withSession(({ code, playerId }) => rooms.start(code, playerId)),
    'room:replaceWithBot': withSession(({ code, playerId }, { seat }) =>
      rooms.replaceWithBot(code, playerId, seat),
    ),
    'game:bid': withSession(({ code, playerId }, { bid }) => rooms.bid(code, playerId, bid)),
    'game:play': withSession(({ code, playerId }, { card, call }) =>
      rooms.play(code, playerId, card, call),
    ),
    'game:reportBug': (socket, { description }) => {
      const session = socket.data.session;
      if (session === null) return fail('notInRoom', 'Спершу створіть кімнату або увійдіть у неї');
      return reportBug(session, description);
    },
  };

  io.use((_socket, next) => {
    // Сервер зупиняється: клієнт має дочекатися нового процесу, а не цього.
    if (closing === null) return next();
    const error = new Error('Сервер перезапускається') as Error & { data?: unknown };
    error.data = { code: 'unavailable' };
    next(error);
  });

  io.use((socket, next) => {
    if (handshakeSchema.safeParse(socket.handshake.auth).success) return next();
    const error = new Error(`Потрібна версія протоколу ${PROTOCOL_VERSION}`) as Error & {
      data?: unknown;
    };
    error.data = { code: 'versionMismatch', protocolVersion: PROTOCOL_VERSION };
    next(error);
  });

  /**
   * Виконує подію й відповідає лише після запису змін у базу: підтверджена дія
   * переживе рестарт. Збій бази — помилка `unavailable`, клієнт може повторити.
   */
  async function respond(socket: PokerSocket, event: ClientEvent, payload: unknown) {
    if (closing !== null) {
      return fail('unavailable', 'Сервер перезапускається, зачекайте хвилину');
    }
    const parsed = parseClientMessage(event, payload);
    if (!parsed.ok) return parsed;
    const handler = handlers[event] as Handler<ClientEvent>;
    try {
      const result = await handler(socket, parsed.data);
      const code = socket.data.session?.code;
      if (code !== undefined && !(await rooms.persisted(code)) && result.ok) {
        return fail('unavailable', 'Не вдалося зберегти зміни, спробуйте ще раз');
      }
      return result;
    } catch (error) {
      app.log.error({ err: error }, 'Сховище недоступне');
      return fail('unavailable', 'Сервер тимчасово недоступний, спробуйте ще раз');
    }
  }

  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async function shutdown(): Promise<void> {
    if (cleanupTimer !== null) clearInterval(cleanupTimer);
    rooms.close();
    // Прийняті дії записуються й підтверджуються до того, як закриються зʼєднання.
    while (inflight.size > 0) await Promise.all(inflight);
    await rooms.flush();
    io.emit('server:restarting', {});
    // `io.close()` рве транспорт, не дочекавшись відправки: спершу чемно відключаємо
    // клієнтів і даємо пакетам (відповіді, попередження) піти в мережу.
    io.disconnectSockets(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await io.close();
    // Відключення гравців теж змінює кімнати: дописуємо все в базу.
    await rooms.flush();
    await app.close();
  }
  function cleanup(): void {
    rooms.cleanup().then(
      (removed) => {
        if (removed > 0) app.log.info(`Видалено старих кімнат: ${removed}`);
      },
      (error: unknown) => app.log.error({ err: error }, 'Не вдалося очистити сховище'),
    );
  }

  io.on('connection', (socket) => {
    socket.data.session = null;
    for (const event of Object.keys(handlers) as ClientEvent[]) {
      socket.on(event, (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return;
        const answered = respond(socket, event, payload).then(ack as (result: unknown) => void);
        inflight.add(answered);
        void answered.finally(() => inflight.delete(answered));
      });
    }
    socket.on('disconnect', () => unbind(socket));
  });

  return {
    app,
    io,
    rooms,
    async listen({ port, host }) {
      // Схема бази готова до першого запиту; холодний старт Neon переживають повторні спроби.
      await rooms.init();
      const address = await app.listen({ port, ...(host !== undefined && { host }) });
      if (options.store !== undefined) {
        cleanup();
        cleanupTimer = setInterval(cleanup, options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS);
        cleanupTimer.unref();
      }
      return address;
    },
    close() {
      closing ??= shutdown();
      return closing;
    },
  };
}
