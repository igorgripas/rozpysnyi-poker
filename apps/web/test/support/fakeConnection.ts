import type {
  ClientEvent,
  ClientMessageInput,
  ClientResponses,
  RoomState,
  SeatInfo,
  WirePlayerView,
} from '@poker/protocol';
import type {
  ClientResult,
  Connection,
  ConnectionStatus,
  ServerUpdate,
} from '../../src/net/connection';

type Handler = (payload: unknown) => ClientResult<unknown>;

/** Зʼєднання для тестів: записує запити й відповідає заданими обробниками. */
export class FakeConnection implements Connection {
  readonly requests: { event: ClientEvent; payload: unknown }[] = [];
  private readonly handlers = new Map<ClientEvent, Handler>();
  private readonly listeners = new Set<(update: ServerUpdate) => void>();

  on<E extends ClientEvent>(
    event: E,
    handler: (payload: ClientMessageInput<E>) => ClientResult<ClientResponses[E]>,
  ): this {
    this.handlers.set(event, handler as Handler);
    return this;
  }

  request<E extends ClientEvent>(
    event: E,
    payload: ClientMessageInput<E>,
  ): Promise<ClientResult<ClientResponses[E]>> {
    this.requests.push({ event, payload });
    const handler = this.handlers.get(event);
    const result = handler ? handler(payload) : { ok: true as const, data: null };
    return Promise.resolve(result as ClientResult<ClientResponses[E]>);
  }

  subscribe(listener: (update: ServerUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Імітує подію сервера. */
  push(update: ServerUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  pushRoom(room: RoomState): void {
    this.push({ type: 'room', room });
  }

  pushView(view: WirePlayerView): void {
    this.push({ type: 'view', view });
  }

  /** Імітує зміну стану зʼєднання (обрив, перепідключення). */
  pushStatus(status: ConnectionStatus): void {
    this.push({ type: 'status', status });
  }

  close(): void {}
}

export const TOKEN = 'token-0123456789abcdef';

export function session(code = 'ABCDE', playerId = 'p1') {
  return { code, token: TOKEN, playerId, link: `/r/${code}` };
}

export function human(id: string, name: string, connected = true): SeatInfo {
  return { id, name, kind: 'human', connected };
}

export function bot(id: string, name: string): SeatInfo {
  return { id, name, kind: 'bot', connected: true };
}

export function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABCDE',
    link: '/r/ABCDE',
    status: 'lobby',
    hostId: 'p1',
    you: 'p1',
    seats: [human('p1', 'Оля')],
    turnTimerSec: null,
    turnDeadline: null,
    options: { dark: false, zeroLimit: false },
    ...overrides,
  };
}
