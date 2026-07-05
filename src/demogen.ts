import "dotenv/config";
import { readFileSync } from "node:fs";
import { R2Storage } from "./r2.js";
import { generateBookAudio } from "./syncBooks.js";
import type { BookManifest } from "./syncBooks.js";
import { EpisodeProducer, ensureCover, makeRewriteConfig, publishFeed } from "./produce.js";
import type { AppConfig, Article } from "./types.js";

/**
 * 演示站内容生成:npx tsx src/demogen.ts <公版书.txt 路径>
 * 独立 bucket(lwr-demo),只放零版权风险内容:
 *  - 公版书有声书(整本 + 对话导读 + 每集概要)
 *  - 一集"项目介绍"资讯(文本来自本仓库 README,自有内容)
 * 生成完打印 demo 公开域名,配合独立播放器部署使用。
 */

const BUCKET = "lwr-demo";

const DEMO_CONFIG: AppConfig = {
  feed: {
    title: "跑步听什么 · Demo",
    description: "listenwhilerunning 公开演示:公版书有声书 + 项目介绍。内容为公有领域作品与项目自有文本。",
    author: "listenwhilerunning demo",
    language: "zh-CN",
  },
  sources: [],
  booksDir: "unused",
  bookCharsPerEpisode: 2500,
  maxItemsPerRun: 0,
  feedEpisodeCount: 10,
  voice: "zh-CN-YunjianNeural",
  newsStyle: "dialogue",
  dialogueVoices: ["zh-CN-YunjianNeural", "zh-CN-XiaoxiaoNeural"],
  bucket: BUCKET,
};

async function main() {
  const bookPath = process.argv[2];
  if (!bookPath) throw new Error("usage: tsx src/demogen.ts <公版书.txt>");
  const { R2_ACCOUNT_ID, R2_API_TOKEN } = process.env;
  if (!R2_ACCOUNT_ID || !R2_API_TOKEN) throw new Error("R2_ACCOUNT_ID / R2_API_TOKEN missing");

  let storage = new R2Storage(R2_ACCOUNT_ID, R2_API_TOKEN, BUCKET, "https://pending");
  await storage.ensureBucket();
  await storage.ensureCors();
  const domain = await storage.enableManagedDomain();
  storage = new R2Storage(R2_ACCOUNT_ID, R2_API_TOKEN, BUCKET, `https://${domain}`);
  console.log(`[demo] bucket ${BUCKET} @ https://${domain}`);
  await ensureCover(storage);

  const rewriteCfg = makeRewriteConfig(DEMO_CONFIG);

  // ---- 公版书:与生产完全同一条生成路径(断点续传/英文检测/导读重试都继承)----
  const name = bookPath.replace(/^.*\//, "").replace(/\.txt$/, "");
  const text = readFileSync(bookPath, "utf8").replace(/\r\n/g, "\n");
  const manifest = (await storage.loadJson<BookManifest>("books.json")) ?? { books: [] };
  await generateBookAudio(name, text, DEMO_CONFIG, storage, manifest);
  await storage.uploadJson("books.json", manifest);
  const { publishBookFeeds } = await import("./bookFeeds.js");
  await publishBookFeeds(DEMO_CONFIG, storage, manifest);

  // ---- 项目介绍资讯集(自有文本;已在 feed 里则跳过,绝不新建 state 覆盖已有集)----
  const state = await storage.loadState();
  if (!state.seen.includes("demo-intro")) {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const introText = readme
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#>*`|-]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 6000);
    const article: Article = {
      guid: "demo-intro",
      title: "「跑步听什么」是个什么项目?",
      link: "https://github.com/paceboy/listenwhilerunning",
      text: introText,
      sourceName: "listenwhilerunning",
      pubDate: new Date().toISOString(),
      group: "关于本站",
    };
    const producer = new EpisodeProducer(DEMO_CONFIG, rewriteCfg, storage);
    const ep = await producer.produce(article);
    state.seen.push(article.guid);
    await publishFeed(DEMO_CONFIG, storage, state, [ep]);
  } else {
    console.log("[demo] intro episode already in feed, skipped");
  }

  console.log(`[demo] done. feed: ${storage.publicUrl("feed.xml")}`);
  console.log(`[demo] PUBLIC_BASE=https://${domain}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
