/** Налаштування повторних спроб. */
export interface RetryOptions {
  /** Скільки всього спроб (разом із першою). */
  attempts?: number;
  /** Затримка перед другою спробою, мс; далі подвоюється. */
  delayMs?: number;
  /** Найбільша затримка між спробами, мс. */
  maxDelayMs?: number;
  /** Очікування між спробами (у тестах — миттєве). */
  sleep?: (ms: number) => Promise<void>;
  /** Сповіщення перед кожною повторною спробою. */
  onRetry?: (error: unknown, attempt: number) => void;
}

/** Мережеві коди Node і класи помилок Postgres, після яких варто спробувати ще раз. */
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // admin_shutdown, crash_shutdown, cannot_connect_now: база зупиняється або прокидається.
  '57P01',
  '57P02',
  '57P03',
  // too_many_connections.
  '53300',
]);

const TRANSIENT_MESSAGES = [
  'Connection terminated',
  'timeout exceeded when trying to connect',
  'Connection ended unexpectedly',
];

/**
 * Чи тимчасова помилка: мережа, «холодний» старт Neon (база прокидається до кількох секунд),
 * обрив зʼєднання (клас 08). Помилки запиту (синтаксис, обмеження) не повторюються.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && (TRANSIENT_CODES.has(code) || code.startsWith('08'))) return true;
  return TRANSIENT_MESSAGES.some((message) => error.message.includes(message));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Виконує `fn`, повторюючи її після тимчасових помилок з експоненційною затримкою. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 8;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const sleep = options.sleep ?? wait;
  let delay = options.delayMs ?? 250;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isTransientError(error)) throw error;
      options.onRetry?.(error, attempt);
      await sleep(Math.min(delay, maxDelayMs));
      delay *= 2;
    }
  }
}
