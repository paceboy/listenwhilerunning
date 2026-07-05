import "dotenv/config";
import { readFileSync, realpathSync } from "node:fs";
import { acquireLock } from "./lock.js";
import { pathToFileURL } from "node:url";
import { makeStore, loadConfig } from "./store.js";
import { fetchUrlArticle } from "./urlArticle.js";
import { EpisodeProducer, ensureCover, makeRewriteConfig, publishFeed, resolveRemoteConfig } from "./produce.js";
import type { AppConfig, Episode } from "./types.js";

/**
 * 单篇网页 → 立刻生成一集插进 feed:
 *   npm run add -- <url> [<url2> ...]
 * 不带参数时消费 bucket 里的 queue.json({"urls":[...]},设置页投递用)。
 */
export async function runAdd(cliUrls: string[]) {
  if (!acquireLock("feed")) {
    console.log("[add] another feed producer is running, skip");
    return;
  }
  let config = loadConfig();
  const storage = makeStore(config.bucket);
  await storage.ensureBucket();
  config = await resolveRemoteConfig(config, storage);
  await ensureCover(storage);

  let fromQueue = false;
  let urls = cliUrls;
  if (urls.length === 0) {
    const queue = await storage.loadJson<{ urls?: string[] }>("queue.json");
    urls = (queue?.urls ?? []).filter((u) => /^https?:\/\//.test(u));
    fromQueue = true;
    if (urls.length === 0) {
      console.log("[add] no urls given and queue.json empty, nothing to do");
      return;
    }
  }

  const state = await storage.loadState();
  const seen = new Set(state.seen);
  const producer = new EpisodeProducer(config, makeRewriteConfig(config), storage);
  const newEpisodes: Episode[] = [];

  for (const url of urls) {
    try {
      const article = await fetchUrlArticle(url);
      if (seen.has(article.guid)) {
        console.log(`[add] already in feed, skip: ${url}`);
        continue;
      }
      console.log(`[add] "${article.title}" (${article.text.length} chars) from ${article.sourceName}`);
      const ep = await producer.produce(article);
      newEpisodes.push(ep);
      seen.add(article.guid);
      console.log(`[add] episode ready: ${ep.title} (${Math.round(ep.audioBytes / 1024)} KB)`);
    } catch (e) {
      console.error(`[add] failed for ${url}: ${(e as Error).message}`);
    }
  }

  if (newEpisodes.length > 0) {
    state.seen = [...seen];
    const feedUrl = await publishFeed(config, storage, state, newEpisodes);
    console.log(`[add] done: +${newEpisodes.length} episodes, feed: ${feedUrl}`);
  }
  if (fromQueue) await storage.uploadJson("queue.json", { urls: [] });
}

// 直接 `npm run add` 时执行;被 poll.ts 当模块 import 时不自动跑
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runAdd(process.argv.slice(2).filter((a) => /^https?:\/\//.test(a))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
