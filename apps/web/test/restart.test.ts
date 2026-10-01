import { PROTOCOL_VERSION } from '@poker/protocol';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_STORAGE_KEY } from '../src/net/client';
import { RELOAD_STORAGE_KEY, reloadForNewVersion, wakeServer } from '../src/net/restart';

describe('безперервність гри: нова версія й засинання сервера (T55)', () => {
  it('нова версія протоколу: сторінка перезавантажується один раз, токен лишається', () => {
    sessionStorage.clear();
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ code: 'ABCDE', token: 't' }));
    const reload = vi.fn();
    expect(reloadForNewVersion(sessionStorage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(RELOAD_STORAGE_KEY)).toBe(String(PROTOCOL_VERSION));
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(
      JSON.stringify({ code: 'ABCDE', token: 't' }),
    );

    // Після перезавантаження клієнт тієї ж версії: не зациклюємося, показуємо кнопку.
    expect(reloadForNewVersion(sessionStorage, reload)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('під час відкриття сторінка будить сервер запитом /health', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response()));
    wakeServer('https://api.poker.test', fetcher);
    expect(fetcher).toHaveBeenCalledWith('https://api.poker.test/health', {
      mode: 'no-cors',
      cache: 'no-store',
    });
    wakeServer(undefined, fetcher);
    expect(fetcher).toHaveBeenLastCalledWith('/health', { mode: 'no-cors', cache: 'no-store' });

    // Сервер ще спить — помилка мережі не виходить назовні.
    const failing = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(wakeServer(undefined, failing)).resolves.toBeUndefined();
  });
});
