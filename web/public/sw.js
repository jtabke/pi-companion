// Bump this version when the public offline document or its assets change.
const CACHE_PREFIX = "pi-companion-offline-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const OFFLINE_ASSETS = ["/offline.html", "/offline.css", "/icon-192.png"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			// Only these public static files are persisted; never send cookies to precache them.
			await cache.addAll(
				OFFLINE_ASSETS.map(
					(path) => new Request(path, { credentials: "omit", cache: "reload" }),
				),
			);
		})(),
	);
	// No skipWaiting: updates must not disrupt a client's uncertain native actions.
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			for (const name of await caches.keys()) {
				if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
					await caches.delete(name);
			}
		})(),
	);
	// Existing pages keep their worker until they close. No forced claim or reload.
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);
	// All APIs (including snapshots, SSE and media) and all mutations go straight to the network.
	if (
		request.method !== "GET" ||
		url.origin !== self.location.origin ||
		url.pathname.startsWith("/api/")
	)
		return;
	if (
		request.mode === "navigate" &&
		(url.pathname === "/" || url.pathname === "/index.html")
	) {
		event.respondWith(
			fetch(request).catch(() =>
				caches.open(CACHE_NAME).then((cache) => cache.match("/offline.html")),
			),
		);
	} else if (!url.search && OFFLINE_ASSETS.includes(url.pathname)) {
		event.respondWith(
			caches
				.open(CACHE_NAME)
				.then(
					async (cache) => (await cache.match(url.pathname)) ?? fetch(request),
				),
		);
	}
	// Never cache the normal app document or any authenticated response. No queues or replay.
});
