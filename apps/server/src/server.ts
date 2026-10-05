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
  BUG_REPORTS_PER_HOUR,
  BUG_REPORTS_PER_IP_PER_HOUR,
  type BugReporter,
  buildBugReport,
} from './bugReport.js';
import type { RandomSource } from './random.js';
import { type QueuedBugReport, RoomManager, fail } from './rooms.js';
import type { RoomStore } from './store.js';
import { VoiceRooms } from './voice.js';

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
  /**
   * Глобальні ліміти звітів про баги за годину: на весь сервер і на IP-адресу.
   * Кожен звіт — issue з `agent:ready P0`, тобто запуск платного агента.
   */
  bugReportLimits?: { perHour?: number; perIpPerHour?: number };
  /**
   * Сервер за проксі (Render): IP клієнта — останній запис `X-Forwarded-For`,
   * який дописав сам проксі (попередні клієнт може підробити).
   */
  trustProxy?: boolean;
  /** Годинник для лімітів звітів (у тестах — керований). */
  now?: () => number;
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

  /** Голосовий чат (T63): хто в голосі кожної кімнати. */
  const voice = new VoiceRooms<PokerSocket>();

  /** Виводить зʼєднання з голосу й повідомляє інших учасників. */
  function leaveVoice(socket: PokerSocket): void {
    const session = socket.data.session;
    if (session === null || !voice.leave(session.code, session.playerId, socket)) return;
    for (const [, other] of voice.others(session.code, session.playerId)) {
      other.emit('voice:left', { playerId: session.playerId });
    }
  }

  function joinVoice(
    socket: PokerSocket,
    session: NonNullable<SocketData['session']>,
  ): Result<ClientResponses['voice:join']> {
    const { peers, replaced } = voice.join(session.code, session.playerId, socket);
    // Інша вкладка того самого гравця: стара втрачає голос, інші перепідключаються до нової.
    replaced?.emit('voice:left', { playerId: session.playerId });
    for (const [, other] of voice.others(session.code, session.playerId)) {
      other.emit('voice:joined', { playerId: session.playerId });
    }
    return { ok: true, data: { peers } };
  }

  function voiceSignal(
    socket: PokerSocket,
    session: NonNullable<SocketData['session']>,
    { to, signal }: ClientMessage<'voice:signal'>,
  ): Result<null> {
    if (to === session.playerId) return fail('badRequest', 'Сигнал самому собі');
    const target = voice.socketOf(session.code, to);
    if (voice.socketOf(session.code, session.playerId) !== socket || target === null) {
      return fail('notInRoom', 'Гравця немає в голосовому чаті');
    }
    target.emit('voice:signal', { from: session.playerId, signal });
    return { ok: true, data: null };
  }

  function unbind(socket: PokerSocket): void {
    const session = socket.data.session;
    if (session === null) return;
    leaveVoice(socket);
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

  /** Звіти, що зараз публікуються: щоб не створити той самий issue двічі. */
  const publishing = new Set<string>();

  /**
   * Публікує відкладений звіт і лише потім прибирає його з черги кімнати: збій GitHub
   * чи рестарт не губить звіт — його опублікує наступне очищення.
   */
  function publish(queued: QueuedBugReport): Promise<void> {
    const reporter = options.bugReporter;
    if (reporter === undefined || publishing.has(queued.id)) return Promise.resolve();
    publishing.add(queued.id);
    return reporter
      .report(buildBugReport(queued.context, queued.description, queued.final))
      .then(() => rooms.bugReportPublished(queued.context.code, queued.id))
      .catch((error: unknown) => app.log.error({ err: error }, 'Не вдалося створити звіт про баг'))
      .finally(() => publishing.delete(queued.id));
  }

  // Звіти з гри, що йде, публікуються після її кінця: replay містить seed, з якого видно
  // чужі карти, а issue — у публічному репозиторії.
  rooms.subscribe((code) => {
    for (const queued of rooms.finishedBugReports(code)) void publish(queued);
  });

  const now = options.now ?? (() => Date.now());
  const perHour = options.bugReportLimits?.perHour ?? BUG_REPORTS_PER_HOUR;
  const perIpPerHour = options.bugReportLimits?.perIpPerHour ?? BUG_REPORTS_PER_IP_PER_HOUR;
  /** Час прийнятих звітів за останню годину: усіх і за IP-адресою. */
  const recentReports: number[] = [];
  const recentReportsByIp = new Map<string, number[]>();
  const HOUR_MS = 60 * 60 * 1000;

  function clientIp(socket: PokerSocket): string {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const header = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const last = header?.split(',').at(-1)?.trim();
    return options.trustProxy === true && last ? last : socket.handshake.address;
  }

  /** Звіти, прийняті за останню годину (старші викидаються з `times`). */
  function lastHour(times: number[]): number[] {
    const since = now() - HOUR_MS;
    while (times.length > 0 && (times[0] as number) <= since) times.shift();
    return times;
  }

  async function reportBug(
    socket: PokerSocket,
    session: NonNullable<SocketData['session']>,
    description: string,
  ): Promise<Result<ClientResponses['game:reportBug']>> {
    const reporter = options.bugReporter;
    if (reporter === undefined) {
      return fail('unavailable', 'Звіти про баги на цьому сервері не налаштовані');
    }
    const ip = clientIp(socket);
    const byIp = lastHour(recentReportsByIp.get(ip) ?? []);
    if (lastHour(recentReports).length >= perHour || byIp.length >= perIpPerHour) {
      return fail('rateLimited', 'Забагато звітів про баги, спробуйте за годину');
    }
    const result = rooms.reportBug(session.code, session.playerId, description);
    if (!result.ok) return result;
    recentReports.push(now());
    recentReportsByIp.set(ip, [...byIp, now()]);
    const { context, queued } = result.data;
    if (queued) return { ok: true, data: { url: null } };
    try {
      return { ok: true, data: await reporter.report(buildBugReport(context, description)) };
    } catch (error) {
      rooms.unreportBug(session.code, session.playerId);
      app.log.error({ err: error }, 'Не вдалося створити звіт про баг');
      return fail('unavailable', 'Не вдалося надіслати звіт, спробуйте пізніше');
    }
  }

  /** Обробник, якому потрібні і сесія, і саме зʼєднання (голос привʼязаний до вкладки). */
  function withSocket<E extends ClientEvent>(
    handler: (
      socket: PokerSocket,
      session: NonNullable<SocketData['session']>,
      payload: ClientMessage<E>,
    ) => Result<ClientResponses[E]> | Promise<Result<ClientResponses[E]>>,
  ): Handler<E> {
    return (socket, payload) => {
      const session = socket.data.session;
      if (session === null) return fail('notInRoom', 'Спершу створіть кімнату або увійдіть у неї');
      return handler(socket, session, payload);
    };
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
    'room:options': withSession(({ code, playerId }, options) =>
      rooms.options(code, playerId, options),
    ),
    'room:start': withSession(({ code, playerId }) => rooms.start(code, playerId)),
    'room:replaceWithBot': withSession(({ code, playerId }, { seat }) =>
      rooms.replaceWithBot(code, playerId, seat),
    ),
    'game:bid': withSession(({ code, playerId }, { bid }) => rooms.bid(code, playerId, bid)),
    'game:play': withSession(({ code, playerId }, { card, call }) =>
      rooms.play(code, playerId, card, call),
    ),
    'game:reportBug': withSocket((socket, session, { description }) =>
      reportBug(socket, session, description),
    ),
    'voice:join': withSocket(joinVoice),
    'voice:leave': withSocket((socket) => {
      leaveVoice(socket);
      return { ok: true, data: null };
    }),
    'voice:signal': withSocket(voiceSignal),
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
  /** Очищення сховища; звіти із завершених і покинутих ігор публікуються перед ним. */
  function cleanup(): Promise<void> {
    const reports = options.bugReporter === undefined ? [] : rooms.unpublishedBugReports();
    return Promise.resolve(reports)
      .then((queued) => Promise.all(queued.map(publish)))
      .catch((error: unknown) => app.log.error({ err: error }, 'Не вдалося опублікувати звіти'))
      .then(() => rooms.cleanup())
      .then(
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
        void cleanup();
        cleanupTimer = setInterval(
          () => void cleanup(),
          options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS,
        );
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
