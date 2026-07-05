/**
 * 书籍全量切分:整本 txt 按约 charsPerEpisode 字一段切开(尽量在段落/句号处断),
 * 供 syncBooks 一次性生成全书音频。文件须为 UTF-8。
 */
export function chunkBook(text: string, charsPerEpisode: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + charsPerEpisode, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf("\n", end);
      const sentence = text.lastIndexOf("。", end);
      const cut = Math.max(para, sentence);
      if (cut > offset + charsPerEpisode / 2) end = cut + 1;
    }
    const chunk = text.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}
