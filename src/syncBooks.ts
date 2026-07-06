import "dotenv/config";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { acquireLock } from "./lock.js";
import { chunkBook } from "./books.js";
import { epubToText } from "./epub.js";
import { htmlToText } from "./html.js";
import { pdfToText } from "./pdf.js";
import { convertToEpub } from "./convert.js";
import { bookIntroScript, summarizeText } from "./rewrite.js";
import { DialogueTts, EdgeTts, parseDialogue } from "./tts.js";
import { makeStore, loadConfig } from "./store.js";
import { resolveRemoteConfig } from "./produce.js";
import type { AppConfig } from "./types.js";

/**
 * 书籍音频与 books/ 目录做全量同步:
 * - 目录里的每本 .txt 整本生成音频到 bucket bookaudio/<id>/<part>.mp3(断点续传,已有的跳过)
 * - 清单 books.json 逐集更新,网页播放器即时可见
 * - 删书释放空间用显式命令 npm run books:remove -- <书名>(不按本地目录自动清,
 *   因为 GHA 等无状态环境 books/ 恒为空,自动清会误删全部音频)
 */

export interface BookPart {
  p: number;
  path: string;
  bytes: number;
  chars: number;
  /** 一句话概要,播放器单集简介 */
  s?: string;
}
export interface BookEntry {
  id: string;
  name: string;
  charsPerPart: number;
  totalParts: number;
  totalChars: number;
  /** 第 0 集:两位主播的对话导读(可选,LLM 不可用时缺省) */
  intro?: BookPart;
  /** 英文书标记(集名/feed 文案用英文);缺省视为中文 */
  lang?: "en" | "zh";
  parts: BookPart[];
}
export interface BookManifest {
  books: BookEntry[];
}

const MANIFEST_PATH = "books.json";
const UPLOADS_PREFIX = "bookuploads/";

/**
 * 播放器设置页上传的电子书暂存在 bucket 的 bookuploads/;
 * 拉到本地 books/ 后源文件仍留在 bucket(整本生成完成后才由 syncBooksAll 删除),
 * 返回导入的 {file: 本地文件名, key: bucket key} 列表。
 */
export async function importBookUploads(
  storage: import("./storage.js").ObjectStore,
  booksDir: string,
): Promise<{ file: string; key: string }[]> {
  let keys: string[] = [];
  try {
    keys = await storage.list(UPLOADS_PREFIX);
  } catch (e) {
    console.warn(`[books] list uploads failed: ${(e as Error).message}`);
    return [];
  }
  const imported: { file: string; key: string }[] = [];
  for (const key of keys) {
    const rawName = basename(key.slice(UPLOADS_PREFIX.length));
    if (!/\.(epub|txt|html?|pdf|mobi|azw3?|fb2|docx)$/i.test(rawName) || rawName.startsWith(".")) {
      console.warn(`[books] upload ignored (bad name): ${key}`);
      continue;
    }
    // 电子书站下载的文件名常是「书名 -- 作者 -- 出版社 -- hash」,取第一段作书名
    const ext = rawName.slice(rawName.lastIndexOf("."));
    const title = basename(rawName, ext)
      .split(/\s+--\s+/)[0]
      .replace(/[((][^))]*[))]\s*$/, "") // 尾部括号里的宣传语
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const base = title || basename(rawName, ext);
    try {
      const body = await storage.downloadFile(key);
      mkdirSync(booksDir, { recursive: true });
      // 清洗后同名但内容不同的另一本书(如「上册/下册」清成同名):加序号防覆盖
      let name = base + ext.toLowerCase();
      for (let n = 2; existsSync(join(booksDir, name)) && statSync(join(booksDir, name)).size !== body.length; n++) {
        name = `${base}_${n}${ext.toLowerCase()}`;
      }
      writeFileSync(join(booksDir, name), body);
      // 源文件保留在 bucket,整本音频生成完毕后才删(见 syncBooksAll),
      // 防止无状态环境(GHA)中途失败导致上传的书永久丢失
      imported.push({ file: name, key });
      console.log(`[books] upload imported: ${name} (${Math.round(body.length / 1024)} KB)`);
    } catch (e) {
      console.error(`[books] upload import failed for ${rawName}: ${(e as Error).message}`);
    }
  }
  return imported;
}

/**
 * 单本书 → 整本音频(断点续传:清单里已有的集跳过;导读缺则补;概要缺则回填)。
 * syncBooksAll(生产)与 demogen(演示站)共用;manifest 由调用方持有,函数负责逐集落盘更新。
 */
export async function generateBookAudio(
  name: string,
  text: string,
  config: Pick<AppConfig, "voice" | "voiceEn" | "bookCharsPerEpisode" | "dialogueVoices">,
  storage: import("./storage.js").ObjectStore,
  manifest: BookManifest,
): Promise<BookEntry> {
  const { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } = process.env;
  const summaryCfg = {
    compat: LLM_API_KEY
      ? {
          baseUrl: LLM_BASE_URL ?? "https://api.laozhang.ai/v1",
          apiKey: LLM_API_KEY,
          model: LLM_MODEL ?? "gemini-3-flash-preview",
        }
      : undefined,
  };
  const fallbackSummary = (chunk: string) => chunk.replace(/\s+/g, " ").slice(0, 30) + "…";

  // 英文书用英文声音:CJK 字符占比 < 5% 视为英文
  const cjkRatio = (text.match(/[一-鿿]/g)?.length ?? 0) / text.length;
  const isEn = cjkRatio < 0.05;
  const lang: "en" | "zh" = isEn ? "en" : "zh";
  const bookVoice = isEn ? (config.voiceEn ?? "en-US-ChristopherNeural") : config.voice;
  const tts = new EdgeTts(bookVoice);
  if (isEn) console.log(`[books] "${name}" detected English, voice ${bookVoice}`);
  // 英文含空格、语速按词计,同等时长约需 3 倍字符数
  const charsPerPart = isEn ? config.bookCharsPerEpisode * 3 : config.bookCharsPerEpisode;
  const introVoices = isEn
    ? (["en-US-GuyNeural", "en-US-JennyNeural"] as [string, string])
    : (config.dialogueVoices?.length ?? 0) >= 2
      ? ([config.dialogueVoices![0], config.dialogueVoices![1]] as [string, string])
      : undefined;
  const dialogueTts = introVoices ? new DialogueTts(introVoices) : undefined;
  const chunks = chunkBook(text, charsPerPart);
  const id = createHash("sha1").update(name).digest("hex").slice(0, 8);
  let entry = manifest.books.find((b) => b.id === id);
  if (entry && entry.charsPerPart !== charsPerPart) {
    console.log(`[books] "${name}" charsPerPart changed, regenerating from scratch`);
    for (const part of entry.parts) await storage.delete(part.path);
    entry.parts = [];
  }
  if (!entry) {
    entry = {
      id,
      name,
      charsPerPart,
      totalParts: chunks.length,
      totalChars: text.length,
      parts: [],
    };
    manifest.books.push(entry);
  }
  entry.charsPerPart = charsPerPart;
  entry.lang = lang;
  entry.totalParts = chunks.length;
  entry.totalChars = text.length;
  // 文本变短后残留的多余集
  for (const stale of entry.parts.filter((x) => x.p > chunks.length)) {
    await storage.delete(stale.path);
  }
  entry.parts = entry.parts.filter((x) => x.p <= chunks.length);

  // 第 0 集对话导读:两位主播聊这本书讲什么、为什么值得听(缺 LLM 或脚本解析失败则跳过)
  if (!entry.intro) {
    const mid = Math.floor(text.length / 2);
    const samples =
      text.slice(0, 4000) + "\n……\n" + text.slice(mid, mid + 2000) + "\n……\n" + text.slice(-2000);
    let script: string | null = null;
    for (let att = 1; att <= 3 && !script; att++) {
      script = await bookIntroScript(name, samples, summaryCfg, lang);
      if (!script && att < 3) console.warn(`[books] ${name} 导读 LLM attempt ${att} failed, retrying`);
    }
    const dialogue = script ? parseDialogue(script) : null;
    if (!script) console.warn(`[books] ${name} 导读 skipped: LLM unavailable`);
    else if (!dialogue) console.warn(`[books] ${name} 导读 skipped: dialogue parse failed`);
    else if (!dialogueTts) console.warn(`[books] ${name} 导读 skipped: dialogueVoices not configured`);
    if (script && dialogue && dialogueTts) {
      const audio = await dialogueTts.synthesize(dialogue);
      const path = `bookaudio/${id}/0.mp3`;
      await storage.uploadAudio(path, audio);
      entry.intro = {
        p: 0,
        path,
        bytes: audio.length,
        chars: script.length,
        s: isEn
          ? "Two hosts on this book: what it is about and why it is worth your time"
          : "两位主播聊这本书:讲什么、为什么值得听、带着什么问题去听",
      };
      await storage.uploadJson(MANIFEST_PATH, manifest);
      console.log(`[books] ${name} 导读 ready (${Math.round(audio.length / 1024)} KB)`);
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    const p = i + 1;
    if (entry.parts.some((x) => x.p === p)) continue;
    await new Promise((r) => setTimeout(r, 3000)); // 集间歇,降低被节流概率
    const audio = await tts.synthesize(chunks[i]);
    const path = `bookaudio/${id}/${p}.mp3`;
    await storage.uploadAudio(path, audio);
    const s = (await summarizeText(chunks[i], summaryCfg, lang)) ?? fallbackSummary(chunks[i]);
    entry.parts.push({ p, path, bytes: audio.length, chars: chunks[i].length, s });
    entry.parts.sort((a, b) => a.p - b.p);
    await storage.uploadJson(MANIFEST_PATH, manifest);
    console.log(`[books] ${name} ${p}/${chunks.length} (${Math.round(audio.length / 1024)} KB)`);
  }

  // 已有集缺概要的补上(老清单回填,不重做音频)
  let backfilled = 0;
  for (const part of entry.parts.filter((x) => !x.s)) {
    const chunk = chunks[part.p - 1];
    if (!chunk) continue;
    part.s = (await summarizeText(chunk, summaryCfg, lang)) ?? fallbackSummary(chunk);
    backfilled++;
    if (backfilled % 10 === 0) await storage.uploadJson(MANIFEST_PATH, manifest);
  }
  if (backfilled > 0) {
    await storage.uploadJson(MANIFEST_PATH, manifest);
    console.log(`[books] ${name}: ${backfilled} summaries backfilled`);
  }
  return entry;
}

export async function syncBooksAll() {
  if (!acquireLock("books")) {
    console.log("[books] another book sync is running, skip");
    return;
  }
  let config = loadConfig();
  const storage = makeStore(config.bucket);
  await storage.ensureBucket();
  config = await resolveRemoteConfig(config, storage);
  const uploads = await importBookUploads(storage, config.booksDir);
  const uploadKeyByBook = new Map(uploads.map((u) => [u.file.replace(/\.[^.]+$/, ""), u.key]));
  const manifest = (await storage.loadJson<BookManifest>(MANIFEST_PATH)) ?? { books: [] };

  // epub/html/pdf/mobi 等先转 txt(已有同名 txt 的跳过;Kindle/fb2/docx 经 Calibre 转 epub 再提取)
  if (existsSync(config.booksDir)) {
    for (const f of readdirSync(config.booksDir).filter((x) => /\.(epub|html?|pdf|mobi|azw3?|fb2|docx)$/i.test(x))) {
      const rawExt = f.slice(f.lastIndexOf("."));
      const ext = rawExt.toLowerCase();
      const txtPath = join(config.booksDir, `${basename(f, rawExt)}.txt`);
      if (existsSync(txtPath)) continue;
      try {
        const src = join(config.booksDir, f);
        let text: string;
        if (ext === ".epub") text = epubToText(src);
        else if (ext === ".pdf") text = await pdfToText(src);
        else if (ext === ".html" || ext === ".htm") text = htmlToText(readFileSync(src, "utf8"));
        else {
          const tmp = convertToEpub(src);
          try {
            text = epubToText(tmp);
          } finally {
            rmSync(tmp, { force: true });
          }
        }
        writeFileSync(txtPath, text);
        console.log(`[books] ${f} → ${basename(txtPath)} (${text.length} chars)`);
      } catch (e) {
        console.error(`[books] convert failed for ${f}: ${(e as Error).message}`);
      }
    }
  }

  const localNames = existsSync(config.booksDir)
    ? readdirSync(config.booksDir)
        .filter((f) => f.endsWith(".txt"))
        .map((f) => basename(f, ".txt"))
        .sort()
    : [];

  // 1) 本地没有 txt 的书只提示、绝不自动删——无状态环境(GHA)books/ 每次都是空的,
  //    自动清除会把所有已生成音频一锅端。删书用显式命令:npm run books:remove -- <书名>
  const orphans = manifest.books.filter((b) => !localNames.includes(b.name));
  if (orphans.length > 0) {
    console.log(
      `[books] ${orphans.length} book(s) not in local ${config.booksDir}/ (kept): ${orphans.map((b) => b.name).join(", ")}` +
        `\n[books]   要删除某本书释放空间:npm run books:remove -- <书名>`,
    );
  }

  // 2) 生成:缺的集补齐(每集完成即更新清单,可中断重跑)
  for (const name of localNames) {
    const text = readFileSync(join(config.booksDir, `${name}.txt`), "utf8").replace(/\r\n/g, "\n");
    const entry = await generateBookAudio(name, text, config, storage, manifest);

    // 整本音频齐了才删 bucket 里的上传源文件;中途失败下次运行会重新导入续传
    const upKey = uploadKeyByBook.get(name);
    if (upKey && entry.parts.length === entry.totalParts) {
      await storage.delete(upKey);
      console.log(`[books] upload source cleaned after completion: ${name}`);
    }
  }

  // 3) 每本书的独立播客 feed(Apple Podcasts 等按"一本书=一档节目"订阅)
  const { publishBookFeeds } = await import("./bookFeeds.js");
  await publishBookFeeds(config, storage, manifest);

  // 4) 空间占用报告
  const bookBytes = manifest.books
    .flatMap((b) => [...b.parts, ...(b.intro ? [b.intro] : [])])
    .reduce((s, x) => s + x.bytes, 0);
  const state = await storage.loadState();
  const epBytes = state.episodes.reduce((s, e) => s + e.audioBytes, 0);
  const totalMb = (bookBytes + epBytes) / 1e6;
  // 与 storageFromEnv 的选择条件保持一致:R2 免费 10GB / Supabase 1GB
  const { R2_ACCOUNT_ID, R2_API_TOKEN, R2_PUBLIC_BASE } = process.env;
  const quotaMb = R2_ACCOUNT_ID && R2_API_TOKEN && R2_PUBLIC_BASE ? 10000 : 1000;
  console.log(
    `[books] done. bucket ≈ ${totalMb.toFixed(0)} MB (books ${(bookBytes / 1e6).toFixed(0)} + episodes ${(epBytes / 1e6).toFixed(0)}), 免费额度 ${quotaMb / 1000}GB`,
  );
  if (totalMb > quotaMb * 0.8) {
    console.warn(`[books] ⚠ 接近额度:把听完的书的 .txt 从 ${config.booksDir}/ 删掉再跑一次本命令即可释放`);
  }
}

// 直接 `npm run books:sync` 时执行;被 index.ts 当模块 import 时不自动跑
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  syncBooksAll().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
