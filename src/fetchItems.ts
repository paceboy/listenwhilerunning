import Parser from "rss-parser";
import { createHash } from "node:crypto";
import type { Article, SourceConfig } from "./types.js";

// Reddit 的 .rss 端点会拒默认 UA,统一带浏览器 UA
const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) lwr-personal-feed/0.1" },
});

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Reddit 同 IP 连续请求会 429,退避约 15-60s 恢复;每日批处理任务,等得起
async function fetchFeed(url: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await parser.parseURL(url);
    } catch (e) {
      if (attempt >= 4 || !/429/.test((e as Error).message)) throw e;
      console.warn(`[fetch] 429 from ${url}, retrying in 30s (${attempt}/3)`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

export async function fetchArticles(sources: SourceConfig[]): Promise<Article[]> {
  const all: Article[] = [];
  let redditFetched = false;
  for (const src of sources) {
    try {
      // Reddit 同 IP 无认证限速很紧,源一多背靠背必 429;主动隔 10s 比撞上后退避 30s 省
      if (/reddit\.com/i.test(src.url)) {
        if (redditFetched) await new Promise((r) => setTimeout(r, 10_000));
        redditFetched = true;
      }
      const feed = await fetchFeed(src.url);
      const filter = src.filter ? new RegExp(src.filter, "i") : null;
      for (const item of feed.items ?? []) {
        const link = item.link ?? "";
        const rawGuid = item.guid || link || item.title || "";
        if (!rawGuid) continue;
        const guid = createHash("sha1").update(rawGuid).digest("hex").slice(0, 16);
        const html =
          (item as Record<string, string>)["content:encoded"] ||
          item.content ||
          item.contentSnippet ||
          "";
        const title = item.title ?? "(无标题)";
        const text = stripHtml(html);
        if (filter && !filter.test(title + " " + text)) continue;
        all.push({
          guid,
          title,
          link,
          sourceName: src.name,
          pubDate: item.isoDate || item.pubDate || new Date().toISOString(),
          text,
          group: src.group,
        });
      }
      console.log(`[fetch] ${src.name}: ${feed.items?.length ?? 0} items`);
    } catch (e) {
      console.warn(`[fetch] ${src.name} failed: ${(e as Error).message}`);
    }
  }
  all.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  return all;
}
