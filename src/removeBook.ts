import "dotenv/config";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeStore, loadConfig } from "./store.js";
import type { AppConfig } from "./types.js";

/**
 * 显式删书释放空间:npm run books:remove -- <书名>
 * 删 bucket 里该书全部音频 + 清单条目 + 本地 books/ 源文件。
 * (不做"本地文件消失即自动删"是有意的:GHA 等无状态环境会误删一切)
 */
interface BookPart { p: number; path: string }
interface BookManifest { books: { id: string; name: string; intro?: BookPart; parts: BookPart[] }[] }

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: npm run books:remove -- <书名>");
    process.exit(1);
  }
  const config = loadConfig();
  const storage = makeStore(config.bucket);
  const manifest = (await storage.loadJson<BookManifest>("books.json")) ?? { books: [] };
  const entry = manifest.books.find((b) => b.name === name);
  if (!entry) {
    console.error(`[books] "${name}" 不在清单里。现有:${manifest.books.map((b) => b.name).join(", ") || "(空)"}`);
    process.exit(1);
  }
  let bytes = 0;
  for (const part of [...entry.parts, ...(entry.intro ? [entry.intro] : [])]) {
    await storage.delete(part.path);
    bytes += (part as { bytes?: number }).bytes ?? 0;
  }
  manifest.books = manifest.books.filter((b) => b.id !== entry.id);
  await storage.uploadJson("books.json", manifest);
  await storage.delete(`bookfeed/${entry.id}.xml`).catch(() => {});
  for (const ext of [".txt", ".epub", ".html", ".htm"]) {
    const p = join(config.booksDir, name + ext);
    if (existsSync(p)) {
      rmSync(p);
      console.log(`[books] local removed: ${p}`);
    }
  }
  console.log(`[books] removed "${name}" (${entry.parts.length} parts, ~${(bytes / 1e6).toFixed(0)} MB freed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
