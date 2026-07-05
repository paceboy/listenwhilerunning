import AdmZip from "adm-zip";
import { dirname, posix } from "node:path";
import { htmlToText } from "./html.js";

/**
 * epub → 纯文本:按 spine 顺序拼接各章,跳过目录/封面/导航页。
 * mobi 不支持——用 Calibre 转成 epub 再放进 books/。
 */
export function epubToText(file: string): string {
  const zip = new AdmZip(file);
  const read = (p: string): string | null => {
    const entry = zip.getEntry(p) ?? zip.getEntry(decodeURIComponent(p));
    return entry ? entry.getData().toString("utf8") : null;
  };

  const container = read("META-INF/container.xml");
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error(`${file}: not a valid epub (no OPF path)`);
  const opf = read(opfPath);
  if (!opf) throw new Error(`${file}: OPF missing`);
  const opfDir = dirname(opfPath);

  // manifest: id → {href, props}
  const manifest = new Map<string, { href: string; props: string }>();
  for (const m of opf.matchAll(/<item\s+[^>]*?\/?>/g)) {
    const tag = m[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) {
      manifest.set(id, { href, props: tag.match(/\bproperties="([^"]+)"/)?.[1] ?? "" });
    }
  }

  const parts: string[] = [];
  for (const m of opf.matchAll(/<itemref\s+[^>]*?idref="([^"]+)"/g)) {
    const item = manifest.get(m[1]);
    if (!item) continue;
    if (item.props.includes("nav")) continue;
    if (/(^|\/)(cover|toc|nav|titlepage|copyright)[^/]*$/i.test(item.href)) continue;
    const path = opfDir === "." ? item.href : posix.join(opfDir, item.href);
    const html = read(path);
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length > 50) parts.push(text);
  }
  if (parts.length === 0) throw new Error(`${file}: no readable chapters in spine`);
  return parts.join("\n\n");
}
