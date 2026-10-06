/** Рядок у `public/sw.js`, куди збірка підставляє свою версію. */
const VERSION_LINE = "const VERSION = 'dev';";

/**
 * Підставляє версію збірки в service worker: з кожним деплоєм sw.js змінюється, тож браузер
 * помічає нову версію (`updatefound`), а кеш оболонки має нову назву.
 */
export function stampServiceWorker(source: string, version: string): string {
  if (!source.includes(VERSION_LINE)) {
    throw new Error(`У sw.js немає рядка ${VERSION_LINE}`);
  }
  return source.replace(VERSION_LINE, `const VERSION = '${version}';`);
}
