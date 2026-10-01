import { describe, expect, it } from 'vitest';
import { isTransientError, withRetry } from '../src/retry.js';

function failure(props: Record<string, unknown>, message = 'збій'): Error {
  return Object.assign(new Error(message), props);
}

describe('повторні спроби (холодний старт Neon)', () => {
  it('тимчасові помилки зʼєднання повторюються з наростаючою затримкою до успіху', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 4) return Promise.reject(failure({ code: 'ECONNREFUSED' }));
        return Promise.resolve('ok');
      },
      {
        attempts: 6,
        delayMs: 100,
        maxDelayMs: 300,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(4);
    expect(delays).toEqual([100, 200, 300]);
  });

  it('після вичерпання спроб кидає останню помилку', async () => {
    let calls = 0;
    const error = failure({ code: '57P03' }, 'the database system is starting up');
    await expect(
      withRetry(
        () => {
          calls++;
          return Promise.reject(error);
        },
        { attempts: 3, delayMs: 1, sleep: () => Promise.resolve() },
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(3);
  });

  it('нетимчасова помилка (напр. синтаксис SQL) не повторюється', async () => {
    let calls = 0;
    const error = failure({ code: '42601' });
    await expect(
      withRetry(
        () => {
          calls++;
          return Promise.reject(error);
        },
        { attempts: 5, delayMs: 1, sleep: () => Promise.resolve() },
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('розпізнає тимчасові помилки мережі й Postgres', () => {
    for (const code of [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      '57P01',
      '57P03',
      '53300',
      '08006',
    ]) {
      expect(isTransientError(failure({ code })), code).toBe(true);
    }
    expect(isTransientError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientError(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isTransientError(failure({ code: '23505' }))).toBe(false);
    expect(isTransientError('рядок')).toBe(false);
  });
});
