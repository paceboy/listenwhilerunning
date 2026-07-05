/** HTML → 朗读用纯文本(块级标签断行、去脚注标记、实体解码) */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      // 上标脚注标记(<sup>3</sup> / [3])读出来是噪音
      .replace(/<sup[\s\S]*?<\/sup>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\[\d+\]/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

export function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    hellip: "…", mdash: "—", ndash: "–", ldquo: "“", rdquo: "”",
    lsquo: "‘", rsquo: "’", middot: "·", times: "×",
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}
