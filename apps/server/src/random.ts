import { randomBytes, randomInt } from 'node:crypto';

/** Джерело випадковості сервера: коди кімнат, токени, перемішування місць і seed гри. */
export interface RandomSource {
  /** Ціле від 0 (включно) до `max` (не включно). */
  int(max: number): number;
  /** Секретний токен гравця. */
  token(): string;
  /** Публічний ідентифікатор гравця. */
  id(): string;
}

/** Криптографічно стійке джерело для продакшену. */
export const cryptoRandom: RandomSource = {
  int: (max) => randomInt(max),
  token: () => randomBytes(24).toString('base64url'),
  id: () => randomBytes(9).toString('base64url'),
};
