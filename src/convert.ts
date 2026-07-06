import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** 需要 Calibre 转换的电子书格式(转成 epub 后复用 epubToText) */
export const CALIBRE_EXT_RE = /\.(mobi|azw3?|fb2|docx)$/i;

function hasEbookConvert(): boolean {
  try {
    execFileSync("ebook-convert", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureEbookConvert(): void {
  if (hasEbookConvert()) return;
  // GHA runner 有免密 sudo:遇到 Kindle 格式时按需装,平时 poll 不背这 2 分钟安装
  if (process.env.GITHUB_ACTIONS) {
    console.log("[convert] ebook-convert not found, installing calibre on GHA runner…");
    execFileSync("sudo", ["apt-get", "update", "-qq"], { stdio: "inherit" });
    execFileSync(
      "sudo",
      ["apt-get", "install", "-y", "-qq", "--no-install-recommends", "calibre"],
      { stdio: "inherit" },
    );
    if (hasEbookConvert()) return;
  }
  throw new Error(
    "转换 mobi/azw3/fb2/docx 需要 Calibre 的 ebook-convert(sudo apt-get install -y calibre);源文件已保留,装好后重跑即可",
  );
}

/** mobi/azw/azw3/fb2/docx → 临时 epub,返回临时文件路径(调用方用完负责删除) */
export function convertToEpub(src: string): string {
  ensureEbookConvert();
  const out = join(tmpdir(), `${basename(src).replace(/\.[^.]+$/, "")}.lwr.epub`);
  rmSync(out, { force: true });
  execFileSync("ebook-convert", [src, out], { stdio: ["ignore", "ignore", "inherit"] });
  if (!existsSync(out)) throw new Error(`ebook-convert produced no output for ${src}`);
  return out;
}
