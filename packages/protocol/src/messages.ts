import { MAX_PLAYERS } from '@poker/engine';
import { z } from 'zod';
import { cardSchema, jokerCallSchema, playerViewSchema, seatSchema } from './game.js';
import { PROTOCOL_VERSION } from './version.js';

/** Рукостискання: клієнт передає його в `auth` під час підключення Socket.IO. */
export const handshakeSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

/** Символи коду кімнати: без схожих 0/O, 1/I. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const PLAYER_NAME_MAX_LENGTH = 20;

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(ROOM_CODE_LENGTH)
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`));

export const playerNameSchema = z.string().trim().min(1).max(PLAYER_NAME_MAX_LENGTH);

/** Секретний токен гравця: клієнт зберігає його (localStorage) і повертається з ним у кімнату. */
export const tokenSchema = z.string().min(16).max(128);

export const playerIdSchema = z.string().min(1).max(64);

/** Межі таймера ходу, секунди (R-9.3). */
export const TURN_TIMER_MIN_SEC = 5;
export const TURN_TIMER_MAX_SEC = 300;

/** Таймер ходу (R-9.3): `null` — вимкнений (за замовчуванням), інакше секунди на хід. */
export const turnTimerSchema = z
  .number()
  .int()
  .min(TURN_TIMER_MIN_SEC)
  .max(TURN_TIMER_MAX_SEC)
  .nullable();

// ── Клієнт → сервер ────────────────────────────────────────────────────────────

export const createRoomRequestSchema = z.strictObject({ name: playerNameSchema });
export const joinRoomRequestSchema = z.strictObject({
  code: roomCodeSchema,
  name: playerNameSchema,
});
export const resumeRequestSchema = z.strictObject({ code: roomCodeSchema, token: tokenSchema });
export const emptyRequestSchema = z.strictObject({});
export const removeBotRequestSchema = z.strictObject({ seat: seatSchema });
/** Хост віддає місце відключеного гравця боту (R-9.3). */
export const replaceWithBotRequestSchema = z.strictObject({ seat: seatSchema });
/** Налаштування кімнати, які хост змінює до старту (R-9.3). */
export const roomSettingsRequestSchema = z.strictObject({ turnTimerSec: turnTimerSchema });
/** Замовлення (R-4.3); місце визначає сервер за сесією. */
export const bidRequestSchema = z.strictObject({ bid: z.number().int().min(0) });
/** Хід картою; оголошення — лише для джокера (§6). Місце визначає сервер. */
export const playRequestSchema = z.strictObject({
  card: cardSchema,
  call: jokerCallSchema.optional(),
});

/** Схеми корисного навантаження всіх подій клієнта. */
export const clientMessageSchemas = {
  'room:create': createRoomRequestSchema,
  'room:join': joinRoomRequestSchema,
  'room:resume': resumeRequestSchema,
  'room:addBot': emptyRequestSchema,
  'room:removeBot': removeBotRequestSchema,
  'room:shuffle': emptyRequestSchema,
  'room:settings': roomSettingsRequestSchema,
  'room:start': emptyRequestSchema,
  'room:replaceWithBot': replaceWithBotRequestSchema,
  'game:bid': bidRequestSchema,
  'game:play': playRequestSchema,
} as const;

export type ClientEvent = keyof typeof clientMessageSchemas;
export const CLIENT_EVENTS = Object.keys(clientMessageSchemas) as ClientEvent[];
export type ClientMessage<E extends ClientEvent> = z.output<(typeof clientMessageSchemas)[E]>;
export type ClientMessageInput<E extends ClientEvent> = z.input<(typeof clientMessageSchemas)[E]>;

// ── Сервер → клієнт ────────────────────────────────────────────────────────────

/** Сесія гравця в кімнаті: відповідь на create/join/resume. */
export const sessionSchema = z.strictObject({
  code: roomCodeSchema,
  token: tokenSchema,
  playerId: playerIdSchema,
  /** Посилання-запрошення в кімнату. */
  link: z.string().min(1),
});

export const seatInfoSchema = z.strictObject({
  id: playerIdSchema,
  name: playerNameSchema,
  kind: z.enum(['human', 'bot']),
  connected: z.boolean(),
});

export const roomStatusSchema = z.enum(['lobby', 'playing', 'finished']);

/** Стан кімнати для конкретного гравця; місця — у порядку гри (R-9.1). */
export const roomStateSchema = z.strictObject({
  code: roomCodeSchema,
  link: z.string().min(1),
  status: roomStatusSchema,
  hostId: playerIdSchema,
  /** Хто отримує цей стан. */
  you: playerIdSchema,
  seats: z.array(seatInfoSchema).max(MAX_PLAYERS),
  /** Таймер ходу (R-9.3). */
  turnTimerSec: turnTimerSchema,
  /** Коли сплине час поточного ходу (мс від епохи Unix) або `null`, якщо таймер не йде. */
  turnDeadline: z.number().int().nonnegative().nullable(),
});

export const ERROR_CODES = [
  'badRequest',
  'versionMismatch',
  'roomNotFound',
  'roomFull',
  'badToken',
  'notInRoom',
  'notHost',
  'alreadyStarted',
  'notStarted',
  'notEnoughPlayers',
  'illegalAction',
  'playerConnected',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const protocolErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string(),
});
export type ProtocolError = z.infer<typeof protocolErrorSchema>;

/** Результат запиту (Socket.IO ack). */
export type Result<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ProtocolError };

export type Session = z.infer<typeof sessionSchema>;
export type SeatInfo = z.infer<typeof seatInfoSchema>;
export type RoomStatus = z.infer<typeof roomStatusSchema>;
export type RoomState = z.infer<typeof roomStateSchema>;

/** Дані успішної відповіді на кожну подію клієнта. */
export interface ClientResponses {
  'room:create': Session;
  'room:join': Session;
  'room:resume': Session;
  'room:addBot': null;
  'room:removeBot': null;
  'room:shuffle': null;
  'room:settings': null;
  'room:start': null;
  'room:replaceWithBot': null;
  'game:bid': null;
  'game:play': null;
}

/** Схеми подій сервера. */
export const serverMessageSchemas = {
  'room:state': roomStateSchema,
  'game:view': playerViewSchema,
} as const;

export type ServerEvent = keyof typeof serverMessageSchemas;
export type ServerMessage<E extends ServerEvent> = z.output<(typeof serverMessageSchemas)[E]>;

/** Типи подій для `socket.io` (клієнт → сервер): payload і ack з результатом. */
export type ClientToServerEvents = {
  [E in ClientEvent]: (
    payload: ClientMessageInput<E>,
    ack: (result: Result<ClientResponses[E]>) => void,
  ) => void;
};

/** Типи подій для `socket.io` (сервер → клієнт). */
export type ServerToClientEvents = {
  [E in ServerEvent]: (payload: ServerMessage<E>) => void;
};

/** Валідує payload події клієнта; помилка — `badRequest` з описом від zod. */
export function parseClientMessage<E extends ClientEvent>(
  event: E,
  payload: unknown,
): Result<ClientMessage<E>> {
  const parsed = clientMessageSchemas[event].safeParse(payload);
  if (parsed.success) return { ok: true, data: parsed.data as ClientMessage<E> };
  return { ok: false, error: { code: 'badRequest', message: z.prettifyError(parsed.error) } };
}
