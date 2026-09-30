import { type GameState, MAX_PLAYERS, MIN_PLAYERS, createGame } from '@poker/engine';
import {
  type ErrorCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Result,
  type RoomState,
  type RoomStatus,
  type Session,
} from '@poker/protocol';
import { type RandomSource, cryptoRandom } from './random.js';

/** Учасник кімнати: людина з токеном або бот. */
export interface Member {
  readonly id: string;
  readonly name: string;
  readonly kind: 'human' | 'bot';
  /** Секрет для повернення в кімнату; у ботів його немає. */
  readonly token: string | null;
  connected: boolean;
}

export interface Room {
  readonly code: string;
  readonly hostId: string;
  status: RoomStatus;
  /** Місця в порядку гри (R-9.1): індекс — номер місця в рушії. */
  seats: Member[];
  /** Стан гри; `null`, поки гра не почалася. */
  game: GameState | null;
}

export interface RoomManagerOptions {
  random?: RandomSource;
  /** Базова адреса веб-клієнта для посилань-запрошень, напр. `https://poker.example`. */
  publicUrl?: string;
}

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

/** Кімнати в памʼяті: створення, вхід за кодом, повернення за токеном і керування хостом. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly listeners = new Set<RoomListener>();
  private readonly random: RandomSource;
  private readonly publicUrl: string;

  constructor(options: RoomManagerOptions = {}) {
    this.random = options.random ?? cryptoRandom;
    this.publicUrl = (options.publicUrl ?? '').replace(/\/+$/, '');
  }

  subscribe(listener: RoomListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected changed(code: string): void {
    for (const listener of this.listeners) listener(code);
  }

  /** Посилання-запрошення в кімнату. */
  link(code: string): string {
    return `${this.publicUrl}/r/${code}`;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[this.random.int(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  private newHuman(name: string): Member {
    return {
      id: this.random.id(),
      name,
      kind: 'human',
      token: this.random.token(),
      connected: false,
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

  /** Знаходить кімнату й учасника; для `host` — ще й перевіряє, що це хост. */
  protected access(
    code: string,
    playerId: string,
    role: 'member' | 'host' = 'member',
  ): Result<{ room: Room; member: Member }> {
    const room = this.rooms.get(code);
    if (room === undefined) return fail('roomNotFound', `Кімнати ${code} немає`);
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

  create(name: string): Result<Session> {
    const host = this.newHuman(name);
    const room: Room = {
      code: this.newCode(),
      hostId: host.id,
      status: 'lobby',
      seats: [host],
      game: null,
    };
    this.rooms.set(room.code, room);
    this.changed(room.code);
    return ok(this.session(room, host));
  }

  /** Вхід за кодом: новий гравець сідає на наступне місце (R-9.1). */
  join(code: string, name: string): Result<Session> {
    const room = this.rooms.get(code.toUpperCase());
    if (room === undefined) return fail('roomNotFound', `Кімнати ${code} немає`);
    if (room.status !== 'lobby') return fail('alreadyStarted', 'Гра вже почалася');
    if (room.seats.length >= MAX_PLAYERS) {
      return fail('roomFull', `У кімнаті вже ${MAX_PLAYERS} гравців (R-1.2)`);
    }
    const member = this.newHuman(name);
    room.seats.push(member);
    this.changed(room.code);
    return ok(this.session(room, member));
  }

  /** Повернення в кімнату за токеном. */
  resume(code: string, token: string): Result<Session> {
    const room = this.rooms.get(code.toUpperCase());
    if (room === undefined) return fail('roomNotFound', `Кімнати ${code} немає`);
    const member = room.seats.find((m) => m.token === token);
    if (member === undefined) return fail('badToken', 'Невідомий токен');
    return ok(this.session(room, member));
  }

  /** Хост додає бота на наступне місце (R-1.2: будь-яке місце може зайняти бот). */
  addBot(code: string, playerId: string): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    const room = lobby.data;
    if (room.seats.length >= MAX_PLAYERS) {
      return fail('roomFull', `У кімнаті вже ${MAX_PLAYERS} гравців (R-1.2)`);
    }
    const names = new Set(room.seats.map((m) => m.name));
    let n = 1;
    while (names.has(`Бот ${n}`)) n++;
    room.seats.push({
      id: this.random.id(),
      name: `Бот ${n}`,
      kind: 'bot',
      token: null,
      connected: true,
    });
    this.changed(room.code);
    return ok(null);
  }

  removeBot(code: string, playerId: string, seat: number): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    const room = lobby.data;
    if (room.seats[seat]?.kind !== 'bot') return fail('badRequest', `На місці ${seat} немає бота`);
    room.seats.splice(seat, 1);
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

  /** Хост запускає гру: потрібно від 3 до 6 гравців (R-1.2). */
  start(code: string, playerId: string): Result<null> {
    const lobby = this.lobby(code, playerId);
    if (!lobby.ok) return lobby;
    const room = lobby.data;
    if (room.seats.length < MIN_PLAYERS) {
      return fail('notEnoughPlayers', `Потрібно щонайменше ${MIN_PLAYERS} гравці (R-1.2)`);
    }
    room.game = createGame(this.random.int(UINT32), room.seats.length);
    room.status = 'playing';
    this.changed(code);
    return ok(null);
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
      seats: room.seats.map(({ id, name, kind, connected }) => ({ id, name, kind, connected })),
    };
  }
}
