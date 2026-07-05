import type { RewriteConfig } from "./rewrite.js";
import { rewriteToScript } from "./rewrite.js";
import { DialogueTts, EdgeTts, parseDialogue } from "./tts.js";
import type { ObjectStore } from "./storage.js";
import { buildFeedXml } from "./feed.js";
import { existsSync, readFileSync } from "node:fs";
import type { AppConfig, Article, Episode, State } from "./types.js";

/** index.ts(定时管线)与 addUrl.ts(单篇即时转)共用的生成/发布逻辑 */

export function makeRewriteConfig(config: AppConfig): RewriteConfig {
  const { GEMINI_API_KEY, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } = process.env;
  return {
    geminiApiKey: GEMINI_API_KEY,
    style: config.newsStyle,
    compat: LLM_API_KEY
      ? {
          baseUrl: LLM_BASE_URL ?? "https://api.laozhang.ai/v1",
          apiKey: LLM_API_KEY,
          model: LLM_MODEL ?? "gemini-3-flash-preview",
        }
      : undefined,
  };
}

export class EpisodeProducer {
  private tts: EdgeTts;
  private dialogueTts?: DialogueTts;

  constructor(
    private config: AppConfig,
    private rewriteCfg: RewriteConfig,
    private storage: ObjectStore,
  ) {
    this.tts = new EdgeTts(config.voice);
    this.dialogueTts =
      config.newsStyle === "dialogue" && (config.dialogueVoices?.length ?? 0) >= 2
        ? new DialogueTts([config.dialogueVoices![0], config.dialogueVoices![1]])
        : undefined;
  }

  /** 文章 → 改写 → 合成 → 上传,返回可入 feed 的 Episode */
  async produce(article: Article): Promise<Episode> {
    let script = article.skipRewrite
      ? article.text
      : await rewriteToScript(article, this.rewriteCfg);
    let audio: Buffer;
    const dialogue = !article.skipRewrite && this.dialogueTts ? parseDialogue(script) : null;
    if (dialogue && this.dialogueTts) {
      audio = await this.dialogueTts.synthesize(dialogue);
      script = dialogue.map((l) => l.text).join(" "); // description 用去掉说话人标记的文本
    } else {
      audio = await this.tts.synthesize(script);
    }
    const audioPath = `episodes/${article.guid}.mp3`;
    await this.storage.uploadAudio(audioPath, audio);
    // 逐字稿:播放器"文稿"按钮按需读取;失败只警告,不影响出集
    try {
      const doc = dialogue
        ? dialogue.map((l) => (l.speaker === 0 ? "A: " : "B: ") + l.text).join("\n\n")
        : script;
      await this.storage.uploadFile(`transcripts/${article.guid}.txt`, Buffer.from(doc), "text/plain; charset=utf-8");
    } catch (e) {
      console.warn(`[produce] transcript upload failed: ${(e as Error).message}`);
    }
    return {
      id: article.guid,
      title: article.title,
      description: script.slice(0, 200),
      link: article.link,
      sourceName: article.sourceName,
      pubDate: article.pubDate,
      audioPath,
      audioBytes: audio.length,
      group: article.group,
    };
  }
}

/**
 * 设置页把订阅源等配置写在 bucket 的 config.json;存在则覆盖本地 config.json。
 * bucket/booksDir 是服务器本地事实,永远以本地为准。首次运行把本地配置播种上去。
 */
export async function resolveRemoteConfig(
  config: AppConfig,
  storage: ObjectStore,
  seed = false,
): Promise<AppConfig> {
  const remote = await storage.loadJson<Partial<AppConfig>>("config.json");
  if (remote && Array.isArray(remote.sources)) {
    return { ...config, ...remote, bucket: config.bucket, booksDir: config.booksDir };
  }
  if (seed) await storage.uploadJson("config.json", config);
  return config;
}

/** 播客封面:仓库 assets/cover.png,bucket 里没有时上传一次 */
export async function ensureCover(storage: ObjectStore): Promise<void> {
  const coverLocal = new URL("../assets/cover.png", import.meta.url);
  if (existsSync(coverLocal) && !(await storage.exists("cover.png"))) {
    await storage.uploadFile("cover.png", readFileSync(coverLocal), "image/png");
    console.log("[pipeline] cover.png uploaded");
  }
}

/** 新集并入 state、淘汰旧集音频、保存 state、重建 feed.xml */
export async function publishFeed(
  config: AppConfig,
  storage: ObjectStore,
  state: State,
  newEpisodes: Episode[],
): Promise<string> {
  const allEpisodes = [...newEpisodes, ...state.episodes];
  state.episodes = allEpisodes.slice(0, config.feedEpisodeCount);
  // 被挤出 feed 的旧集连同音频一起清掉,防止 bucket 无限膨胀
  for (const dropped of allEpisodes.slice(config.feedEpisodeCount)) {
    await storage.delete(dropped.audioPath);
    console.log(`[pipeline] pruned old episode: ${dropped.title}`);
  }
  await storage.saveState(state);

  const feedUrl = storage.publicUrl("feed.xml");
  const xml = buildFeedXml(
    config,
    state.episodes,
    (p) => storage.publicUrl(p),
    feedUrl,
    storage.publicUrl("cover.png"),
  );
  await storage.uploadFeed(xml);
  return feedUrl;
}
