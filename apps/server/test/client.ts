import {
  type ClientEvent,
  type ClientMessageInput,
  type ClientResponses,
  type ClientToServerEvents,
  PROTOCOL_VERSION,
  type Result,
  type RoomState,
  type ServerToClientEvents,
  type WirePlayerView,
} from '@poker/protocol';
import { type Socket, io } from 'socket.io-client';

/** Віртуальний клієнт для тестів: памʼятає останні стан кімнати й погляд гравця. */
export class TestClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  room: RoomState | null = null;
  view: WirePlayerView | null = null;
  /** Усі погляди, отримані від сервера, по порядку. */
  readonly views: WirePlayerView[] = [];
  /** Сервер попередив про перезапуск. */
  restarting = false;
  private readonly waiters: (() => void)[] = [];

  constructor(url: string, protocolVersion: number = PROTOCOL_VERSION) {
    this.socket = io(url, {
      auth: { protocolVersion },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    this.socket.on('room:state', (room) => {
      this.room = room;
      this.notify();
    });
    this.socket.on('server:restarting', () => {
      this.restarting = true;
      this.notify();
    });
    this.socket.on('game:view', (view) => {
      this.view = view;
      this.views.push(view);
      this.notify();
    });
  }

  private notify(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  /** Надсилає подію й чекає відповіді (ack). */
  request<E extends ClientEvent>(
    event: E,
    payload: ClientMessageInput<E>,
  ): Promise<Result<ClientResponses[E]>> {
    return new Promise((resolve) => {
      // Типи Socket.IO не виводять перевантаження для узагальненої події.
      (this.socket.emit as (e: string, p: unknown, ack: (r: unknown) => void) => void)(
        event,
        payload,
        (result) => resolve(result as Result<ClientResponses[E]>),
      );
    });
  }

  /** Чекає, доки умова над станом клієнта стане істинною. */
  async until(predicate: (client: this) => boolean, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('Не дочекалися стану клієнта');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  close(): void {
    this.socket.close();
  }
}
