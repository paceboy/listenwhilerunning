import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export interface TtsProvider {
  synthesize(text: string): Promise<Buffer>;
}

/** 自用免费通道。商用时换成 MiniMaxTts 实现同一接口即可。 */
export class EdgeTts implements TtsProvider {
  constructor(private voice: string) {}

  async synthesize(text: string): Promise<Buffer> {
    const chunks = splitText(text, 1500);
    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      buffers.push(await this.synthChunk(chunk));
    }
    // 同格式 MP3 帧直接拼接,播放器可正常连续播放
    return Buffer.concat(buffers);
  }

  private async synthChunk(text: string, attempt = 1): Promise<Buffer> {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(this.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      // msedge-tts 把文本原样嵌进 SSML,裸 & < > 会让 XML 非法,服务端返回空音频
      const { audioStream } = tts.toStream(
        text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      );
      const parts: Buffer[] = [];
      for await (const part of audioStream) {
        parts.push(part as Buffer);
      }
      const buf = Buffer.concat(parts);
      if (buf.length === 0) throw new Error("empty audio");
      return buf;
    } catch (e) {
      // "empty audio" 多为微软端对持续合成的节流,退避要给足
      if (attempt < 5) {
        const wait = 5000 * attempt * attempt; // 5s/20s/45s/80s
        console.warn(`[tts] chunk failed (attempt ${attempt}): ${(e as Error).message}, retry in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        return this.synthChunk(text, attempt + 1);
      }
      throw e;
    } finally {
      tts.close();
    }
  }
}

export interface DialogueLine {
  speaker: number;
  text: string;
}

/** 解析 "A: …" / "B: …" 对话脚本;有效台词少于 3 行视为普通旁白,返回 null */
export function parseDialogue(script: string): DialogueLine[] | null {
  const lines: DialogueLine[] = [];
  for (const raw of script.split("\n")) {
    // 全角冒号用 ： 转义,避免全角字符在编辑/复制中悄悄变半角(踩过坑:导读全被 parse failed)
    const m = raw.match(/^\s*\*{0,2}([AB])\*{0,2}\s*[:\uFF1A]\s*(.+)$/);
    if (m) lines.push({ speaker: m[1] === "A" ? 0 : 1, text: m[2].trim() });
  }
  return lines.length >= 3 ? lines : null;
}

/** 双主播对话合成:speaker 0/1 各用一个声音,逐段合成后拼接 */
export class DialogueTts {
  private tts: EdgeTts[];

  constructor(voices: [string, string]) {
    this.tts = voices.map((v) => new EdgeTts(v));
  }

  async synthesize(lines: DialogueLine[]): Promise<Buffer> {
    // 合并连续同一说话人的台词,减少 TTS 连接次数
    const merged: DialogueLine[] = [];
    for (const l of lines) {
      const last = merged[merged.length - 1];
      if (last && last.speaker === l.speaker) last.text += " " + l.text;
      else merged.push({ ...l });
    }
    const buffers: Buffer[] = [];
    for (const seg of merged) {
      buffers.push(await this.tts[seg.speaker].synthesize(seg.text));
    }
    return Buffer.concat(buffers);
  }
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    // 尽量在句号(中/英)或换行处断开
    let cut = rest.lastIndexOf("。", maxLen);
    if (cut < maxLen / 2) cut = Math.max(rest.lastIndexOf(". ", maxLen), rest.lastIndexOf("\n", maxLen));
    if (cut < maxLen / 2) cut = maxLen;
    parts.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}
