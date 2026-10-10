// 서비스 워커: 앱 화면 캐시 + 푸시 알림 표시
// 앱 파일을 수정해서 다시 배포할 때는 아래 버전 숫자를 올려 주세요.
const CACHE = "family-chat-v7";
// 받은 사진은 여기에 보관해서 다시 내려받지 않아요 (앱 버전이 바뀌어도 유지)
const IMAGE_CACHE = "family-chat-images";
const IMAGE_CACHE_MAX = 800; // 이보다 많으면 오래된 사진부터 기기에서 지움 (서버 사진은 그대로)
const IMAGE_PATH = "/storage/v1/object/sign/chat-images/";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./calendar.js",
  "./stickers.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/badge-96.png",
  "./my/",
  "./my/index.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== IMAGE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 가족 사진: 주소의 일회용 토큰(?token=…)을 떼고 사진 경로로 저장 → 한 번 받으면 다시 안 받음
async function cachedImage(req) {
  const url = new URL(req.url);
  const key = url.origin + url.pathname;
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type !== "opaque") {
    await cache.put(key, res.clone());
    trimImages(cache);
  }
  return res;
}

let trimming = false;
async function trimImages(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    const extra = keys.length - IMAGE_CACHE_MAX;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]); // 먼저 저장된 것부터
  } finally {
    trimming = false;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.includes(IMAGE_PATH)) {
    event.respondWith(cachedImage(req).catch(() => fetch(req)));
    return;
  }

  // 이모티콘: 한 번 받으면 기기에 저장 (파일을 바꾸면 stickers.js 의 버전 숫자로 새로 받음)
  if (url.origin === self.location.origin && url.pathname.includes("/stickers/")) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const hit = await cache.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await cache.put(req.url, res.clone());
      return res;
    })().catch(() => fetch(req)));
    return;
  }

  // 같은 사이트 파일만: 네트워크 우선, 오프라인이면 캐시
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((r) => r || caches.match(url.pathname.includes("/my/") ? "./my/index.html" : "./index.html"))),
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
