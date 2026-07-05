import { createHash } from "node:crypto";
import type { ObjectStore } from "./storage.js";
import type { Article } from "./types.js";

/**
 * Newsletter 收件箱(私有桶 inbox/,Email Worker 写入):
 * 读出待转邮件 → Article;发布完成后调 clearInbox 删除。
 * 邮件属隐私数据,只走私有桶;转出的音频进用户自己的私人 feed。
 */
export interface InboxItem {
  key: string;
  article: Article;
}

export async function readInbox(priv: ObjectStore): Promise<InboxItem[]> {
  let keys: string[] = [];
  try {
    keys = await priv.list("inbox/");
  } catch {
    return [];
  }
  const items: InboxItem[] = [];
  for (const key of keys.slice(0, 20)) {
    try {
      const m = JSON.parse((await priv.downloadFile(key)).toString("utf8")) as {
        subject?: string;
        from?: string;
        date?: string;
        text?: string;
      };
      if (!m.text || m.text.length < 100) {
        await priv.delete(key);
        continue;
      }
      items.push({
        key,
        article: {
          guid: "mail-" + createHash("sha1").update(key).digest("hex").slice(0, 12),
          title: m.subject || "(no subject)",
          link: "",
          text: m.text,
          sourceName: m.from || "newsletter",
          pubDate: m.date || new Date().toISOString(),
          group: "邮件",
        },
      });
    } catch (e) {
      console.warn(`[inbox] bad item ${key}: ${(e as Error).message}`);
    }
  }
  if (items.length) console.log(`[inbox] ${items.length} newsletter(s) pending`);
  return items;
}

export async function clearInbox(priv: ObjectStore, items: InboxItem[]): Promise<void> {
  for (const it of items) await priv.delete(it.key);
}
