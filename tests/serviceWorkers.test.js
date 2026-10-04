import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, test, expect, vi } from 'vitest';

const cacheName = (filename) =>
  readFileSync(`public/${filename}`, 'utf8').match(
    /const CACHE_NAME = '([^']+)'/,
  )[1];
const publicCache = cacheName('service-worker.js');
const adminCache = cacheName('admin-service-worker.js');

const origin = 'https://bracket.example';

function worker(filename) {
  const handlers = {};
  const assetFetch = vi.fn(async (path) => new Response(path));
  const stores = new Map();
  const key = (request) =>
    new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(request) {
          return entries.get(key(request))?.clone();
        },
        async put(request, response) {
          entries.set(key(request), response.clone());
        },
        async addAll(paths) {
          // Cache.addAll stages the entire batch before committing any entry.
          const responses = await Promise.all(
            paths.map((path) => assetFetch(path)),
          );
          if (responses.some((response) => !response.ok)) {
            throw new TypeError('An asset fetch failed');
          }
          paths.forEach((path, index) =>
            entries.set(key(path), responses[index]),
          );
        },
      };
    },
  };
  const fetch = vi.fn(async () => new Response('current user'));
  const self = {
    location: new URL(origin),
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  runInNewContext(readFileSync(`public/${filename}`, 'utf8'), {
    self,
    caches,
    fetch,
    URL,
    Response,
  });
  return {
    caches,
    assetFetch,
    stores,
    fetch,
    self,
    async lifecycle(type) {
      let pending;
      handlers[type]({
        waitUntil(promise) {
          pending = promise;
        },
      });
      await pending;
    },
    request(path, overrides = {}) {
      const request = {
        url: new URL(path, origin).href,
        method: 'GET',
        mode: 'navigate',
        destination: 'document',
        ...overrides,
      };
      let response;
      handlers.fetch({
        request,
        respondWith(promise) {
          response = promise;
        },
      });
      return response;
    },
  };
}

describe.each([
  ['service-worker.js', publicCache, 'bracket10-v19', adminCache],
  ['admin-service-worker.js', adminCache, 'admin-bracket10-v7', publicCache],
])('%s privacy boundary', (filename, current, legacy, other) => {
  test('install precaches public files, never the session-bearing homepage', async () => {
    const sw = worker(filename);
    await sw.lifecycle('install');
    const entries = sw.stores.get(current);
    expect(entries.has(`${origin}/`)).toBe(false);
    expect(entries.has(`${origin}/offline.html`)).toBe(true);
    expect(entries.has(`${origin}/style.css`)).toBe(true);
    for (const url of entries.keys()) {
      expect(() =>
        readFileSync(`public${new URL(url).pathname}`),
      ).not.toThrow();
    }
  });

  test.each(['404', 'network rejection'])(
    'a precache %s rejects installation without skipping waiting or deleting legacy data',
    async (failure) => {
      const sw = worker(filename);
      const oldCache = await sw.caches.open(legacy);
      await oldCache.put('/my-brackets', new Response('old personal data'));
      sw.assetFetch.mockImplementation(async (path) => {
        if (path === '/style.css') {
          if (failure === '404')
            return new Response('missing', { status: 404 });
          throw new TypeError('Network failure');
        }
        return new Response(path);
      });

      await expect(sw.lifecycle('install')).rejects.toThrow();
      expect(sw.assetFetch).toHaveBeenCalledWith('/style.css');
      expect(sw.stores.get(current).size).toBe(0);
      expect(sw.self.skipWaiting).not.toHaveBeenCalled();
      expect(sw.self.clients.claim).not.toHaveBeenCalled();
      expect(await (await oldCache.match('/my-brackets')).text()).toBe(
        'old personal data',
      );
    },
  );

  test('activation deletes legacy personal data but preserves the other PWA and unrelated caches', async () => {
    const sw = worker(filename);
    for (const name of [legacy, current, other, 'unrelated']) {
      const cache = await sw.caches.open(name);
      await cache.put('/my-brackets', new Response('old personal data'));
    }
    await sw.lifecycle('activate');
    expect(await sw.caches.keys()).toEqual([current, other, 'unrelated']);
    expect(sw.self.clients.claim).toHaveBeenCalledOnce();
  });

  test.each([
    '/',
    '/my-brackets',
    '/my-brackets/edit?entryId=123',
    '/my-entry',
    '/updates',
    '/admin/entries',
    '/entryConfirm?token=abc',
    '/new-private-route',
  ])('never stores or replays %s across sessions', async (path) => {
    const sw = worker(filename);
    await sw.lifecycle('install');
    const legacyCache = await sw.caches.open(legacy);
    await legacyCache.put(
      path,
      new Response('previous user email and CSRF token'),
    );
    expect(await (await sw.request(path)).text()).toBe('current user');
    expect(sw.fetch).toHaveBeenCalledWith(expect.any(Object), {
      cache: 'no-store',
    });
    expect(sw.stores.get(current).has(new URL(path, origin).href)).toBe(false);
    // Simulate sign-out followed by a network failure on a shared browser.
    sw.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await sw.request(path)).text()).toBe('/offline.html');
  });

  test.each(['/api/private', '/admin/export.png', '/style.css?personal=1'])(
    'does not mistake %s for a public asset or replay API data',
    async (path) => {
      const sw = worker(filename);
      await sw.lifecycle('install');
      const options = { mode: 'cors', destination: 'image' };
      await sw.request(path, options);
      expect(sw.stores.get(current).has(new URL(path, origin).href)).toBe(
        false,
      );
      sw.fetch.mockRejectedValue(new Error('offline'));
      await expect(sw.request(path, options)).rejects.toThrow('offline');
    },
  );

  test('cached styles remain available offline using only this PWA cache', async () => {
    const sw = worker(filename);
    await sw.lifecycle('install');
    sw.fetch.mockRejectedValue(new Error('offline'));
    expect(
      await (
        await sw.request('/style.css', { mode: 'cors', destination: 'style' })
      ).text(),
    ).toBe('/style.css');
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  test.each(['private, max-age=300', 'no-store', 'no-cache'])(
    'honors %s even for an allowed asset',
    async (control) => {
      const sw = worker(filename);
      sw.fetch.mockResolvedValue(
        new Response('restricted', { headers: { 'Cache-Control': control } }),
      );
      await sw.request('/style.css', { mode: 'cors', destination: 'style' });
      expect(sw.stores.get(current).size).toBe(0);
    },
  );

  test('does not store redirected asset responses', async () => {
    const sw = worker(filename);
    const response = new Response('sign-in page');
    Object.defineProperty(response, 'redirected', { value: true });
    sw.fetch.mockResolvedValue(response);
    await sw.request('/style.css', { mode: 'cors', destination: 'style' });
    expect(sw.stores.get(current).size).toBe(0);
  });

  test('stores successful public asset misses', async () => {
    const sw = worker(filename);
    await sw.request('/style.css', { mode: 'cors', destination: 'style' });
    expect(sw.stores.get(current).has(`${origin}/style.css`)).toBe(true);
  });

  test('a missing offline page fails closed instead of searching another cache', async () => {
    const sw = worker(filename);
    const cache = await sw.caches.open(other);
    await cache.put('/my-brackets', new Response('another user'));
    sw.fetch.mockRejectedValue(new Error('offline'));
    expect((await sw.request('/my-brackets')).type).toBe('error');
  });

  test('leaves POSTs and cross-origin requests to the browser', () => {
    const sw = worker(filename);
    expect(sw.request('/user/logout', { method: 'POST' })).toBeUndefined();
    expect(sw.request('https://other.example/file.css')).toBeUndefined();
    expect(sw.fetch).not.toHaveBeenCalled();
  });
});
