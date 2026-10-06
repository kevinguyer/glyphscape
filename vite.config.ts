import { defineConfig, type Plugin } from 'vite';

/**
 * Emits sw.js with a precache list of every built asset, so the app works offline after the
 * first visit (installable PWA, no runtime dependencies).
 */
function serviceWorker(): Plugin {
  return {
    name: 'glyphscape-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const assets = ['./', ...files.map((f) => `./${f}`), './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
      const version = Date.now().toString(36);
      const source = `// Generated at build time.
const CACHE = 'glyphscape-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./'))),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: [serviceWorker()],
});
