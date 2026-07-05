import "dotenv/config";
import { R2Storage } from "./r2.js";

/**
 * 查看托管版 waitlist:npm run waitlist
 * 官网 /api/wait 写进私有 bucket lwr-priv 的 waitlist/<email> 对象(公开 bucket 会泄露 PII)。
 */
const PRIV_BUCKET = "lwr-priv";

function fmtBeijing(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function main() {
  const { R2_ACCOUNT_ID, R2_API_TOKEN } = process.env;
  if (!R2_ACCOUNT_ID || !R2_API_TOKEN) throw new Error("R2_ACCOUNT_ID / R2_API_TOKEN missing");
  const storage = new R2Storage(R2_ACCOUNT_ID, R2_API_TOKEN, PRIV_BUCKET, "https://private");
  const keys = await storage.list("waitlist/");
  console.log(`waitlist: ${keys.length} 人`);
  for (const key of keys) {
    const email = key.slice("waitlist/".length);
    let at = "";
    try {
      at = fmtBeijing(JSON.parse((await storage.downloadFile(key)).toString("utf8")).at);
    } catch {}
    console.log(`  ${at}  ${email}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
