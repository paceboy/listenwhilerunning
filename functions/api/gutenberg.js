// 公版书搜索/下载(Project Gutenberg):设置页"搜公版书"用。
//   GET  /api/gutenberg?q=<关键词>     搜索,返回候选 [{id,title,author,downloads}]
//   POST /api/gutenberg  {id,title}    下无图 epub 到 bucket bookuploads/,下次批次转音频
// 鉴权在 functions/api/_middleware.js 统一处理。仅版权已过期的公版书。
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const SEARCH = "https://www.gutenberg.org/ebooks/search/";
const MAX_BYTES = 50 * 1024 * 1024;

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\s+/g, " ")
    .trim();
}

function parseResults(html) {
  const out = [];
  const blocks = html.match(/<li class="booklink">[\s\S]*?<\/li>/g) || [];
  for (const b of blocks) {
    const id = (b.match(/\/ebooks\/(\d+)/) || [])[1];
    const title = (b.match(/class="title">([\s\S]*?)<\/span>/) || [])[1];
    if (!id || !title) continue;
    const author = (b.match(/class="subtitle">([\s\S]*?)<\/span>/) || [])[1] || "";
    const dl = (b.match(/class="extra">([\d,]+)\s*downloads/) || [])[1] || "0";
    out.push({
      id,
      title: decodeEntities(title),
      author: decodeEntities(author),
      downloads: +dl.replace(/,/g, ""),
    });
  }
  return out.slice(0, 15);
}

// 书名 → 安全文件名(与 book.js 上传路径同规则,交给 syncBooks 导入)
function safeName(title) {
  return (
    (title || "book")
      .replace(/[/\\?%*:|"<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "book"
  );
}

// Gutenberg 偶尔给数据中心 IP 弹 Cloudflare 反爬页(无书目条目),重试一次多半就过。
// 区分三态:命中书目 / 确实空(有结果容器但 0 条)/ 被挑战(整页无容器)。
async function searchGutenberg(params) {
  let lastHtml = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${SEARCH}?${params}`, {
      headers: { "User-Agent": UA },
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) {
      lastHtml = "";
      continue;
    }
    lastHtml = await res.text();
    const results = parseResults(lastHtml);
    if (results.length) return { results };
    // 有"结果区/无记录"标记 = 页面正常但确实没书;否则视为被挑战,重试
    if (/booklink|No records|did not match/i.test(lastHtml)) return { results: [] };
  }
  return { challenged: !lastHtml || !/booklink|No records/i.test(lastHtml) };
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ results: [] });
    const params = new URLSearchParams({ query: q, submit_search: "Go!" });
    const lang = url.searchParams.get("lang");
    if (lang) params.set("languages", lang);
    const out = await searchGutenberg(params);
    if (out.challenged) return json({ error: "Gutenberg busy, please retry" }, 503);
    return json({ results: out.results });
  }

  if (request.method === "POST") {
    let id, title;
    try {
      const b = await request.json();
      id = String(b.id || "").trim();
      title = String(b.title || "").trim();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (!/^\d+$/.test(id)) return new Response("bad id", { status: 400 });

    const epubUrl = `https://www.gutenberg.org/ebooks/${id}.epub.noimages`;
    const res = await fetch(epubUrl, { headers: { "User-Agent": UA } });
    if (!res.ok) return json({ error: `download HTTP ${res.status}` }, 502);
    const buf = await res.arrayBuffer();
    // epub 是 zip,魔数 "PK";太小说明拿到的是错误页而非书
    const head = new Uint8Array(buf.slice(0, 2));
    if (buf.byteLength < 1000 || head[0] !== 0x50 || head[1] !== 0x4b)
      return json({ error: "not a valid epub" }, 502);
    if (buf.byteLength > MAX_BYTES) return json({ error: "file too large" }, 413);

    const name = `${safeName(title) || "gutenberg-" + id}.epub`;
    await env.LWR.put(`bookuploads/${name}`, buf, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    return json({ queued: name, bytes: buf.byteLength });
  }

  return new Response("method not allowed", { status: 405 });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
