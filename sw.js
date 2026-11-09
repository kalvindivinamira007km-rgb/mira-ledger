// Mira Ledger service worker: works offline; updates arrive the next time the app opens.
// Raise CACHE whenever core.js, app.js or styles.css change.
const CACHE = "mira-v2-17";
const CORE = ["./", "./index.html", "./styles.css", "./core.js", "./app.js", "./manifest.webmanifest", "./vendor/font/figtree.woff2", "./vendor/font/archivo.woff2", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && !k.startsWith("mira-ocr")).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put("./index.html", c)); return res; }).catch(() => caches.match("./index.html")));
    return;
  }
  // The receipt reader is large, so it downloads on first use and is kept across app updates.
  const store = url.pathname.includes("/vendor/ocr/") ? "mira-ocr-1" : CACHE;
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(store).then(x => x.put(r, c)); } return res; })));
});
