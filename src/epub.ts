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
  return stripGutenbergBoilerplate(parts.join("\n\n"));
}

/**
 * Project Gutenberg 电子书正文前后包着许可声明,会被念进音频。
 * 正文夹在 `*** START OF THE PROJECT GUTENBERG EBOOK … ***` 与 `*** END OF … ***` 之间,
 * 两个标记都在时剥掉外层;非 Gutenberg 书没有这对标记,原样返回。
 */
function stripGutenbergBoilerplate(text: string): string {
  const start = text.match(/\*\*\*\s*START OF TH(?:E|IS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i);
  const end = text.match(/\*\*\*\s*END OF TH(?:E|IS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i);
  if (start?.index === undefined || end?.index === undefined || end.index <= start.index) return text;
  return text.slice(start.index + start[0].length, end.index).trim();
}
