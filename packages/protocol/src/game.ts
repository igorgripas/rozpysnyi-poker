import { MAX_PLAYERS, MIN_PLAYERS, RANKS, SUITS } from '@poker/engine';
import { z } from 'zod';

// Схеми відображають типи рушія (`@poker/engine`) у тому вигляді, в якому вони йдуть мережею (JSON).
// Обʼєкти суворі: зайве поле — помилка, тож розбіжність із рушієм ловлять тести.

export const suitSchema = z.enum(SUITS);

/** Ранги R-1.1: 6…10, В=11, Д=12, К=13, Т=14. */
export const rankSchema = z.union(RANKS.map((rank) => z.literal(rank)));

export const standardCardSchema = z.strictObject({
  kind: z.literal('standard'),
  suit: suitSchema,
  rank: rankSchema,
});

export const jokerCardSchema = z.strictObject({
  kind: z.literal('joker'),
  index: z.union([z.literal(0), z.literal(1)]),
});

/** Карта колоди (R-1.1): 36 звичайних + 2 джокери. */
export const cardSchema = z.discriminatedUnion('kind', [standardCardSchema, jokerCardSchema]);

/** Оголошення джокера (R-6.1–R-6.5). */
export const jokerCallSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('highTrump') }),
  z.strictObject({ type: z.literal('high'), suit: suitSchema }),
  z.strictObject({ type: z.literal('low'), suit: suitSchema }),
  z.strictObject({ type: z.literal('take') }),
  z.strictObject({ type: z.literal('discard') }),
]);

/** Карта у взятці: звичайна або джокер з оголошенням. */
export const trickCardSchema = z.discriminatedUnion('kind', [
  standardCardSchema,
  jokerCardSchema.extend({ call: jokerCallSchema }),
]);

export const seatSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_PLAYERS - 1);
export const playerCountSchema = z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS);
const countSchema = z.number().int().min(0);

/** Дія рушія (з місцем гравця). */
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bid'), seat: seatSchema, bid: countSchema }),
  z.strictObject({
    type: z.literal('play'),
    seat: seatSchema,
    card: cardSchema,
    call: jokerCallSchema.optional(),
  }),
]);

/** Етапи гри R-2.1. */
export const handPhaseSchema = z.enum([
  'ascending',
  'maximum',
  'suits',
  'noTrump',
  'misere',
  'comeback',
]);

export const trumpRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('revealed') }),
  z.strictObject({ kind: z.literal('fixed'), suit: suitSchema }),
  z.strictObject({ kind: z.literal('none') }),
]);

export const handSpecSchema = z.strictObject({
  index: countSchema,
  phase: handPhaseSchema,
  cards: z.number().int().min(1),
  trump: trumpRuleSchema,
  bidding: z.boolean(),
});

/** Клітинка таблиці (R-8.2, R-8.3). */
export const scoreCellSchema = z.strictObject({
  bid: countSchema.nullable(),
  taken: countSchema,
  points: z.number().int().nullable(),
  total: z.number().int().nullable(),
  circles: z.number().int().min(0).max(2).nullable(),
});

/** Рядок таблиці (R-8.1). */
export const scoreRowSchema = z.strictObject({
  number: z.number().int().min(1),
  phase: handPhaseSchema,
  cards: z.number().int().min(1),
  trump: suitSchema.nullable(),
  dealer: seatSchema,
  players: z.array(scoreCellSchema),
});

/** Підсумок під таблицею (R-8.4). */
export const scoreSummarySchema = z.strictObject({
  total: z.number().int(),
  circles: countSchema,
  penalty: z.number().int().max(0),
  final: z.number().int(),
});

export const scoreTableSchema = z.strictObject({
  rows: z.array(scoreRowSchema),
  summary: z.array(scoreSummarySchema),
});

export const completedTrickSchema = z.strictObject({
  leader: seatSchema,
  cards: z.array(trickCardSchema),
  winner: seatSchema,
});

export const gameStatusSchema = z.enum(['bidding', 'playing', 'finished']);

/** Погляд гравця (`viewFor`): лише власна рука й публічні дані. */
export const playerViewSchema = z.strictObject({
  seat: seatSchema,
  playerCount: playerCountSchema,
  status: gameStatusSchema,
  turn: seatSchema.nullable(),
  spec: handSpecSchema,
  dealer: seatSchema,
  trump: suitSchema.nullable(),
  revealed: cardSchema.nullable(),
  hand: z.array(cardSchema),
  handSizes: z.array(countSchema),
  bids: z.array(countSchema.nullable()),
  bidSum: countSchema,
  forbiddenBid: countSchema.nullable(),
  taken: z.array(countSchema),
  leader: seatSchema,
  trick: z.array(trickCardSchema),
  lastTrick: completedTrickSchema.nullable(),
  table: scoreTableSchema,
  legalActions: z.array(actionSchema),
});

export type WireCard = z.infer<typeof cardSchema>;
export type WireJokerCall = z.infer<typeof jokerCallSchema>;
export type WireAction = z.infer<typeof actionSchema>;
export type WirePlayerView = z.infer<typeof playerViewSchema>;
