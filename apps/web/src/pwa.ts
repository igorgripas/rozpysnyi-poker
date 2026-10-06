import type { AppUpdates } from './update';

/**
 * Реєструє service worker (`public/sw.js`) — лише в зібраному застосунку:
 * у режимі розробки кеш заважав би гарячому перезавантаженню.
 * `updates` стежить, чи не вийшла нова версія застосунку.
 */
export function registerServiceWorker(
  enabled: boolean = import.meta.env.PROD,
  container: ServiceWorkerContainer | undefined = navigator.serviceWorker,
  updates?: AppUpdates,
): void {
  if (!enabled || container === undefined) return;
  window.addEventListener('load', () => {
    container
      .register('/sw.js')
      .then((registration) => updates?.watch(registration, container))
      .catch((error: unknown) => {
        console.error('Не вдалося зареєструвати service worker', error);
      });
  });
}
