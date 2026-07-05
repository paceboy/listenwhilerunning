import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 同机进程互斥锁(防 poll / pipeline / books:sync 并发读改写 state.json、books.json):
 *   feed  锁:资讯生产+发 feed(index.ts 主流程、runAdd)
 *   books 锁:整本书生成(syncBooksAll)
 * 锁文件带 pid,持有进程已死则自动接管。跨机并发(GHA+VPS 同开)不受本锁保护,
 * GHA 侧由 workflow 的 concurrency 组防重叠,两边同时开启的部署方式文档标注不支持。
 */
export function acquireLock(name: "feed" | "books"): boolean {
  const dir = join(tmpdir(), "lwr-locks");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx" });
      process.on("exit", () => {
        try {
          if (readFileSync(file, "utf8") === String(process.pid)) rmSync(file);
        } catch {}
      });
      return true;
    } catch {
      try {
        const pid = Number(readFileSync(file, "utf8"));
        process.kill(pid, 0); // 持有者活着
        return false;
      } catch {
        // 持有者已死或文件损坏:清掉重试一次
        try {
          rmSync(file);
        } catch {}
      }
    }
  }
  return false;
}
