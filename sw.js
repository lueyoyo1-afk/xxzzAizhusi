/* 像素蜘蛛 Service Worker —— 离线缓存 + 自动更新 */
var CACHE_NAME = 'pixelspider-v5';

/* 需要预缓存的静态资源（首次安装时拉一遍） */
var CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './core_v3.js',
  './lib/marked.min.js',
  './lib/supabase.js'
];

/* 安装：预缓存核心资源，并立刻接管 */
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* 逐个 add，单个失败不影响其他 */
      return Promise.all(CORE_ASSETS.map(function (u) {
        return cache.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    })
  );
});

/* 激活：清掉旧版本缓存 */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* 请求拦截策略：
   - version.json / sw.js：永远走网络（保证能拿到新版本号）
   - 其他同源资源：网络优先，失败回退缓存（离线可用）
   - 跨域（Supabase 等）：直接放行，不缓存
*/
self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.indexOf('version.json') !== -1 || url.pathname.indexOf('sw.js') !== -1) {
    e.respondWith(
      fetch(req, { cache: 'no-store' }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  e.respondWith(
    fetch(req, { cache: 'no-store' }).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});

/* 允许页面消息触发立即更新 */
self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
