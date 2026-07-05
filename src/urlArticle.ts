import { createHash } from "node:crypto";
import { decodeEntities, htmlToText } from "./html.js";
import type { Article } from "./types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function urlGuid(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

/** 任意网页 → Article:og:title/<title> 取标题,<p> 聚合取正文,太少则退回全文剥标签 */
export async function fetchUrlArticle(url: string): Promise<Article> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`);
  const html = await res.text();

  const rawTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    url;
  const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();

  const stripped = html
    .replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const paragraphs = [...stripped.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)]
    .map((m) => htmlToText(m[0]))
    .filter((t) => t.length > 20);
  let text = paragraphs.join("\n");
  if (text.length < 300) text = htmlToText(stripped);
  text = text.slice(0, 20000);
  if (text.length < 100) throw new Error(`${url}: extracted only ${text.length} chars, not an article page?`);

  return {
    guid: urlGuid(url),
    title,
    link: url,
    sourceName: new URL(url).hostname.replace(/^www\./, ""),
    pubDate: new Date().toISOString(),
    text,
  };
}
