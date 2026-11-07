import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** public/ の中のファイルの一覧(配信パス) */
function listPublic(dir = 'public'): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  try {
    walk(dir);
  } catch {
    /* public/ がなければ空 */
  }
  return out;
}

/**
 * オフライン用の Service Worker(sw.js)をビルド時に作る。
 * ビルドで出たファイルをすべて事前にキャッシュする。新しい版は「待機」させ、画面の「更新」で切り替える。
 * IndexedDB には触らない(更新でデータは消えない)。同じ配信元以外への通信は扱わない。
 */
function serviceWorker(): Plugin {
  return {
    name: 'meal-app-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      const assets = [...new Set(['./', ...[...files, ...listPublic()].map((f) => `./${f}`)])].sort();
      const h = createHash('sha256');
      for (const f of Object.keys(bundle).sort()) {
        const item = bundle[f];
        if (!item) continue;
        h.update(f);
        h.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      for (const f of listPublic()) h.update(f);
      const version = h.digest('hex').slice(0, 16);
      const source = `// 自動生成(vite.config.ts)。編集しない。
const VERSION = ${JSON.stringify(version)};
const CACHE = 'meal-app-' + VERSION;
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('meal-app-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then((c) => c.match('./index.html')).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((r) => r || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// GitHub Pages ではリポジトリ名のパス(例: /meal-app/)の下で配信される。相対パスにしておけば、どこでも動く。
export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.{ts,mjs}'],
  },
});
