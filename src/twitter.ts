import { createHash } from "node:crypto";
import type { Article, SourceConfig } from "./types.js";

// Twitter 无公开 RSS,走 spiderhubs.com 的第三方抓取 API。
// key 由部署者自备(.env SPIDERHUBS_API_KEY,gitignored),不配则 Twitter 源整体跳过、其余源不受影响。
const API_BASE = "https://api.spiderhubs.com/openapi/v1/contentcreator/twitter/web/fetch_user_post_tweet";

// 推文太短,一推一集不成立:每个账号每次运行聚合成一篇 Article。
// 窗口 72h 容忍管线连挂两天不丢推;窗口内重复靠 seen 按条去重(Article.extraGuids)。
const WINDOW_MS = 72 * 3600_000;
// 单篇最多收这么多条(高产账号防爆);溢出的不标已见,还在窗口内的下轮继续收
const MAX_TWEETS = 12;

interface RawTweet {
  tweet_id?: string;
  created_at?: string;
  text?: string;
  author?: { name?: string; screen_name?: string };
  retweeted_tweet?: RawTweet;
  quoted?: RawTweet;
}

/** 订阅源 URL 是 Twitter 个人主页(https://x.com/naval 或 twitter.com)时返回 screen_name,否则 null */
export function twitterScreenName(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/?$/i);
  return m ? m[1] : null;
}

/** 推文的按条去重指纹(与聚合文章的 guid 无关,进 state.seen) */
function tweetGuid(id: string): string {
  return createHash("sha1").update(`tweet:${id}`).digest("hex").slice(0, 16);
}

/** t.co 短链对口播稿无意义,去掉;解码 API 返回的 HTML 实体;合并空白 */
function cleanText(s: string): string {
  return s
    .replace(/https?:\/\/t\.co\/\S+/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 单条推文 → 素材行。转推列表里的 text 是截断的,取 retweeted_tweet 全文;引用推附在括号里 */
function tweetLine(t: RawTweet): string {
  const rt = t.retweeted_tweet;
  if (rt) {
    const body = cleanText(rt.text ?? "");
    return body ? `转发 @${rt.author?.screen_name ?? "?"} 的推文:${body}` : "";
  }
  let line = cleanText(t.text ?? "");
  if (!line) return "";
  const q = t.quoted ? cleanText(t.quoted.text ?? "") : "";
  if (q) line += `(引用 @${t.quoted!.author?.screen_name ?? "?"}:${q})`;
  return line;
}

/** 抓一个账号近 72h 的推文,聚合成一篇 Article;没有新内容返回 null */
export async function fetchTwitterArticle(
  src: SourceConfig,
  screenName: string,
  seen: ReadonlySet<string>,
): Promise<Article | null> {
  const key = process.env.SPIDERHUBS_API_KEY;
  if (!key) {
    console.warn(`[fetch] ${src.name}: SPIDERHUBS_API_KEY not set, twitter source skipped`);
    return null;
  }
  const res = await fetch(`${API_BASE}?screen_name=${encodeURIComponent(screenName)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`spiderhubs HTTP ${res.status}`);
  const body = (await res.json()) as {
    code?: number;
    msg?: string;
    data?: { timeline?: RawTweet[] };
  };
  if (body.code !== 200) throw new Error(`spiderhubs code ${body.code} ${body.msg ?? ""}`);

  const cutoff = Date.now() - WINDOW_MS;
  const picked: { id: string; ts: number; line: string }[] = [];
  for (const t of body.data?.timeline ?? []) {
    const ts = Date.parse(t.created_at ?? "");
    if (!t.tweet_id || !Number.isFinite(ts) || ts < cutoff) continue;
    if (seen.has(tweetGuid(t.tweet_id))) continue;
    const line = tweetLine(t);
    if (line.length < 10) continue; // 纯图/纯链接推,没有可念的内容
    picked.push({ id: t.tweet_id, ts, line });
  }
  if (picked.length === 0) return null;

  picked.sort((a, b) => a.ts - b.ts); // 时间正序,自回复线程连着读才通顺
  const take = picked.slice(-MAX_TWEETS);
  const newest = take[take.length - 1];
  return {
    guid: createHash("sha1")
      .update(`tweets:${screenName}:${take.map((p) => p.id).join(",")}`)
      .digest("hex")
      .slice(0, 16),
    extraGuids: take.map((p) => tweetGuid(p.id)),
    title: `${src.name} 最新推文 ${take.length} 条`,
    link: `https://x.com/${screenName}`,
    sourceName: src.name,
    pubDate: new Date(newest.ts).toISOString(),
    text:
      `以下是 ${src.name}(@${screenName})近日发布的推文,按时间顺序:\n` +
      take.map((p, i) => `${i + 1}. ${p.line}`).join("\n"),
    group: src.group,
  };
}
