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
  raw: { subject?: string; from?: string; date?: string; text?: string; attempts?: number };
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
      const m = JSON.parse((await priv.downloadFile(key)).toString("utf8")) as InboxItem["raw"];
      if (!m.text || m.text.length < 100) {
        await priv.delete(key);
        continue;
      }
      items.push({
        key,
        raw: m,
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

/**
 * 生成失败:邮件是唯一副本,绝不能直接删——记一次失败留桶等下轮重试,
 * 连败 3 次(LLM/TTS 持续故障或毒邮件)才放弃删除,防 poll 每 3 分钟空转死循环。
 */
export async function failInbox(priv: ObjectStore, item: InboxItem): Promise<void> {
  const attempts = (item.raw.attempts ?? 0) + 1;
  try {
    if (attempts >= 3) {
      console.warn(`[inbox] giving up after ${attempts} attempts: ${item.key}`);
      await priv.delete(item.key);
    } else {
      await priv.uploadJson(item.key, { ...item.raw, attempts });
    }
  } catch (e) {
    console.warn(`[inbox] fail-mark error ${item.key}: ${(e as Error).message}`);
  }
}
