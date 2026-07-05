import { readFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";

/** PDF 电子书 → 纯文本(逐页文本拼接;扫描版无文字层的 PDF 会得到空文本并报错) */
export async function pdfToText(path: string): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(path)) });
  try {
    const result = await parser.getText();
    const text = result.text
      .replace(/\r\n/g, "\n")
      .replace(/-- \d+ of \d+ --/g, "") // pdf-parse 的页脚标记
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length < 100) {
      throw new Error("PDF 几乎没有可提取文本(可能是扫描版,需要先 OCR)");
    }
    return text;
  } finally {
    await parser.destroy();
  }
}
