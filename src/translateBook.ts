import "dotenv/config";
import { loadConfig } from "./store.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chunkBook } from "./books.js";
import { epubToText } from "./epub.js";
import { htmlToText } from "./html.js";
import { translateChunkZh } from "./rewrite.js";
import type { AppConfig } from "./types.js";

/**
 * 整本书翻译成中文(供中文声音朗读):
 *   npm run books:translate -- <书名> [输出名]
 * 读 books/<书名>.txt(缺则先从同名 .epub/.html 提取),逐段 LLM 翻译,
 * 写 books/<输出名,默认 "<书名>中文版">.txt,之后 npm run books:sync 正常生成。
 * 原文件(.html/.epub/.txt)若不想再生成英文原声,从 books/ 挪走即可。
 */
async function main() {
  const config = loadConfig();
  const name = process.argv[2];
  if (!name) throw new Error("usage: npm run books:translate -- <书名> [输出名]");
  const outName = process.argv[3] ?? `${name}中文版`;
  const outPath = join(config.booksDir, `${outName}.txt`);
  if (existsSync(outPath)) {
    console.log(`[translate] ${outPath} already exists, nothing to do`);
    return;
  }

  // 原文件可放 books/(会同时生成原文原声)或 books-src/(只出译文,不出原声)
  let text: string | undefined;
  for (const dir of [config.booksDir, "books-src"]) {
    const txt = join(dir, `${name}.txt`);
    const epub = join(dir, `${name}.epub`);
    const html = [".html", ".htm"].map((e) => join(dir, name + e)).find(existsSync);
    if (existsSync(txt)) text = readFileSync(txt, "utf8");
    else if (existsSync(epub)) text = epubToText(epub);
    else if (html) text = htmlToText(readFileSync(html, "utf8"));
    if (text) break;
  }
  if (!text) throw new Error(`{books,books-src}/${name}.{txt,epub,html} not found`);

  const { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } = process.env;
  if (!LLM_API_KEY) throw new Error("LLM_API_KEY missing — 翻译需要 LLM");
  const cfg = {
    compat: {
      baseUrl: LLM_BASE_URL ?? "https://api.laozhang.ai/v1",
      apiKey: LLM_API_KEY,
      model: LLM_MODEL ?? "gemini-3-flash-preview",
    },
  };

  // 3000 字/段:够上下文连贯,又不顶输出上限
  const chunks = chunkBook(text.replace(/\r\n/g, "\n"), 3000);
  console.log(`[translate] "${name}" ${text.length} chars → ${chunks.length} chunks`);
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const zh = await translateChunkZh(chunks[i], cfg);
    if (!zh) throw new Error(`chunk ${i + 1}/${chunks.length} translate failed after retries`);
    out.push(zh.trim());
    if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
      // 阶段性落盘为 .part,便于中途查看;完成后落正式文件
      writeFileSync(outPath + ".part", out.join("\n\n"));
      console.log(`[translate] ${i + 1}/${chunks.length}`);
    }
  }
  writeFileSync(outPath, out.join("\n\n"));
  console.log(`[translate] done → ${outPath} (${out.join("\n\n").length} chars),跑 npm run books:sync 生成音频`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
