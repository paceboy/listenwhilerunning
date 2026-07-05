import "dotenv/config";
import { readFileSync, realpathSync } from "node:fs";
import { acquireLock } from "./lock.js";
import { pathToFileURL } from "node:url";
import { makeStore, makePrivStore, loadConfig } from "./store.js";
import { fetchUrlArticle } from "./urlArticle.js";
import { clearInbox, failInbox, readInbox } from "./inbox.js";
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

  const priv = makePrivStore(config.bucket);
  let fromQueue = false;
  let urls = cliUrls;
  let queueSnapshot: string[] = [];
  let inboxItems: import("./inbox.js").InboxItem[] = [];
  if (urls.length === 0) {
    const queue = await storage.loadJson<{ urls?: string[] }>("queue.json");
    queueSnapshot = queue?.urls ?? [];
    urls = queueSnapshot.filter((u) => /^https?:\/\//.test(u));
    fromQueue = true;
    inboxItems = priv ? await readInbox(priv) : [];
    if (urls.length === 0 && inboxItems.length === 0 && queueSnapshot.length === 0) {
      console.log("[add] nothing to do (queue.json empty, inbox empty)");
      return;
    }
  }

  const state = await storage.loadState();
  const seen = new Set(state.seen);
  const producer = new EpisodeProducer(config, makeRewriteConfig(config), storage);
  const newEpisodes: Episode[] = [];

  // 邮件是唯一副本:成功/已入库的才删,失败的留桶重试(见 failInbox)
  const doneInbox: import("./inbox.js").InboxItem[] = [];
  for (const it of inboxItems) {
    if (seen.has(it.article.guid)) {
      doneInbox.push(it);
      continue;
    }
    try {
      console.log(`[add] newsletter: "${it.article.title}" from ${it.article.sourceName}`);
      const ep = await producer.produce(it.article);
      newEpisodes.push(ep);
      seen.add(it.article.guid);
      doneInbox.push(it);
    } catch (e) {
      console.error(`[add] newsletter failed: ${(e as Error).message}`);
      if (priv) await failInbox(priv, it);
    }
  }

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
  // 只移除本轮快照里的 URL——生成期间用户新投递的不能被清掉
  if (fromQueue && queueSnapshot.length) {
    const processed = new Set(queueSnapshot);
    const cur = await storage.loadJson<{ urls?: string[] }>("queue.json");
    await storage.uploadJson("queue.json", { urls: (cur?.urls ?? []).filter((u) => !processed.has(u)) });
  }
  if (priv && doneInbox.length) await clearInbox(priv, doneInbox);
}

// 直接 `npm run add` 时执行;被 poll.ts 当模块 import 时不自动跑
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runAdd(process.argv.slice(2).filter((a) => /^https?:\/\//.test(a))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
