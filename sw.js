// キャッシュ名。ファイルを更新したら末尾の番号を上げる
const CACHE_NAME = 'dpwa-v0-7';

// オフラインでも開けるようにする対象
const ASSETS = ['./', './index.html', './manifest.json'];

// 初回登録時にファイルをキャッシュへ保存する
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 古いキャッシュを削除し、すぐ制御下に入る
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 画面ファイルはキャッシュ優先。GAS通信は対象外にする
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
