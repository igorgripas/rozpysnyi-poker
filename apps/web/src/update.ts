import { useSyncExternalStore } from 'react';

export interface UpdateState {
  /** Нова версія застосунку встановилася й чекає, поки гравець натисне «Оновити». */
  readonly available: boolean;
}

/**
 * Оновлення застосунку через service worker: нова версія (`updatefound`) спершу чекає, а після
 * «Оновити» активується (`skipWaiting`), бере сторінку під контроль (`controllerchange`),
 * і сторінка перезавантажується. Без нової версії «Оновити» просто перезавантажує сторінку —
 * так само для несумісної версії протоколу (`outdated`).
 */
export class AppUpdates {
  private state: UpdateState = { available: false };
  private readonly listeners = new Set<() => void>();
  private waiting: ServiceWorker | null = null;
  private applying = false;

  constructor(private readonly reload: () => void = () => window.location.reload()) {}

  getState = (): UpdateState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Стежить за реєстрацією service worker: чи не встановилася нова версія. */
  watch(registration: ServiceWorkerRegistration, container: ServiceWorkerContainer): void {
    // Без контролера це перше встановлення, а не оновлення.
    const ready = (worker: ServiceWorker | null) => {
      if (worker !== null && container.controller !== null) this.found(worker);
    };
    ready(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') ready(worker);
      });
    });
    container.addEventListener('controllerchange', () => {
      if (!this.applying) return;
      this.applying = false;
      this.reload();
    });
    // Гра — довга сесія на одній сторінці: перевіряємо оновлення, коли гравець повертається.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => undefined);
    });
  }

  /** «Оновити»: активує нову версію (сторінка перезавантажиться після зміни контролера). */
  apply(): void {
    // Нову версію вже активувала інша вкладка: досить перезавантажити сторінку.
    if (this.waiting?.state !== 'installed') {
      this.reload();
      return;
    }
    this.applying = true;
    this.waiting.postMessage({ type: 'skipWaiting' });
  }

  private found(worker: ServiceWorker): void {
    this.waiting = worker;
    this.state = { available: true };
    for (const listener of this.listeners) listener();
  }
}

/** Стан оновлення для компонентів. */
export function useAppUpdate(updates: AppUpdates): UpdateState {
  return useSyncExternalStore(updates.subscribe, updates.getState);
}
