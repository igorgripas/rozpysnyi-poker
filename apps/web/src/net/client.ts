import {
  type BugReportResponse,
  type ClientEvent,
  type ClientMessageInput,
  type RoomState,
  type Session,
  type VoiceJoinResponse,
  type WirePlayerView,
  playerNameSchema,
  roomCodeSchema,
} from '@poker/protocol';
import {
  type ClientError,
  type ClientResult,
  type Connection,
  type ConnectionStatus,
  NETWORK_ERROR,
  type VoiceMessage,
} from './connection';

export const SESSION_STORAGE_KEY = 'poker.session';
export const NAME_STORAGE_KEY = 'poker.name';
/** Ігри, з яких гравець вийшов посеред гри й може повернутися (T180). */
export const UNFINISHED_STORAGE_KEY = 'poker.unfinished';

/** Скільки незавершених ігор памʼятати. */
const UNFINISHED_LIMIT = 10;

/** Через скільки повторити повернення в кімнату, якщо сервер ще не готовий, мс. */
export const RESUME_RETRY_MS = 2000;

/** Що клієнт памʼятає між запусками: кімната й секретний токен гравця. */
export interface StoredSession {
  readonly code: string;
  readonly token: string;
}

/** Гра, з якої гравець вийшов посеред гри: за нього ходить бот, повернутися можна. */
export interface UnfinishedGame extends StoredSession {
  /** Хто грає (імена місць у порядку гри). */
  readonly players: readonly string[];
}

export interface ClientState {
  /** `resuming` — повертаємося в кімнату за збереженим токеном. */
  readonly status: 'idle' | 'resuming';
  /** Стан звʼязку з сервером. */
  readonly connection: ConnectionStatus;
  readonly room: RoomState | null;
  readonly view: WirePlayerView | null;
  /** Чому не вдалося повернутися в кімнату (напр., гру збережено несумісною версією). */
  readonly resumeError: string | null;
  /** Мої незавершені ігри: з них гравець вийшов сам, назад — лише за його бажанням. */
  readonly unfinished: readonly UnfinishedGame[];
}

type RoomEvent = Exclude<
  ClientEvent,
  'room:create' | 'room:join' | 'room:resume' | 'room:leave' | 'game:reportBug' | 'voice:join'
>;

function isUnfinishedGame(value: unknown): value is UnfinishedGame {
  if (typeof value !== 'object' || value === null) return false;
  const { code, token, players } = value as Record<string, unknown>;
  return (
    typeof code === 'string' &&
    typeof token === 'string' &&
    Array.isArray(players) &&
    players.every((name) => typeof name === 'string')
  );
}

/** Стан клієнта поверх зʼєднання: сесія, кімната й погляд на гру. */
export class PokerClient {
  private state: ClientState = {
    status: 'idle',
    connection: 'connecting',
    room: null,
    view: null,
    resumeError: null,
    unfinished: [],
  };
  /** Кімната, з якої гравець щойно вийшов: її запізнілі оновлення ігноруються. */
  private left: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly voiceListeners = new Set<(message: VoiceMessage) => void>();

  constructor(
    private readonly connection: Connection,
    private readonly storage: Storage = localStorage,
  ) {
    this.state = { ...this.state, unfinished: this.loadUnfinished() };
    connection.subscribe((update) => {
      if (update.type === 'room') {
        if (update.room.code !== this.left) this.set({ room: update.room });
      } else if (update.type === 'view') {
        if (this.left === null) this.set({ view: update.view });
      } else if (update.type === 'voice') {
        for (const listener of this.voiceListeners) listener(update.message);
      } else this.changeConnection(update.status);
    });
  }

  /** Після перепідключення сервер уже не знає, хто ми: повертаємося в кімнату за токеном. */
  private changeConnection(connection: ConnectionStatus): void {
    const reconnected = connection === 'online' && this.state.connection !== 'online';
    this.set({ connection });
    if (reconnected && this.state.room !== null) void this.rejoin(this.state.room.code);
  }

  private async rejoin(code: string): Promise<void> {
    const resumed = await this.resume(code);
    // Кімнати чи місця вже немає (сесію забуто) — повертаємося в лобі.
    if (this.storedSession()?.code !== code) {
      this.set({ room: null, view: null });
      return;
    }
    // Сервер після перезапуску ще не готовий (база прокидається): пробуємо знову.
    if (!resumed && this.state.connection === 'online') {
      setTimeout(() => {
        if (this.state.connection === 'online' && this.state.room?.code === code) {
          void this.rejoin(code);
        }
      }, RESUME_RETRY_MS);
    }
  }

  getState = (): ClientState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  storedSession(): StoredSession | null {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(SESSION_STORAGE_KEY) ?? 'null');
      if (typeof value !== 'object' || value === null) return null;
      const { code, token } = value as Record<string, unknown>;
      return typeof code === 'string' && typeof token === 'string' ? { code, token } : null;
    } catch {
      return null;
    }
  }

  savedName(): string {
    return this.storage.getItem(NAME_STORAGE_KEY) ?? '';
  }

  private loadUnfinished(): UnfinishedGame[] {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(UNFINISHED_STORAGE_KEY) ?? '[]');
      return Array.isArray(value) ? value.filter(isUnfinishedGame) : [];
    } catch {
      return [];
    }
  }

  private saveUnfinished(unfinished: readonly UnfinishedGame[]): void {
    this.storage.setItem(UNFINISHED_STORAGE_KEY, JSON.stringify(unfinished));
    this.set({ unfinished });
  }

  private forgetUnfinished(code: string): void {
    if (this.state.unfinished.some((game) => game.code === code)) {
      this.saveUnfinished(this.state.unfinished.filter((game) => game.code !== code));
    }
  }

  private enter(result: ClientResult<Session>): ClientError | null {
    if (!result.ok) return result.error;
    this.set({ resumeError: null });
    const { code, token } = result.data;
    this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code, token }));
    return null;
  }

  async create(name: string): Promise<ClientError | null> {
    this.left = null;
    this.storage.setItem(NAME_STORAGE_KEY, name);
    return this.enter(await this.connection.request('room:create', { name }));
  }

  async join(code: string, name: string): Promise<ClientError | null> {
    this.left = null;
    this.storage.setItem(NAME_STORAGE_KEY, name);
    return this.enter(await this.connection.request('room:join', { code, name }));
  }

  /**
   * Повертається в кімнату за збереженим токеном. Якщо задано `code`, лише в цю кімнату —
   * за сесією або, якщо це незавершена гра, з якої гравець вийшов, за її токеном.
   * Недійсну сесію забуває, а пояснення зберігає в `resumeError`. Повертає, чи вдалося повернутися.
   */
  async resume(code?: string): Promise<boolean> {
    const session = this.storedSession();
    const unfinished =
      code === undefined ? undefined : this.state.unfinished.find((game) => game.code === code);
    const stored =
      session !== null && (code === undefined || code === session.code)
        ? session
        : unfinished === undefined
          ? null
          : { code: unfinished.code, token: unfinished.token };
    if (stored === null) return false;
    if (this.state.status === 'resuming') return false;
    this.left = null;
    this.set({ status: 'resuming' });
    const result = await this.connection.request('room:resume', stored);
    if (result.ok) {
      // Гравець повернувся в гру, з якої виходив: вона знову поточна.
      this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
      this.forgetUnfinished(stored.code);
      this.set({ status: 'idle', resumeError: null });
      return true;
    }
    // Мережа чи сервер, що перезапускається, — тимчасово: сесію не забуваємо.
    if (result.error.code === 'network' || result.error.code === 'unavailable') {
      this.set({ status: 'idle' });
      return false;
    }
    // Повернутися не вийде: сесію забуваємо, а пояснення сервера показуємо в лобі.
    if (stored === session) this.storage.removeItem(SESSION_STORAGE_KEY);
    this.forgetUnfinished(stored.code);
    this.set({ status: 'idle', resumeError: result.error.message });
    return false;
  }

  /**
   * Вихід із кімнати (T180): одразу на головну, навіть без звʼязку (помилку сервера ігноруємо).
   * З гри, що триває, сесія переходить у «мої незавершені ігри» — за гравця ходить бот,
   * а повернутися можна з головної. З лобі чи завершеної гри сесію забуто.
   */
  async leave(): Promise<void> {
    const { room } = this.state;
    const session = this.storedSession();
    if (room !== null) this.left = room.code;
    this.storage.removeItem(SESSION_STORAGE_KEY);
    if (session !== null) {
      const others = this.state.unfinished.filter((game) => game.code !== session.code);
      if (room?.status === 'playing' && room.code === session.code) {
        const players = room.seats.map((seat) => seat.name);
        this.saveUnfinished([{ ...session, players }, ...others].slice(0, UNFINISHED_LIMIT));
      } else {
        this.forgetUnfinished(session.code);
      }
    }
    this.set({ room: null, view: null, resumeError: null });
    globalThis.history?.replaceState(null, '', '/');
    await this.connection.request('room:leave', {});
  }

  /** Дія в кімнаті (хост, гра); повертає помилку або `null`. */
  async send<E extends RoomEvent>(
    event: E,
    payload: ClientMessageInput<E>,
  ): Promise<ClientError | null> {
    // Без звʼязку дію не буферизуємо: після перепідключення стан гри вже інший.
    if (this.state.connection !== 'online' && this.state.connection !== 'connecting') {
      return NETWORK_ERROR;
    }
    const result = await this.connection.request(event, payload);
    return result.ok ? null : result.error;
  }

  /** Події голосового чату від сервера (T63). */
  onVoice(listener: (message: VoiceMessage) => void): () => void {
    this.voiceListeners.add(listener);
    return () => this.voiceListeners.delete(listener);
  }

  /** Вхід у голосовий чат кімнати: у відповідь — хто вже в голосі. */
  voiceJoin(): Promise<ClientResult<VoiceJoinResponse>> {
    return this.connection.request('voice:join', {});
  }

  /**
   * Звіт про баг (AUTOPILOT §6): сервер створює issue з replay гри й повертає його адресу;
   * посеред гри — `url: null`, issue зʼявиться після її завершення.
   */
  async reportBug(description: string): Promise<ClientResult<BugReportResponse>> {
    if (this.state.connection !== 'online' && this.state.connection !== 'connecting') {
      return { ok: false, error: NETWORK_ERROR };
    }
    return this.connection.request('game:reportBug', { description });
  }
}

/** Нормалізує імʼя гравця або повертає `null`, якщо воно некоректне. */
export function parseName(name: string): string | null {
  const parsed = playerNameSchema.safeParse(name);
  return parsed.success ? parsed.data : null;
}

/** Нормалізує код кімнати (верхній регістр) або повертає `null`. */
export function parseRoomCode(code: string): string | null {
  const parsed = roomCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : null;
}

/** Код кімнати з посилання-запрошення `/r/КОД`. */
export function inviteCodeFromPath(pathname: string): string | null {
  const match = /^\/r\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] === undefined ? null : parseRoomCode(match[1]);
}
