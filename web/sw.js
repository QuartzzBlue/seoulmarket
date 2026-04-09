// 서비스 워커 — PWA "홈 화면에 추가" 기능을 활성화하기 위한 최소 구현
// 캐시 없이 항상 네트워크에서 최신 데이터를 가져온다

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
