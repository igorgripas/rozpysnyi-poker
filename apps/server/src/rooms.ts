import { type Bot, createHeuristicBot } from '@poker/bots';
import {
  type Action,
  type Card,
  DEFAULT_OPTIONS,
  type GameLog,
  type GameOptions,
  type GameState,
  IllegalActionError,
  type JokerCall,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type PlayerView,
  UnsupportedLogVersionError,
  apply,
  createGame,
  gameLog,
  legalActions,
  replay,
  viewFor,
} from '@poker/engine';
import {
  type ErrorCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Result,
  type RoomState,
  type RoomStatus,
  type Session,
} from '@poker/protocol';
import { BUG_REPORTS_PER_PLAYER, type BugContext } from './bugReport.js';
import { type RandomSource, cryptoRandom } from './random.js';
import {
  type PendingBugReport,
  ROOM_SNAPSHOT_VERSION,
  type RoomSnapshot,
  type RoomStore,
} from './store.js';

/** Учасник кімнати: людина з токеном або бот. */
export interface Member {
  readonly id: string;
  readonly name: string;
  readonly kind: 'human' | 'bot';
  /** Секрет для повернення в кімнату; у ботів його немає, після виходу із завершеної гри — теж. */
  token: string | null;
  connected: boolean;
  /** Гравець вийшов посеред гри (T180): за нього ходить бот, доки він не повернеться. */
  away: boolean;
}

export interface Room {
  readonly code: string;
  hostId: string;
  status: RoomStatus;
  /** Місця в порядку гри (R-9.1): індекс — номер місця в рушії. */
  seats: Member[];
  /** Стан гри; `null`, поки гра не почалася. */
  game: GameState | null;
  /** Таймер ходу, секунди; `null` — вимкнений (R-9.3). */
  turnTimerSec: number | null;
  /** Опції кімнати (§10): хост змінює їх до старту, далі вони зафіксовані в грі (R-10.1). */
  options: GameOptions;
  /** Коли сплине час поточного ходу (мс від епохи Unix) або `null`. */
  turnDeadline: number | null;
  /** Звіти про баги, що чекають кінця гри (T52); зберігаються в знімку кімнати. */
  bugReports: PendingBugReport[];
  /** Скільки звітів надіслав кожен гравець: ідентифікатор → кількість. */
  bugReportsSent: Record<string, number>;
}

/** Звіт про баг, готовий до публікації: контекст на момент звіту й остаточний стан гри. */
export interface QueuedBugReport {
  readonly id: string;
  readonly context: BugContext;
  readonly description: string;
  /** Стан гри для replay-файлу. */
  readonly final: GameState;
}

export interface RoomManagerOptions {
  random?: RandomSource;
  /** Базова адреса веб-клієнта для посилань-запрошень, напр. `https://poker.example`. */
  publicUrl?: string;
  /** Затримка перед ходом бота, мс. */
  botDelayMs?: number;
  /** Пауза після завершення взятки перед наступним ходом бота, мс: щоб люди встигли її роздивитися. */
  trickPauseMs?: number;
  /** Сховище, куди кімнати зберігаються після змін і звідки підвантажуються за кодом. */
  store?: RoomStore;
  /** Помилка запису у сховище (після всіх повторних спроб). */
  onStoreError?: (error: unknown) => void;
  /** Створює бота для місця бота чи гравця, за якого ходить сервер (у тестах — підмінний). */
  createBot?: () => Bot;
  /**
   * Бот кинув виняток або повернув нелегальну дію: замість неї зіграно першу легальну.
   * У контексті — seed і лог гри до цього ходу, щоб відтворити баг.
   */
  onBotError?: (error: unknown, context: BotErrorContext) => void;
  /** Скільки кімнат може бути в памʼяті одночасно. */
  maxRooms?: number;
  /** Через скільки мс без підключених людей і без змін кімната вважається покинутою. */
  idleTtlMs?: number;
  /** Годинник для TTL кімнат (у тестах — керований). */
  now?: () => number;
}

/** Що потрібно, щоб відтворити помилку бота: кімната, seed і лог гри до його ходу. */
export interface BotErrorContext {
  readonly code: string;
  readonly seat: number;
  readonly seed: number;
  readonly log: GameLog;
}

/** Затримка ходу бота за замовчуванням: щоб люди встигали бачити карти. */
export const DEFAULT_BOT_DELAY_MS = 700;

/** Пауза після взятки за замовчуванням: клієнт стільки ж показує, хто її бере. */
export const TRICK_PAUSE_MS = 2000;

/** Ліміт кімнат у памʼяті за замовчуванням. */
export const MAX_ROOMS = 1000;

/** Покинута кімната (без підключених людей і змін) прибирається з памʼяті через 30 хв. */
export const IDLE_ROOM_TTL_MS = 30 * 60 * 1000;

/** Сповіщення про зміну кімнати з кодом `code`. */
export type RoomListener = (code: string) => void;

export function fail(
  code: ErrorCode,
  message: string,
): { ok: false; error: { code: ErrorCode; message: string } } {
  return { ok: false, error: { code, message } };
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

const UINT32 = 2 ** 32;

/** Відкладені звіти з контекстом на момент звіту: стан гри — перші `actions` дій. */
function queuedReports(
  code: string,
  reports: readonly PendingBugReport[],
  final: GameState,
): QueuedBugReport[] {
  return reports.map(({ id, seat, kinds, actions, description }) => ({
    id,
    context: {
      code,
      seat,
      kinds,
      game: replay(final.seed, { ...gameLog(final), actions: final.actions.slice(0, actions) }),
    },
    description,
    final,
  }));
}

/** Чи щойно завершилася взятка: стіл порожній після карти. */
function afterTrick(game: GameState): boolean {
  return game.actions.at(-1)?.type === 'play' && game.hand.trick.length === 0;
}

/** Кімнати в памʼяті: створення, вхід за кодом, повернення за токеном і керування хостом. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly listeners = new Set<RoomListener>();
  private readonly random: RandomSource;
  private readonly publicUrl: string;
  private readonly botDelayMs: number;
  private readonly trickPauseMs: number;
  private readonly store: RoomStore | null;
  /** Заплановані ходи за кодом кімнати: хід бота або хід за гравця, чий час сплив. */
  private readonly turnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Боти за ідентифікатором учасника. */
  private readonly bots = new Map<string, Bot>();
  private readonly onStoreError: (error: unknown) => void;
  private readonly createBot: () => Bot;
  private readonly onBotError: (error: unknown, context: BotErrorContext) => void;
  /** Остання черга записів кожної кімнати: записи однієї кімнати йдуть послідовно. */
  private readonly writes = new Map<string, Promise<boolean>>();
  /** Збережені ігри, які цей рушій не може продовжити: код → пояснення для гравців. */
  private readonly unplayable = new Map<string, string>();
  /** Кімнати, що зараз підвантажуються зі сховища. */
  private readonly loading = new Map<string, Promise<Room | undefined>>();
  /** Менеджер зупинено (`close`): ходи ботів і таймери більше не плануються. */
  private closed = false;
  /** Коди, зайняті кімнатами, які ще створюються. */
  private readonly reserved = new Set<string>();
  private readonly maxRooms: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;
  /** Час останньої зміни чи відключення в кожній кімнаті: від нього рахується TTL. */
  private readonly lastActive = new Map<string, number>();

  constructor(options: RoomManagerOptions = {}) {
    this.random = options.random ?? cryptoRandom;
    this.publicUrl = (options.publicUrl ?? '').replace(/\/+$/, '');
    this.botDelayMs = options.botDelayMs ?? DEFAULT_BOT_DELAY_MS;
    this.trickPauseMs = options.trickPauseMs ?? TRICK_PAUSE_MS;
    this.store = options.store ?? null;
    this.onStoreError = options.onStoreError ?? (() => undefined);
    this.createBot = options.createBot ?? createHeuristicBot;
    this.onBotError = options.onBotError ?? (() => undefined);
    this.maxRooms = options.maxRooms ?? MAX_ROOMS;
    this.idleTtlMs = options.idleTtlMs ?? IDLE_ROOM_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Готує сховище під час старту сервера (схема бази). */
  async init(): Promise<void> {
    await this.store?.init();
  }

  /**
   * Кімната за кодом: з памʼяті або, якщо її там немає (новий процес після рестарту),
   * зі сховища. Відновлена гра продовжується: боти ходять, пауза після взятки витримується.
   */
  async load(code: string): Promise<Room | undefined> {
    const room = this.rooms.get(code);
    if (room !== undefined || this.store === null) return room;
    let pending = this.loading.get(code);
    if (pending === undefined) {
      const store = this.store;
      pending = (async () => {
        try {
          // Кімнату могли щойно вивантажити (`sweep`): спершу дописуємо її останні зміни.
          await this.writes.get(code);
          const snapshot = await store.load(code);
          // Поки читали, кімнату могли завантажити або створити.
          const existing = this.rooms.get(code);
          if (snapshot === null) this.unplayable.delete(code);
          if (existing !== undefined || snapshot === null) return existing;
          return this.restore(snapshot);
        } finally {
          this.loading.delete(code);
        }
      })();
      this.loading.set(code, pending);
    }
    return pending;
  }

  /** Відновлює кімнату зі знімка: гру — через `replay`, люди чекають на перепідключення (R-9.3). */
  private restore(snapshot: RoomSnapshot): Room | undefined {
    let game: GameState | null = null;
    try {
      if (snapshot.game !== null) {
        game = replay(snapshot.game.seed, snapshot.game.log);
        if (game.playerCount !== snapshot.seats.length) return undefined;
      }
    } catch (error) {
      // Знімок, який не відтворюється, пропускаємо: це не має валити сервер.
      if (error instanceof UnsupportedLogVersionError) {
        this.unplayable.set(
          snapshot.code,
          `${error.message}. Продовжити цю гру неможливо — створіть нову кімнату.`,
        );
      }
      return undefined;
    }
    const room: Room = {
      code: snapshot.code,
      hostId: snapshot.hostId,
      status: snapshot.status,
      seats: snapshot.seats.map((seat) => ({
        ...seat,
        connected: seat.kind === 'bot',
        away: seat.away ?? false,
      })),
      game,
      turnTimerSec: snapshot.turnTimerSec,
      // Знімки, збережені до §10, опцій не мають — вони вимкнені.
      options: game?.options ?? snapshot.options ?? DEFAULT_OPTIONS,
      turnDeadline: null,
      bugReports: [...(snapshot.bugReports ?? [])],
      bugReportsSent: { ...snapshot.bugReportsSent },
    };
    for (const member of room.seats) {
      if (member.kind === 'bot') this.bots.set(member.id, this.createBot());
    }
    this.rooms.set(room.code, room);
    this.lastActive.set(room.code, this.now());
    if (room.status === 'playing' && game !== null) {
      // Рестарт міг статися одразу після взятки: пауза взятки починається заново.
      this.scheduleTurn(room, afterTrick(game));
    }
    return room;
  }

  private snapshot(room: Room): RoomSnapshot {
    return {
      version: ROOM_SNAPSHOT_VERSION,
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      turnTimerSec: room.turnTimerSec,
      options: room.options,
      seats: room.seats.map(({ id, name, kind, token, away }) => ({ id, name, kind, token, away })),
      game: room.game === null ? null : { seed: room.game.seed, log: gameLog(room.game) },
      bugReports: [...room.bugReports],
      bugReportsSent: { ...room.bugReportsSent },
    };
  }

  subscribe(listener: RoomListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected changed(code: string): void {
    const room = this.rooms.get(code);
    if (room !== undefined) {
      this.lastActive.set(code, this.now());
      this.persist(room);
    }
    for (const listener of this.listeners) listener(code);
  }

  /** Ставить знімок у чергу записів кімнати: наступний запис чекає попередній. */
  private persist(room: Room): void {
    const store = this.store;
    if (store === null) return;
    const snapshot = this.snapshot(room);
    this.enqueue(room.code, () => store.save(snapshot));
  }

  /** Ставить запис у чергу кімнати `code`. */
  private enqueue(code: string, write: () => Promise<void>): void {
    const previous = this.writes.get(code) ?? Promise.resolve(true);
    const next = previous.then(() =>
      write().then(
        () => true,
        (error: unknown) => {
          this.onStoreError(error);
          return false;
        },
      ),
    );
    this.writes.set(code, next);
    void next.then(() => {
      if (this.writes.get(code) === next) this.writes.delete(code);
    });
  }

  /** Закриває кімнату: прибирає її з памʼяті й зі сховища. */
  private remove(room: Room): void {
    this.forget(room);
    const store = this.store;
    if (store !== null) this.enqueue(room.code, () => store.delete(room.code));
    for (const listener of this.listeners) listener(room.code);
  }

  /** Прибирає кімнату з памʼяті: її боти й заплановані ходи скасовуються. */
  private forget(room: Room): void {
    this.rooms.delete(room.code);
    this.lastActive.delete(room.code);
    for (const member of room.seats) this.bots.delete(member.id);
    const timer = this.turnTimers.get(room.code);
    if (timer !== undefined) clearTimeout(timer);
    this.turnTimers.delete(room.code);
  }

  /**
   * Прибирає з памʼяті покинуті кімнати: без підключених людей і без змін довше `idleTtlMs`.
   * Зі сховищем кімната лише вивантажується: `load` поверне її за кодом, і гра продовжиться.
   * Без сховища кімната зникає назавжди. Повертає кількість прибраних кімнат.
   */
  sweep(): number {
    const since = this.now() - this.idleTtlMs;
    let removed = 0;
    for (const room of [...this.rooms.values()]) {
      if (room.seats.some((m) => m.kind === 'human' && m.connected)) continue;
      if ((this.lastActive.get(room.code) ?? 0) > since) continue;
      this.forget(room);
      removed++;
    }
    return removed;
  }

  /**
   * Чекає, доки всі зміни кімнати запишуться у сховище. `false` — останній запис не вдався
   * (сховище недоступне навіть після повторних спроб).
   */
  async persisted(code: string): Promise<boolean> {
    return (await this.writes.get(code)) ?? true;
  }

  /** Чекає запису всіх кімнат (зупинка сервера). */
  async flush(): Promise<void> {
    while (this.writes.size > 0) await Promise.all(this.writes.values());
  }

  /** Очищує сховище від старих завершених ігор і покинутих лобі. */
  async cleanup(): Promise<number> {
    const store = this.store;
    if (store === null) return 0;
    const removed = await store.cleanup();
    // Пояснення про несумісну гру потрібне, лише поки її знімок лежить у сховищі.
    for (const code of [...this.unplayable.keys()]) {
      if (!(await store.has(code))) this.unplayable.delete(code);
    }
    return removed;
  }

  /** Посилання-запрошення в кімнату. */
  link(code: string): string {
    return `${this.publicUrl}/r/${code}`;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Новий код, не зайнятий ні в памʼяті, ні у сховищі. */
  private async newCode(): Promise<string> {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[this.random.int(ROOM_CODE_ALPHABET.length)];
      }
      if (this.rooms.has(code) || this.reserved.has(code)) continue;
      if (this.store === null) return code;
      // Код резервується, поки перевіряємо сховище: паралельне створення його не візьме.
      // Зарезервований код звільняє `create`, коли кімната вже в памʼяті.
      this.reserved.add(code);
      let taken = true;
      try {
        taken = await this.store.has(code);
      } finally {
        if (taken) this.reserved.delete(code);
      }
      if (!taken) return code;
    }
  }

  private newHuman(name: string): Member {
    return {
      id: this.random.id(),
      name,
      kind: 'human',
      token: this.random.token(),
      connected: false,
      away: false,
    };
  }

  private session(room: Room, member: Member): Session {
    return {
      code: room.code,
      token: member.token as string,
      playerId: member.id,
      link: this.link(room.code),
    };
  }

  /** Помилка «кімнати немає»; для гри несумісної версії — з поясненням. */
  private missing(code: string): Result<never> {
    const reason = this.unplayable.get(code.toUpperCase());
    return fail('roomNotFound', reason ?? `Кімнати ${code} немає`);
  }

  /** Знаходить кімнату й учасника; для `host` — ще й перевіряє, що це хост. */
  protected access(
    code: string,
    playerId: string,
    role: 'member' | 'host' = 'member',
  ): Result<{ room: Room; member: Member }> {
    const room = this.rooms.get(code);
    if (room === undefined) return this.missing(code);
    const member = room.seats.find((m) => m.id === playerId);
    if (member === undefined) return fail('notInRoom', 'Гравця немає в цій кімнаті');
    if (role === 'host' && room.hostId !== playerId) {
      return fail('notHost', 'Це може зробити лише хост кімнати');
    }
    return ok({ room, member });
  }

  /** Доступ хоста до кімнати в лобі (до старту гри). */
  private lobby(code: string, playerId: string): Result<Room> {
    const access = this.access(code, playerId, 'host');
    if (!access.ok) return access;
    const { room } = access.data;
    if (room.status !== 'lobby') return fail('alreadyStarted', 'Гра вже почалася');
    return ok(room);
  }

  async create(name: string): Promise<Result<Session>> {
    if (this.rooms.size + this.reserved.size >= this.maxRooms) this.sweep();
    if (this.rooms.size + this.reserved.size >= this.maxRooms) {
      return fail('unavailable', 'На сервері забагато кімнат, спробуйте пізніше');
    }
    const code = await this.newCode();
    const host = this.newHuman(name);
    const room: Room = {
      code,
      hostId: host.id,
      status: 'lobby',
      seats: [host],
      game: null,
      turnTimerSec: null,
      options: DEFAULT_OPTIONS,
      turnDeadline: null,
      bugReports: [],
      bugReportsSent: {},
    };
    this.rooms.set(room.code, room);
    this.reserved.delete(code);
    this.unplayable.delete(code);
    this.changed(room.code);
    return ok(this.session(room, host));
  }

  /** Вхід за кодом: новий гравець сідає на наступне місце (R-9.1). Кімнату спершу підвантажує `load`. */
  join(code: string, name: string): Result<Session> {
    const room = this.rooms.get(code.toUpperCase());
    if (room === undefined) return this.missing(code);
    if (room.status !== 'lobby') return fail('alreadyStarted', 'Гра вже почалася');
    if (room.seats.length >= MAX_PLAYERS) {
      return fail('roomFull', `У кімнаті вже ${MAX_PLAYERS} гравців (R-1.2)`);
    }
    const member = this.newHuman(name);
    room.seats.push(member);
    this.changed(room.code);
    return ok(this.session(room, member));
  }

  /** Повернення в кімнату за токеном. Кімнату спершу підвантажує `load`. */
  resume(code: string, token: string): Result<Session> {
    const room = this.rooms.get(code.toUpperCase());
    if (room === undefined) return this.missing(code);
    const member = room.seats.find((m) => m.token === token);
    if (member === undefined) return fail('badToken', 'Невідомий токен');
    if (member.away) {
      // Гравець забирає місце назад: бот більше не ходить за нього.
      member.away = false;
      if (room.game?.turn === room.seats.indexOf(member)) this.scheduleTurn(room);
      this.changed(room.code);
    }
    return ok(this.session(room, member));
  }

  /**
   * Гравець виходить (T180). У лобі місце звільняється й токен більше не діє; якщо виходить
   * хост — хостом стає наступна людина, а без людей кімната закривається. Посеред гри місце
   * лишається за гравцем: за нього ходить бот, поки він не повернеться за токеном.
   * Із завершеної гри — токен анулюється.
   */
  leave(code: string, playerId: string): Result<null> {
    const access = this.access(code, playerId);
    if (!access.ok) return access;
    const { room, member } = access.data;
    if (room.status === 'playing') {
      member.away = true;
      const game = room.game as GameState;
      if (game.turn === room.seats.indexOf(member)) this.scheduleTurn(room, afterTrick(game));
    } else if (room.status === 'finished') {
      member.token = null;
    } else {
      const index = room.seats.indexOf(member);
      room.seats.splice(index, 1);
      if (room.hostId === playerId) {
        // Наступна людина за місцем того, хто вийшов (по колу).
        const humans = [...room.seats.slice(index), ...room.seats.slice(0, index)].filter(
          (m) => m.kind === 'human',
        );
        const next = humans[0];
        if (next === undefined) {
          this.remove(room);
          return ok(null);
        }
        room.hostId = next.id;
      }
    }
    this.changed(room.code);
    return ok(null);
  }

  /** Хост додає бота на наступне місце (R-1.2: будь-яке місце може зайняти бот). */
  addBot(code: string, playerId: string): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    const room = lobby.data;
    if (room.seats.length >= MAX_PLAYERS) {
      return fail('roomFull', `У кімнаті вже ${MAX_PLAYERS} гравців (R-1.2)`);
    }
    room.seats.push(this.newBot(room));
    this.changed(room.code);
    return ok(null);
  }

  /** Новий бот з першим вільним іменем «Бот N». */
  private newBot(room: Room): Member {
    const names = new Set(room.seats.map((m) => m.name));
    let n = 1;
    while (names.has(`Бот ${n}`)) n++;
    const bot: Member = {
      id: this.random.id(),
      name: `Бот ${n}`,
      kind: 'bot',
      token: null,
      connected: true,
      away: false,
    };
    this.bots.set(bot.id, this.createBot());
    return bot;
  }

  removeBot(code: string, playerId: string, seat: number): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    const room = lobby.data;
    const bot = room.seats[seat];
    if (bot?.kind !== 'bot') return fail('badRequest', `На місці ${seat} немає бота`);
    room.seats.splice(seat, 1);
    this.bots.delete(bot.id);
    this.changed(room.code);
    return ok(null);
  }

  /** Хост перемішує місця до старту (R-9.1). */
  shuffle(code: string, playerId: string): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    const seats = lobby.data.seats;
    for (let i = seats.length - 1; i > 0; i--) {
      const j = this.random.int(i + 1);
      [seats[i], seats[j]] = [seats[j] as Member, seats[i] as Member];
    }
    this.changed(code);
    return ok(null);
  }

  /** Хост змінює налаштування кімнати до старту: таймер ходу (R-9.3). */
  settings(code: string, playerId: string, turnTimerSec: number | null): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    lobby.data.turnTimerSec = turnTimerSec;
    this.changed(code);
    return ok(null);
  }

  /** Хост вмикає чи вимикає опції кімнати (§10) лише до старту гри (R-10.1). */
  options(code: string, playerId: string, options: GameOptions): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    lobby.data.options = { dark: options.dark, zeroLimit: options.zeroLimit };
    this.changed(code);
    return ok(null);
  }

  /**
   * Хост віддає боту місце відключеного гравця (R-9.3): місце позначається `away`, за гравця
   * ходить бот, а повернувшись за токеном, гравець знову займає місце з тими самими картами й балами.
   */
  replaceWithBot(code: string, playerId: string, seat: number): Result<null> {
    const access = this.access(code, playerId, 'host');
    if (!access.ok) return access;
    const { room } = access.data;
    if (room.status !== 'playing') return fail('notStarted', 'Гра не йде');
    const member = room.seats[seat];
    if (member?.kind !== 'human' || member.id === room.hostId) {
      return fail('badRequest', `На місці ${seat} немає іншого гравця-людини`);
    }
    if (member.connected) {
      return fail(
        'playerConnected',
        `${member.name} у грі: віддати боту можна лише місце відключеного`,
      );
    }
    if (member.away) return ok(null);
    member.away = true;
    const game = room.game as GameState;
    if (game.turn === seat) this.scheduleTurn(room, afterTrick(game));
    this.changed(code);
    return ok(null);
  }

  /** Хост запускає гру: потрібно від 3 до 6 гравців (R-1.2). */
  start(code: string, playerId: string): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    const room = lobby.data;
    if (room.seats.length < MIN_PLAYERS) {
      return fail('notEnoughPlayers', `Потрібно щонайменше ${MIN_PLAYERS} гравці (R-1.2)`);
    }
    // R-10.1: опції фіксуються разом із грою (входять у лог і replay).
    room.game = createGame(this.random.int(UINT32), room.seats.length, room.options);
    room.status = 'playing';
    this.scheduleTurn(room);
    this.changed(code);
    return ok(null);
  }

  /** Замовлення гравця (R-4.x): перевіряє рушій. */
  bid(code: string, playerId: string, bid: number): Result<null> {
    return this.act(code, playerId, (seat) => ({ type: 'bid', seat, bid }));
  }

  /** Хід картою (R-5.x, R-6.x): перевіряє рушій. */
  play(code: string, playerId: string, card: Card, call?: JokerCall): Result<null> {
    return this.act(code, playerId, (seat) => ({
      type: 'play',
      seat,
      card,
      ...(call !== undefined && { call }),
    }));
  }

  /** Погляд гравця на гру (`viewFor` його місця) або `null`, якщо гра не почалася. */
  view(code: string, playerId: string): PlayerView | null {
    const room = this.rooms.get(code);
    const seat = room?.seats.findIndex((m) => m.id === playerId) ?? -1;
    if (room?.game == null || seat < 0) return null;
    return viewFor(room.game, seat);
  }

  /**
   * Реєструє звіт гравця про баг (T52): не більше `BUG_REPORTS_PER_PLAYER` від гравця.
   * Звіт з гри, що йде, стає в чергу в знімку кімнати (`queued`) — він переживе рестарт;
   * звіт із завершеної гри сервер публікує одразу. До старту гри — `notStarted`.
   */
  reportBug(
    code: string,
    playerId: string,
    description: string,
  ): Result<{ context: BugContext; queued: boolean }> {
    const access = this.access(code, playerId);
    if (!access.ok) return access;
    const { room, member } = access.data;
    if (room.game === null) return fail('notStarted', 'Гра ще не почалася');
    const sent = room.bugReportsSent[playerId] ?? 0;
    if (sent >= BUG_REPORTS_PER_PLAYER) {
      return fail('rateLimited', 'Ви вже надіслали кілька звітів з цієї гри, дякуємо!');
    }
    room.bugReportsSent[playerId] = sent + 1;
    const context: BugContext = {
      code: room.code,
      seat: room.seats.indexOf(member),
      kinds: room.seats.map((m) => m.kind),
      game: room.game,
    };
    const queued = room.game.status !== 'finished';
    if (queued) {
      room.bugReports.push({
        id: this.random.id(),
        seat: context.seat,
        kinds: context.kinds,
        actions: room.game.actions.length,
        description,
      });
    }
    this.persist(room);
    return ok({ context, queued });
  }

  /** Звіт не вдалося опублікувати: він не рахується в ліміт гравця. */
  unreportBug(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    const sent = room?.bugReportsSent[playerId] ?? 0;
    if (room === undefined || sent === 0) return;
    room.bugReportsSent[playerId] = sent - 1;
    this.persist(room);
  }

  /** Відкладені звіти кімнати, якщо її гра завершилася: тепер їх можна публікувати. */
  finishedBugReports(code: string): QueuedBugReport[] {
    const room = this.rooms.get(code);
    if (room?.game?.status !== 'finished') return [];
    return queuedReports(room.code, room.bugReports, room.game);
  }

  /**
   * Звіти зі сховища, які вже можна публікувати: із завершених ігор (напр. сервер упав
   * до публікації) і з покинутих. Покинуту кімнату не відновлюємо — боти не ходять.
   */
  async unpublishedBugReports(): Promise<QueuedBugReport[]> {
    const store = this.store;
    if (store === null) return [];
    const result: QueuedBugReport[] = [];
    for (const code of await store.unpublishedBugReports()) {
      const room = this.rooms.get(code);
      if (room !== undefined) {
        if (room.game !== null) result.push(...queuedReports(code, room.bugReports, room.game));
        continue;
      }
      const snapshot = await store.load(code);
      if (snapshot?.game == null) continue;
      try {
        const game = replay(snapshot.game.seed, snapshot.game.log);
        result.push(...queuedReports(code, snapshot.bugReports ?? [], game));
      } catch {
        // Гру несумісної версії не відтворити: звіт без replay агентові не допоможе.
      }
    }
    return result;
  }

  /** Звіт `id` опубліковано: прибирає його з черги кімнати (у памʼяті чи у сховищі). */
  async bugReportPublished(code: string, id: string): Promise<void> {
    const room = this.rooms.get(code);
    if (room !== undefined) {
      room.bugReports = room.bugReports.filter((report) => report.id !== id);
      this.persist(room);
      await this.persisted(code);
      return;
    }
    const snapshot = await this.store?.load(code);
    if (snapshot == null) return;
    await this.store?.save({
      ...snapshot,
      bugReports: (snapshot.bugReports ?? []).filter((report) => report.id !== id),
    });
  }

  /** Скасовує заплановані ходи (зупинка сервера); стан лишається у сховищі. */
  close(): void {
    this.closed = true;
    for (const timer of this.turnTimers.values()) clearTimeout(timer);
    this.turnTimers.clear();
  }

  /** Сервер авторитетний: дію гравця приймає лише рушій, місце береться з сесії. */
  private act(code: string, playerId: string, toAction: (seat: number) => Action): Result<null> {
    const access = this.access(code, playerId);
    if (!access.ok) return access;
    const { room, member } = access.data;
    if (room.game === null || room.status !== 'playing') {
      return fail('notStarted', 'Гра не йде');
    }
    try {
      this.applyAction(room, toAction(room.seats.indexOf(member)));
    } catch (error) {
      if (error instanceof IllegalActionError) return fail('illegalAction', error.message);
      throw error;
    }
    return ok(null);
  }

  private applyAction(room: Room, action: Action): void {
    room.game = apply(room.game as GameState, action);
    if (room.game.status === 'finished') room.status = 'finished';
    // Карта завершила взятку (і, можливо, роздачу): стіл порожній.
    this.scheduleTurn(room, action.type === 'play' && room.game.hand.trick.length === 0);
    this.changed(room.code);
  }

  /**
   * Планує поточний хід: бот ходить із затримкою; за людину, якщо ввімкнено таймер (R-9.3),
   * легальний хід робить сервер, коли час сплив. Без таймера місце чекає на гравця.
   * Після завершення взятки бот чекає щонайменше паузу взятки.
   */
  private scheduleTurn(room: Room, afterTrick = false): void {
    const pending = this.turnTimers.get(room.code);
    if (pending !== undefined) clearTimeout(pending);
    this.turnTimers.delete(room.code);
    room.turnDeadline = null;
    const turn = room.game?.turn ?? null;
    if (turn === null || this.closed) return;
    const member = room.seats[turn] as Member;
    let delay: number;
    let bot: Bot;
    if (member.kind === 'bot' || member.away) {
      // За гравця, що вийшов (T180), ходить евристичний бот — так само швидко, як звичайний.
      delay = afterTrick ? Math.max(this.botDelayMs, this.trickPauseMs) : this.botDelayMs;
      bot = member.kind === 'bot' ? (this.bots.get(member.id) as Bot) : this.createBot();
    } else if (room.turnTimerSec !== null) {
      delay = room.turnTimerSec * 1000;
      room.turnDeadline = Date.now() + delay;
      bot = this.createBot();
    } else {
      return;
    }
    const timer = setTimeout(() => {
      this.turnTimers.delete(room.code);
      const game = room.game as GameState;
      if (game.turn !== turn) return;
      this.botTurn(room, game, turn, bot);
    }, delay);
    this.turnTimers.set(room.code, timer);
  }

  /**
   * Хід бота з таймера. Баг бота (виняток чи нелегальна дія) не має валити процес:
   * помилка логується із seed і логом гри, а замість ходу бота грається перша легальна дія.
   */
  private botTurn(room: Room, game: GameState, turn: number, bot: Bot): void {
    let action: Action;
    try {
      action = bot.act(viewFor(game, turn));
      apply(game, action);
    } catch (error) {
      this.onBotError(error, { code: room.code, seat: turn, seed: game.seed, log: gameLog(game) });
      action = legalActions(game)[0] as Action;
    }
    this.applyAction(room, action);
  }

  /** Позначає, чи підключений гравець (є хоч одне активне зʼєднання). */
  setConnected(code: string, playerId: string, connected: boolean): void {
    const member = this.rooms.get(code)?.seats.find((m) => m.id === playerId);
    if (member === undefined || member.connected === connected) return;
    member.connected = connected;
    this.changed(code);
  }

  /** Стан кімнати, яким його бачить гравець `playerId`. */
  roomState(code: string, playerId: string): RoomState {
    const room = this.rooms.get(code);
    if (room === undefined) throw new RangeError(`Кімнати ${code} немає`);
    return {
      code: room.code,
      link: this.link(room.code),
      status: room.status,
      hostId: room.hostId,
      you: playerId,
      seats: room.seats.map(({ id, name, kind, connected, away }) => ({
        id,
        name,
        kind,
        connected,
        away,
      })),
      turnTimerSec: room.turnTimerSec,
      turnDeadline: room.turnDeadline,
      options: room.options,
    };
  }
}
