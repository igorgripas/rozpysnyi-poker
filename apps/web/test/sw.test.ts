import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { stampServiceWorker } from '../src/swVersion';

const ORIGIN = 'https://poker.example';
const source = readFileSync(join(import.meta.dirname, '../public/sw.js'), 'utf8');

type Listener = (event: unknown) => void;

/** Запускає sw.js у пісочниці з підмінами кешу й мережі. */
function loadWorker(
  network: (url: string) => Response | Promise<Response>,
  { active = false }: { active?: boolean } = {},
) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: Request | string) =>
    new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
  const open = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      addAll: async (urls: string[]) => {
        for (const url of urls) store.set(key(url), await network(key(url)));
      },
      put: (request: Request | string, response: Response) => {
        store.set(key(request), response);
        return Promise.resolve();
      },
      match: (request: Request | string) => Promise.resolve(store.get(key(request))?.clone()),
    };
  };
  const caches = {
    open: (name: string) => Promise.resolve(open(name)),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  };
  const fetch = vi.fn((request: Request | string) => Promise.resolve(network(key(request))));
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(() => Promise.resolve()),
    // Попередня версія вже керує сторінками — нова чекає на згоду гравця.
    registration: { active: active ? {} : null },
    clients: { claim: () => Promise.resolve() },
  };
  runInNewContext(source, { self, caches, fetch, URL, Response, Request, Promise, console });

  async function lifecycle(type: 'install' | 'activate') {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
    await done;
  }

  /** Подія fetch: `undefined`, якщо service worker її не перехоплює. */
  function request(path: string, init: { mode?: string; method?: string } = {}) {
    let response: Promise<Response> | undefined;
    const req = {
      url: new URL(path, ORIGIN).href,
      method: init.method ?? 'GET',
      mode: init.mode ?? 'cors',
    };
    listeners.get('fetch')?.({
      request: req,
      respondWith: (promise: Promise<Response>) => (response = promise),
    });
    return response;
  }

  /** Повідомлення від сторінки. */
  function message(data: unknown) {
    listeners.get('message')?.({ data });
  }

  return { lifecycle, request, message, fetch, stores, skipWaiting: self.skipWaiting };
}

const page = (body: string) => new Response(body, { status: 200 });

describe('service worker', () => {
  it('без мережі відкриває застосунок із кешу, зокрема за посиланням на кімнату', async () => {
    let online = true;
    const worker = loadWorker((url) => {
      if (!online) throw new TypeError('Failed to fetch');
      return page(`мережа ${new URL(url).pathname}`);
    });
    await worker.lifecycle('install');
    await worker.lifecycle('activate');
    online = false;
    const response = await worker.request('/r/ABCDE', { mode: 'navigate' });
    expect(await response?.text()).toBe('мережа /');
  });

  it('з мережею сторінка береться з мережі й оновлює кеш', async () => {
    let version = 1;
    let online = true;
    const worker = loadWorker(() => {
      if (!online) throw new TypeError('Failed to fetch');
      return page(`версія ${version}`);
    });
    await worker.lifecycle('install');
    version = 2;
    expect(await (await worker.request('/', { mode: 'navigate' }))?.text()).toBe('версія 2');
    online = false;
    expect(await (await worker.request('/', { mode: 'navigate' }))?.text()).toBe('версія 2');
  });

  it('зібрані файли з хешем беруться з кешу без повторного запиту', async () => {
    const worker = loadWorker((url) => page(new URL(url).pathname));
    await worker.request('/assets/index-abc123.js');
    await Promise.resolve();
    worker.fetch.mockClear();
    const cached = await worker.request('/assets/index-abc123.js');
    expect(await cached?.text()).toBe('/assets/index-abc123.js');
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it('не перехоплює Socket.IO, чужі адреси й не-GET запити', () => {
    const worker = loadWorker((url) => page(url));
    expect(worker.request('/socket.io/?EIO=4&transport=polling')).toBeUndefined();
    expect(worker.request('https://other.example/x.js')).toBeUndefined();
    expect(worker.request('/api', { method: 'POST' })).toBeUndefined();
  });

  it('під час активації видаляє старі версії кешу', async () => {
    const worker = loadWorker((url) => page(url));
    worker.stores.set('poker-old', new Map());
    await worker.lifecycle('install');
    await worker.lifecycle('activate');
    expect([...worker.stores.keys()]).toHaveLength(1);
    expect(worker.stores.has('poker-old')).toBe(false);
  });

  it('перша версія активується одразу', async () => {
    const worker = loadWorker((url) => page(url));
    await worker.lifecycle('install');
    expect(worker.skipWaiting).toHaveBeenCalled();
  });

  it('нова версія чекає, доки гравець не натисне «Оновити»', async () => {
    const worker = loadWorker((url) => page(url), { active: true });
    await worker.lifecycle('install');
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    worker.message({ type: 'other' });
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    worker.message({ type: 'skipWaiting' });
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it('назва кешу залежить від збірки: нова версія не бере старі файли', () => {
    expect(source).toContain("const VERSION = 'dev';");
    const stamped = stampServiceWorker(source, 'abc123');
    expect(stamped).toContain("const VERSION = 'abc123';");
    expect(stamped).not.toContain("const VERSION = 'dev';");
    expect(() => stampServiceWorker('const CACHE = 1;', 'abc123')).toThrow();
  });
});
