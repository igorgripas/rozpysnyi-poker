import { PROTOCOL_VERSION } from '@poker/protocol';

/** Версія клієнта, для якої сторінку вже перезавантажували через нову версію сервера. */
export const RELOAD_STORAGE_KEY = 'poker.reloadedForVersion';

/**
 * Сервер перейшов на нову версію протоколу: перезавантажує сторінку, щоб отримати новий
 * клієнт. Токен гравця лежить у localStorage і переживає перезавантаження. Якщо після
 * перезавантаження версія клієнта та сама (новий клієнт ще не викладено), вдруге не
 * перезавантажує — щоб не зациклитися; тоді лишається кнопка «Оновити».
 */
export function reloadForNewVersion(
  storage: Storage,
  reload: () => void,
  version: number = PROTOCOL_VERSION,
): boolean {
  if (storage.getItem(RELOAD_STORAGE_KEY) === String(version)) return false;
  storage.setItem(RELOAD_STORAGE_KEY, String(version));
  reload();
  return true;
}

/**
 * Будить сервер, що заснув на хостингу: простий запит `/health` одразу під час відкриття
 * сторінки, ще до підключення сокета. Відповідь не читаємо (інше джерело — `no-cors`).
 */
export async function wakeServer(
  url: string | undefined,
  fetcher: (input: string, init: RequestInit) => Promise<unknown> = fetch,
): Promise<void> {
  try {
    await fetcher(`${url ?? ''}/health`, { mode: 'no-cors', cache: 'no-store' });
  } catch {
    // Сервер ще спить або мережі немає: сокет усе одно перепідключатиметься.
  }
}
