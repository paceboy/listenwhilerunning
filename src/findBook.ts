import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { get as httpsGet } from "node:https";
import { loadConfig } from "./store.js";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/**
 * GET → Buffer,跟随重定向。用 node:https 而非 fetch:gutenberg.org 的 DNS 同时返回
 * 不可达的 IPv6 记录,undici(全局 fetch)的 happy-eyeballs 会卡在上面直到超时;
 * 这里强制 family:4 走 IPv4。零新依赖。
 */
function httpGet(url: string, redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { family: 4, headers: { "User-Agent": UA }, timeout: 120_000 },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
          res.resume();
          if (redirects <= 0) return reject(new Error("too many redirects"));
          return resolve(httpGet(new URL(loc, url).toString(), redirects - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks: Buffer[] = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
  });
}

/**
 * 公版电子书搜索/下载:查 Project Gutenberg(7.5 万+ 本版权已过期的书),
 * 下无图 epub 到 books/,交给 `npm run books:sync` 转文本+音频。
 *
 *   npm run books:find -- "pride prejudice"          # 搜索,列出候选
 *   npm run books:find -- "pride prejudice" --get    # 下载排第一的
 *   npm run books:find -- --get 1342                 # 下载指定 Gutenberg ID
 *   npm run books:find -- "红楼梦" --get --sync       # 下载后立即生成音频
 *
 * 注:Gutenberg 以英文/欧洲语言为主,中文书需用罗马字或英文名搜(如 "hong lou meng");
 * 搜索框对 CJK 字符支持差。仅收录版权已过期作品——在版权期的书不走这里。
 */

const SEARCH = "https://www.gutenberg.org/ebooks/search/";
// 无图版:体积小十倍(纯文本足够),避免下 20MB+ 的插图 epub
const epubUrl = (id: string) => `https://www.gutenberg.org/ebooks/${id}.epub.noimages`;

interface Candidate {
  id: string;
  title: string;
  author: string;
  downloads: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\s+/g, " ")
    .trim();
}

async function search(query: string, lang?: string): Promise<Candidate[]> {
  const params = new URLSearchParams({ query, submit_search: "Go!" });
  if (lang) params.set("languages", lang);
  const html = (await httpGet(`${SEARCH}?${params}`)).toString("utf8");
  const out: Candidate[] = [];
  for (const block of html.match(/<li class="booklink">[\s\S]*?<\/li>/g) ?? []) {
    const id = block.match(/\/ebooks\/(\d+)/)?.[1];
    const title = block.match(/class="title">([\s\S]*?)<\/span>/)?.[1];
    if (!id || !title) continue;
    const author = block.match(/class="subtitle">([\s\S]*?)<\/span>/)?.[1] ?? "";
    const downloads = block.match(/class="extra">([\d,]+)\s*downloads/)?.[1] ?? "0";
    out.push({
      id,
      title: decodeEntities(title),
      author: decodeEntities(author),
      downloads: +downloads.replace(/,/g, ""),
    });
  }
  return out;
}

/** 书名 → 安全文件名(去非法字符,限长);沿用与上传书一致的清洗风格 */
function safeName(title: string): string {
  return (
    title
      .replace(/[/\\?%*:|"<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "book"
  );
}

async function download(id: string, title: string, booksDir: string): Promise<string> {
  const buf = await httpGet(epubUrl(id));
  if (buf.length < 1000 || buf.subarray(0, 2).toString() !== "PK")
    throw new Error(`id ${id}: not a valid epub (got ${buf.length} bytes)`);
  mkdirSync(booksDir, { recursive: true });
  let name = `${safeName(title)}.epub`;
  // 同名不同内容才改名,同名同大小视为已下过
  for (let n = 2; existsSync(join(booksDir, name)) && statSync(join(booksDir, name)).size !== buf.length; n++)
    name = `${safeName(title)} (${n}).epub`;
  const path = join(booksDir, name);
  writeFileSync(path, buf);
  return path;
}

async function main() {
  const argv = process.argv.slice(2);
  const langI = argv.indexOf("--lang");
  const lang = langI > -1 ? argv[langI + 1] : undefined;
  const getI = argv.indexOf("--get");
  const wantGet = getI > -1;
  // --get 后面若跟纯数字则是 Gutenberg ID,否则表示"下排第一的"
  const explicitId = wantGet && /^\d+$/.test(argv[getI + 1] ?? "") ? argv[getI + 1] : undefined;
  const doSync = argv.includes("--sync");
  const query = argv
    .filter((a, i) => {
      if (a.startsWith("--")) return false;
      if (i === langI + 1 && lang) return false;
      if (i === getI + 1 && explicitId) return false;
      return true;
    })
    .join(" ")
    .trim();

  const config = loadConfig();
  const booksDir = config.booksDir;

  if (explicitId && !query) {
    // 只给了 ID,直接下(标题用 ID 兜底,能搜到就用真标题)
    let title = `gutenberg-${explicitId}`;
    try {
      const hit = (await search(explicitId)).find((c) => c.id === explicitId);
      if (hit) title = hit.title;
    } catch {}
    const path = await download(explicitId, title, booksDir);
    console.log(`✓ 下载完成: ${path}`);
    return afterDownload(doSync);
  }

  if (!query) {
    console.log('用法: npm run books:find -- "书名 或 作者" [--lang en|zh|fr] [--get [ID]] [--sync]');
    console.log("Gutenberg 只有版权已过期的公版书;中文书用罗马字/英文名搜(如 hong lou meng)。");
    process.exit(1);
  }

  const results = await search(query, lang);
  if (results.length === 0) {
    console.log(`没搜到「${query}」。换关键词试试(作者姓、英文/罗马字书名),或加 --lang 过滤语言。`);
    return;
  }

  if (!wantGet) {
    console.log(`「${query}」的公版书候选(Project Gutenberg):\n`);
    for (const c of results.slice(0, 15))
      console.log(
        `  [${c.id}] ${c.title}${c.author ? ` — ${c.author}` : ""}  (${c.downloads.toLocaleString()} 次下载)`,
      );
    console.log(`\n下载: npm run books:find -- --get <ID>  (加 --sync 立即生成音频)`);
    return;
  }

  // --get 无 ID:下下载量最高的(通常是最权威的版本)
  const pick = results.reduce((a, b) => (b.downloads > a.downloads ? b : a));
  console.log(`选中: [${pick.id}] ${pick.title}${pick.author ? ` — ${pick.author}` : ""}`);
  const path = await download(pick.id, pick.title, booksDir);
  console.log(`✓ 下载完成: ${path}`);
  return afterDownload(doSync);
}

async function afterDownload(doSync: boolean) {
  if (!doSync) {
    console.log("下一步生成音频: npm run books:sync  (可中断续传)");
    return;
  }
  console.log("开始生成音频(npm run books:sync)…");
  const { syncBooksAll } = await import("./syncBooks.js");
  await syncBooksAll();
}

main().catch((e) => {
  console.error(`[books:find] ${(e as Error).message}`);
  process.exit(1);
});
