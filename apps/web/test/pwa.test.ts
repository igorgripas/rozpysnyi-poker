import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/pwa';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

describe('PWA: встановлення на телефон', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, unknown>;
  const icons = manifest.icons as ManifestIcon[];

  it('маніфест описує застосунок українською і відкриває його як окремий застосунок', () => {
    expect(manifest).toMatchObject({
      name: 'Розписний покер',
      short_name: 'Покер',
      lang: 'uk',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('є PNG-іконки 192 і 512 px та маскувальна іконка, і всі файли існують', () => {
    const png = icons.filter((icon) => icon.type === 'image/png');
    expect(png.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of icons) expect(existsSync(`${root}/public${icon.src}`)).toBe(true);
  });

  it('index.html підключає маніфест, іконки й налаштування для iOS', () => {
    const html = read('index.html');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/[^"]+\.png" \/>/);
    expect(html).toMatch(/<link rel="icon" href="\/icons\/icon\.svg" type="image\/svg\+xml" \/>/);
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain(`<meta name="theme-color" content="${String(manifest.theme_color)}" />`);
    for (const [, href] of html.matchAll(/href="(\/icons\/[^"]+)"/g)) {
      expect(existsSync(`${root}/public${href}`)).toBe(true);
    }
  });
});

describe('PWA: service worker', () => {
  function container() {
    return { register: vi.fn(() => Promise.resolve({})) };
  }

  it('у зібраному застосунку реєструє /sw.js після завантаження сторінки', () => {
    const sw = container();
    registerServiceWorker(true, sw as unknown as ServiceWorkerContainer);
    expect(sw.register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    expect(sw.register).toHaveBeenCalledWith('/sw.js');
  });

  it('у режимі розробки й без підтримки service worker нічого не робить', () => {
    const sw = container();
    registerServiceWorker(false, sw as unknown as ServiceWorkerContainer);
    registerServiceWorker(true, undefined);
    window.dispatchEvent(new Event('load'));
    expect(sw.register).not.toHaveBeenCalled();
  });
});
