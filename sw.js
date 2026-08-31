// ============================================================
// sw.js — Service Worker：离线缓存
//
// 采用「网络优先、离线回退」策略：
//   - 有网时用 cache:'no-store' 绕过 HTTP 缓存，确保拿到最新文件
//   - 离线时回退到缓存，保证离线可用
// ============================================================

const CACHE_NAME = 'poker-timer-v10';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './audio.js',
  './history.js',
  './players.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 安装：预缓存所有静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// 请求拦截：网络优先，离线回退缓存
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // 只处理同源请求

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        // 成功拉到最新，写回缓存
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        // 离线或网络失败：回退缓存；页面请求回退到 index.html
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('./index.html');
        })
      )
  );
});
