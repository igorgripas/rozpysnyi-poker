/**
 * Адреса сервера: VITE_SERVER_URL або той самий хост (`undefined`, dev-проксі Vite).
 * У режимі розробки e2e-тести можуть підставити власний сервер параметром `?server=`.
 */
export function serverUrl(
  search: string,
  { dev, configured }: { dev: boolean; configured: string | undefined },
): string | undefined {
  const override = dev ? new URLSearchParams(search).get('server') : null;
  return override || configured || undefined;
}
