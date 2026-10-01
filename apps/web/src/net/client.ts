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

/** Через скільки повторити повернення в кімнату, якщо сервер ще не готовий, мс. */
export const RESUME_RETRY_MS = 2000;

/** Що клієнт памʼятає між запусками: кімната й секретний токен гравця. */
export interface StoredSession {
  readonly code: string;
  readonly token: string;
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
}

type RoomEvent = Exclude<
  ClientEvent,
  'room:create' | 'room:join' | 'room:resume' | 'game:reportBug' | 'voice:join'
>;

/** Стан клієнта поверх зʼєднання: сесія, кімната й погляд на гру. */
export class PokerClient {
  private state: ClientState = {
    status: 'idle',
    connection: 'connecting',
    room: null,
    view: null,
    resumeError: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly voiceListeners = new Set<(message: VoiceMessage) => void>();

  constructor(
    private readonly connection: Connection,
    private readonly storage: Storage = localStorage,
  ) {
    connection.subscribe((update) => {
      if (update.type === 'room') this.set({ room: update.room });
      else if (update.type === 'view') this.set({ view: update.view });
      else if (update.type === 'voice') {
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

  private enter(result: ClientResult<Session>): ClientError | null {
    if (!result.ok) return result.error;
    this.set({ resumeError: null });
    const { code, token } = result.data;
    this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code, token }));
    return null;
  }

  async create(name: string): Promise<ClientError | null> {
    this.storage.setItem(NAME_STORAGE_KEY, name);
    return this.enter(await this.connection.request('room:create', { name }));
  }

  async join(code: string, name: string): Promise<ClientError | null> {
    this.storage.setItem(NAME_STORAGE_KEY, name);
    return this.enter(await this.connection.request('room:join', { code, name }));
  }

  /**
   * Повертається в кімнату за збереженим токеном. Якщо задано `code`, лише в цю кімнату.
   * Недійсну сесію забуває, а пояснення зберігає в `resumeError`. Повертає, чи вдалося повернутися.
   */
  async resume(code?: string): Promise<boolean> {
    const stored = this.storedSession();
    if (stored === null || (code !== undefined && code !== stored.code)) return false;
    if (this.state.status === 'resuming') return false;
    this.set({ status: 'resuming' });
    const result = await this.connection.request('room:resume', stored);
    if (result.ok) {
      this.set({ status: 'idle', resumeError: null });
      return true;
    }
    // Мережа чи сервер, що перезапускається, — тимчасово: сесію не забуваємо.
    if (result.error.code === 'network' || result.error.code === 'unavailable') {
      this.set({ status: 'idle' });
      return false;
    }
    // Повернутися не вийде: сесію забуваємо, а пояснення сервера показуємо в лобі.
    this.storage.removeItem(SESSION_STORAGE_KEY);
    this.set({ status: 'idle', resumeError: result.error.message });
    return false;
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
