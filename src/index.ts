import "dotenv/config";
import { readFileSync } from "node:fs";
import { fetchArticles } from "./fetchItems.js";
import { makeStore, loadConfig } from "./store.js";
import { fetchUrlArticle, urlGuid } from "./urlArticle.js";
import { EpisodeProducer, ensureCover, makeRewriteConfig, publishFeed, resolveRemoteConfig } from "./produce.js";
import { syncBooksAll } from "./syncBooks.js";
import { acquireLock } from "./lock.js";
import type { AppConfig, Article, Episode } from "./types.js";

const SEEN_CAP = 2000;

/** 按源轮询选取(每源内按时间降序),避免高产源(36氪等)垄断每日配额 */
function pickRoundRobin<T extends { sourceName: string }>(articles: T[], limit: number): T[] {
  const bySource = new Map<string, T[]>();
  for (const a of articles) {
    const list = bySource.get(a.sourceName) ?? [];
    list.push(a);
    bySource.set(a.sourceName, list);
  }
  const picked: T[] = [];
  while (picked.length < limit) {
    let took = false;
    for (const list of bySource.values()) {
      const a = list.shift();
      if (!a) continue;
      picked.push(a);
      took = true;
      if (picked.length >= limit) break;
    }
    if (!took) break;
  }
  return picked;
}

async function main() {
  if (!acquireLock("feed")) {
    console.log("[pipeline] another feed producer is running, skip");
    return;
  }
  let config = loadConfig();

  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : config.maxItemsPerRun;

  const storage = makeStore(config.bucket);
  await storage.ensureBucket();
  config = await resolveRemoteConfig(config, storage, true);
  await ensureCover(storage);

  const state = await storage.loadState();
  const seen = new Set(state.seen);

  const articles = await fetchArticles(config.sources);
  const fresh = pickRoundRobin(
    articles.filter((a) => !seen.has(a.guid) && a.text.length > 100),
    limit,
  );
  // 摘要型 RSS(BBC/ESPN 等只给一两句)抓原文页补全,避免对话稿无米下锅
  for (const a of fresh) {
    if (a.text.length >= 500 || !a.link) continue;
    try {
      const full = await fetchUrlArticle(a.link);
      if (full.text.length > a.text.length) {
        a.text = full.text;
        console.log(`[pipeline] enriched "${a.title}" ${a.text.length} chars from page`);
      }
    } catch (e) {
      console.warn(`[pipeline] enrich failed for "${a.title}": ${(e as Error).message}`);
    }
  }

  // 设置页/手工投递的单篇 URL(queue.json),用户点名要听的不占每日配额
  const urlQueue = await storage.loadJson<{ urls?: string[] }>("queue.json");
  const queuedArticles: Article[] = [];
  for (const url of (urlQueue?.urls ?? []).filter((u) => /^https?:\/\//.test(u))) {
    if (seen.has(urlGuid(url))) continue;
    try {
      queuedArticles.push(await fetchUrlArticle(url));
    } catch (e) {
      console.error(`[pipeline] queued url failed: ${(e as Error).message}`);
    }
  }

  // 书籍不走每日连载,由 npm run books:sync 全量生成(见 syncBooks.ts)
  const queue = [...queuedArticles, ...fresh];
  console.log(
    `[pipeline] ${articles.length} fetched, ${fresh.length} new (limit ${limit}), ${queuedArticles.length} queued urls`,
  );

  // 设置页上传的电子书:这里只探测是否有,导入+生成统一交给 syncBooksAll(单一归属)
  const uploadedBooks = await storage.list("bookuploads/").catch(() => [] as string[]);

  if (queue.length === 0 && uploadedBooks.length === 0) {
    console.log("[pipeline] nothing new, done");
    return;
  }

  if (queue.length > 0) {
    const producer = new EpisodeProducer(config, makeRewriteConfig(config), storage);
    const newEpisodes: Episode[] = [];

    for (const article of queue) {
      try {
        const ep = await producer.produce(article);
        newEpisodes.push(ep);
        console.log(`[pipeline] episode ready: ${ep.title} (${Math.round(ep.audioBytes / 1024)} KB)`);
      } catch (e) {
        console.error(`[pipeline] failed for "${article.title}": ${(e as Error).message}`);
      }
      // 资讯无论成败都标记已见,坏文章不重试,避免每天卡在同一篇上
      seen.add(article.guid);
    }

    state.seen = [...seen].slice(-SEEN_CAP);
    const feedUrl = await publishFeed(config, storage, state, newEpisodes);
    if (urlQueue?.urls?.length) await storage.uploadJson("queue.json", { urls: [] });

    console.log(`[pipeline] done: +${newEpisodes.length} episodes, feed has ${state.episodes.length}`);
    console.log(`[pipeline] feed URL: ${feedUrl}`);
  }

  if (uploadedBooks.length > 0) {
    console.log(
      `[pipeline] uploaded book(s) pending: ${uploadedBooks.map((k) => k.replace("bookuploads/", "")).join(", ")}, syncing…`,
    );
    await syncBooksAll();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
