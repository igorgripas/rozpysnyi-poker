/**
 * Реєструє service worker (`public/sw.js`) — лише в зібраному застосунку:
 * у режимі розробки кеш заважав би гарячому перезавантаженню.
 */
export function registerServiceWorker(
  enabled: boolean = import.meta.env.PROD,
  container: ServiceWorkerContainer | undefined = navigator.serviceWorker,
): void {
  if (!enabled || container === undefined) return;
  window.addEventListener('load', () => {
    container.register('/sw.js').catch((error: unknown) => {
      console.error('Не вдалося зареєструвати service worker', error);
    });
  });
}
