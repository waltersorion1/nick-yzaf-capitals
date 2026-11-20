// Public allowlist only. Never cache the root document, API, or authenticated responses.
const CACHE = "nycap-public-v1";
const PUBLIC = [
  "/offline.html",
  "/assets/bootstrap-5.3.9.min.css",
  "/assets/shell-v1.css",
  "/assets/app-v1.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC))),
);
self.addEventListener("message", (event) => {
  if (event.data === "ACTIVATE") self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("nycap-public-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() =>
        caches.match("/offline.html"),
      ),
    );
    return;
  }
  if (PUBLIC.includes(url.pathname) && !url.search)
    event.respondWith(
      caches
        .match(event.request)
        .then((hit) => hit || fetch(event.request, { cache: "no-store" })),
    );
});
