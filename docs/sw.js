/* 跑步听什么 Service Worker:
   - 页面壳:network-first + 2.5s 超时回退缓存(发版即生效,弱网/离线不白屏)
   - feed.xml / books.json:network-first,离线退缓存
   - mp3:cache-first(听过的/预取的离线可听),上限 40 个 LRU
   页面在 feed 加载后 postMessage 预取最新几集,出门前打开一次即可离线听。 */
var SHELL = 'shell-v10';
var DATA = 'data-v1';
var MEDIA = 'media-v1';
var MEDIA_MAX = 40;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(['./']).then(function () { return c.add('./config.js').catch(function () {}); }); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return [SHELL, DATA, MEDIA].indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'prefetch' && Array.isArray(e.data.urls)) {
    e.waitUntil(caches.open(MEDIA).then(function (cache) {
      return e.data.urls.reduce(function (p, url) {
        return p.then(function () {
          return cache.match(url).then(function (hit) {
            if (hit) return;
            return fetch(url).then(function (res) {
              if (res.ok) return cache.put(url, res);
            }).catch(function () {});
          });
        });
      }, Promise.resolve()).then(function () { return trimMedia(cache); });
    }));
  }
});

function trimMedia(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= MEDIA_MAX) return;
    return keys.slice(0, keys.length - MEDIA_MAX).reduce(function (p, k) {
      return p.then(function () { return cache.delete(k); });
    }, Promise.resolve());
  });
}

// 缓存的是完整 200 响应;媒体元素带 Range 请求时手工切片回 206
function sliceResponse(req, res) {
  var range = req.headers.get('range');
  if (!range) return Promise.resolve(res);
  var m = /bytes=(\d+)-(\d+)?/.exec(range);
  if (!m) return Promise.resolve(res);
  var start = +m[1];
  return res.arrayBuffer().then(function (buf) {
    var end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
    return new Response(buf.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes'
      }
    });
  });
}

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  // /api/* 永不进缓存:鉴权 + 动态结果(带 ?q= 查询串)。
  // 兜底的 stale-while-revalidate 用 ignoreSearch 会让所有查询共用一个键、回放旧响应,
  // 直接放行走网络。非 GET 同理。
  if (/\/api\//.test(url) || e.request.method !== 'GET') return;

  if (/\.mp3(\?|$)/.test(url)) {
    e.respondWith(caches.open(MEDIA).then(function (cache) {
      return cache.match(url).then(function (hit) {
        if (hit) return sliceResponse(e.request, hit.clone());
        // 未缓存:直接透传(不缓存 Range 局部响应);完整 200 才顺手缓存
        return fetch(e.request).then(function (res) {
          if (res.status === 200 && !e.request.headers.get('range')) {
            cache.put(url, res.clone()).then(function () { return trimMedia(cache); });
          }
          return res;
        });
      });
    }));
    return;
  }

  if (/feed\.xml|books\.json/.test(url)) {
    e.respondWith(caches.open(DATA).then(function (cache) {
      return fetch(e.request).then(function (res) {
        if (res.ok) cache.put(url, res.clone());
        return res;
      }).catch(function () {
        return cache.match(url).then(function (hit) { return hit || Response.error(); });
      });
    }));
    return;
  }

  // 页面本身 network-first + 2.5s 超时:在线拿最新(发版即生效),
  // 弱网(lie-fi,连着但极慢)不白屏——超时先出缓存壳,后台照常把新版写进缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.open(SHELL).then(function (cache) {
      var net = fetch(e.request).then(function (res) {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      });
      var cached = cache.match(e.request, { ignoreSearch: true });
      var timeout = new Promise(function (resolve) {
        setTimeout(function () { resolve(cached); }, 2500);
      });
      return Promise.race([net.catch(function () { return cached; }), timeout])
        .then(function (res) { return res || net; })
        .then(function (res) { return res || Response.error(); })
        .catch(function () { return cached.then(function (hit) { return hit || Response.error(); }); });
    }));
    return;
  }

  // 其余同源静态资源(图标/manifest)stale-while-revalidate
  if (new URL(url).origin === self.location.origin) {
    e.respondWith(caches.open(SHELL).then(function (cache) {
      return cache.match(e.request, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(e.request).then(function (res) {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(function () { return hit || Response.error(); });
        return hit || net;
      });
    }));
  }
});
