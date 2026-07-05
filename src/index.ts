import "dotenv/config";
import { readFileSync } from "node:fs";
import { fetchArticles } from "./fetchItems.js";
import { makeStore, makePrivStore, loadConfig } from "./store.js";
import { fetchUrlArticle, urlGuid } from "./urlArticle.js";
import { briefScript } from "./rewrite.js";
import { clearInbox, failInbox, readInbox } from "./inbox.js";
import { DialogueTts, parseDialogue } from "./tts.js";
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

  // Newsletter 收件箱(私有桶,Email Worker 写入),不占每日配额
  const priv = makePrivStore(config.bucket);
  const inboxItems = priv ? (await readInbox(priv)).filter((i) => !seen.has(i.article.guid)) : [];

  // 书籍不走每日连载,由 npm run books:sync 全量生成(见 syncBooks.ts)
  const queue = [...queuedArticles, ...inboxItems.map((i) => i.article), ...fresh];
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
    const inboxByGuid = new Map(inboxItems.map((i) => [i.article.guid, i]));
    const doneInbox: typeof inboxItems = [];
    const okArticles: Article[] = [];

    for (const article of queue) {
      let ok = false;
      try {
        const ep = await producer.produce(article);
        newEpisodes.push(ep);
        okArticles.push(article);
        ok = true;
        console.log(`[pipeline] episode ready: ${ep.title} (${Math.round(ep.audioBytes / 1024)} KB)`);
      } catch (e) {
        console.error(`[pipeline] failed for "${article.title}": ${(e as Error).message}`);
      }
      const ib = inboxByGuid.get(article.guid);
      if (ib) {
        // 邮件是唯一副本:失败不标已见、留桶重试(3 次后放弃),成功才删
        if (ok) {
          seen.add(article.guid);
          doneInbox.push(ib);
        } else if (priv) {
          await failInbox(priv, ib);
        }
      } else {
        // 资讯/投递 URL 无论成败都标记已见,坏文章不重试,避免每天卡在同一篇上
        seen.add(article.guid);
      }
    }

    // 今日速览:≥3 条资讯时,把当天内容浓缩成一集对话简报置顶(同日重跑不重复)。
    // 日期按听众时区算(UTC 服务器 22:30 跑的是听众"明早"的简报,用 UTC 会差一天)。
    const tz = config.timezone || "Asia/Shanghai";
    const today = new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
    const briefId = `brief-${today.replace(/-/g, "")}`;
    if (
      config.dailyBrief !== false &&
      newEpisodes.length >= 3 &&
      (config.dialogueVoices?.length ?? 0) >= 2 &&
      !state.episodes.some((e) => e.id === briefId)
    ) {
      try {
        const script = await briefScript(
          okArticles.map((a) => ({ title: a.title, text: a.text, sourceName: a.sourceName })),
          makeRewriteConfig(config),
        );
        const dialogue = script ? parseDialogue(script) : null;
        if (dialogue) {
          const tts = new DialogueTts([config.dialogueVoices![0], config.dialogueVoices![1]]);
          const audio = await tts.synthesize(dialogue);
          const audioPath = `episodes/${briefId}.mp3`;
          await storage.uploadAudio(audioPath, audio);
          try {
            const doc = dialogue.map((l) => (l.speaker === 0 ? "A: " : "B: ") + l.text).join("\n\n");
            await storage.uploadFile(`transcripts/${briefId}.txt`, Buffer.from(doc), "text/plain; charset=utf-8");
          } catch {}
          newEpisodes.unshift({
            id: briefId,
            title: `今日速览 · ${newEpisodes.length} 条(${+today.slice(5, 7)}月${+today.slice(8, 10)}日)`,
            description: dialogue.map((l) => l.text).join(" ").slice(0, 200),
            link: "",
            sourceName: "今日速览",
            pubDate: new Date().toISOString(),
            audioPath,
            audioBytes: audio.length,
            group: "简报",
          });
          console.log(`[pipeline] daily brief ready (${Math.round(audio.length / 1024)} KB)`);
        } else {
          console.warn("[pipeline] daily brief skipped: script/parse failed");
        }
      } catch (e) {
        console.warn(`[pipeline] daily brief failed: ${(e as Error).message}`);
      }
    }

    state.seen = [...seen].slice(-SEEN_CAP);
    const feedUrl = await publishFeed(config, storage, state, newEpisodes);
    // 只移除本轮快照里的 URL——长任务期间用户新投递的不能被清掉
    if (urlQueue?.urls?.length) {
      const processed = new Set(urlQueue.urls);
      const cur = await storage.loadJson<{ urls?: string[] }>("queue.json");
      await storage.uploadJson("queue.json", { urls: (cur?.urls ?? []).filter((u) => !processed.has(u)) });
    }
    if (priv && doneInbox.length) await clearInbox(priv, doneInbox);

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
