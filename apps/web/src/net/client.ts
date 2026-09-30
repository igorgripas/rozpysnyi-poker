import {
  type ClientEvent,
  type ClientMessageInput,
  type RoomState,
  type Session,
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
} from './connection';

export const SESSION_STORAGE_KEY = 'poker.session';
export const NAME_STORAGE_KEY = 'poker.name';

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
}

type RoomEvent = Exclude<ClientEvent, 'room:create' | 'room:join' | 'room:resume'>;

/** Стан клієнта поверх зʼєднання: сесія, кімната й погляд на гру. */
export class PokerClient {
  private state: ClientState = { status: 'idle', connection: 'connecting', room: null, view: null };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly connection: Connection,
    private readonly storage: Storage = localStorage,
  ) {
    connection.subscribe((update) => {
      if (update.type === 'room') this.set({ room: update.room });
      else if (update.type === 'view') this.set({ view: update.view });
      else this.changeConnection(update.status);
    });
  }

  /** Після перепідключення сервер уже не знає, хто ми: повертаємося в кімнату за токеном. */
  private changeConnection(connection: ConnectionStatus): void {
    const reconnected = connection === 'online' && this.state.connection !== 'online';
    this.set({ connection });
    if (reconnected && this.state.room !== null) void this.rejoin(this.state.room.code);
  }

  private async rejoin(code: string): Promise<void> {
    await this.resume(code);
    // Кімнати чи місця вже немає (сесію забуто) — повертаємося в лобі.
    if (this.storedSession()?.code !== code) this.set({ room: null, view: null });
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
   * Недійсну сесію забуває. Повертає, чи вдалося повернутися.
   */
  async resume(code?: string): Promise<boolean> {
    const stored = this.storedSession();
    if (stored === null || (code !== undefined && code !== stored.code)) return false;
    if (this.state.status === 'resuming') return false;
    this.set({ status: 'resuming' });
    const result = await this.connection.request('room:resume', stored);
    this.set({ status: 'idle' });
    if (result.ok) return true;
    if (result.error.code !== 'network') this.storage.removeItem(SESSION_STORAGE_KEY);
    return false;
  }

  /** Дія в кімнаті (хост, гра); повертає помилку або `null`. */
  async send<E extends RoomEvent>(
    event: E,
    payload: ClientMessageInput<E>,
  ): Promise<ClientError | null> {
    // Без звʼязку дію не буферизуємо: після перепідключення стан гри вже інший.
    if (this.state.connection === 'offline' || this.state.connection === 'outdated') {
      return NETWORK_ERROR;
    }
    const result = await this.connection.request(event, payload);
    return result.ok ? null : result.error;
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
