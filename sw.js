// 서비스 워커: 앱 화면 캐시 + 푸시 알림 표시
// 앱 파일을 수정해서 다시 배포할 때는 아래 버전 숫자를 올려 주세요.
const CACHE = "family-chat-v2";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./calendar.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 같은 사이트 파일만: 네트워크 우선, 오프라인이면 캐시
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html"))),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focused = wins.some((c) => c.focused && c.visibilityState === "visible");
    // iOS는 푸시를 받으면 항상 알림을 띄워야 해서, 앱을 보고 있을 땐 소리 없이만 표시
    await self.registration.showNotification(data.title || "가족 채팅", {
      body: data.body || "새 메시지가 왔어요",
      icon: "./icons/icon-192.png",
      badge: "./icons/badge-96.png",
      tag: data.tag || "family-chat",
      renotify: !focused,
      silent: focused,
      data: { url: data.url || "./" },
    });
    if (!focused && self.navigator.setAppBadge) await self.navigator.setAppBadge().catch(() => {});
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
    }
    return self.clients.openWindow(target);
  })());
});
