import "dotenv/config";
import { readFileSync } from "node:fs";
import { makeStore, makePrivStore, loadConfig } from "./store.js";
import { runAdd } from "./addUrl.js";
import { syncBooksAll } from "./syncBooks.js";
import type { AppConfig } from "./types.js";

/**
 * "随传随听"轮询(systemd timer 每几分钟跑一次):
 * - bucket 的 bookuploads/ 有新电子书 → 立刻导入并开始生成音频(生成快于播放约 10 倍,
 *   用户几分钟后就能从第 1 集边生成边听,无需等每日批次)
 * - queue.json 有设置页投递的单篇 URL → 立刻转成一集
 * 什么都没有时两次对象存储查询就退出,成本可忽略。
 * 与每日管线/books:sync 的互斥由 src/lock.ts 的进程锁保证(runAdd/syncBooksAll 内部各自持锁)。
 */
async function main() {
  const config = loadConfig();
  const storage = makeStore(config.bucket);

  const priv = makePrivStore(config.bucket);
  const [queue, uploads, inboxKeys] = await Promise.all([
    storage.loadJson<{ urls?: string[] }>("queue.json"),
    storage.list("bookuploads/"),
    priv ? priv.list("inbox/").catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);
  const hasUrls = (queue?.urls ?? []).some((u) => /^https?:\/\//.test(u)) || inboxKeys.length > 0;

  if (!hasUrls && uploads.length === 0) {
    console.log("[poll] nothing new");
    return;
  }
  if (hasUrls) {
    console.log("[poll] queued urls found, producing…");
    await runAdd([]);
  }
  if (uploads.length > 0) {
    console.log(`[poll] ${uploads.length} uploaded book(s) found, syncing…`);
    await syncBooksAll();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
