import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * 域名绑定(域名须已在本 Cloudflare 账号托管/注册):
 *   npx tsx src/bindDomain.ts <域名> <pages项目名>        # 例:npx tsx src/bindDomain.ts lwr.run lwr
 *   npx tsx src/bindDomain.ts <域名> --r2 <bucket>       # R2 自定义域(feed 换正式域名用)
 * Pages 自定义域走 wrangler;R2 自定义域走 CF API(bucket 的 custom domain)。
 */
async function main() {
  const [domain, arg2, arg3] = process.argv.slice(2);
  if (!domain || !arg2) {
    console.error("usage: tsx src/bindDomain.ts <域名> <pages项目名> | <域名> --r2 <bucket>");
    process.exit(1);
  }
  const { R2_ACCOUNT_ID, R2_API_TOKEN } = process.env;
  if (!R2_ACCOUNT_ID || !R2_API_TOKEN) throw new Error("R2_ACCOUNT_ID / R2_API_TOKEN missing");

  if (arg2 === "--r2") {
    const bucket = arg3;
    if (!bucket) throw new Error("--r2 需要 bucket 名");
    // 需要域名的 zone 在同账号下;API 会自动建代理 DNS 记录
    const zoneRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${domain.split(".").slice(-2).join(".")}`,
      { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? R2_API_TOKEN}` } },
    );
    const zones = (await zoneRes.json()) as { result?: { id: string }[] };
    const zoneId = zones.result?.[0]?.id;
    if (!zoneId) throw new Error(`找不到 zone(域名要先添加到本 Cloudflare 账号):${domain}`);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}/r2/buckets/${bucket}/domains/custom`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${R2_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ domain, zoneId, enabled: true, minTLS: "1.2" }),
      },
    );
    const data = (await res.json()) as { success?: boolean; errors?: unknown };
    if (!data.success) throw new Error(`R2 绑定失败:${JSON.stringify(data.errors)}`);
    console.log(`✅ R2 bucket "${bucket}" ← https://${domain}
之后:.env 的 R2_PUBLIC_BASE 改成 https://${domain},重跑 npm run setup(重写 docs/config.js 并部署),
播客 App 重新订阅 https://${domain}/feed.xml`);
    return;
  }

  const project = arg2;
  execSync(`npx wrangler pages domain add ${domain} --project-name ${project}`, {
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: R2_ACCOUNT_ID },
  });
  console.log(`✅ Pages 项目 "${project}" ← https://${domain}(DNS 记录已自动创建,生效约几分钟)
官网项目还要:改 site/gen_pages.py 的 BASE 为 https://${domain} → python3 site/gen_pages.py → 重新部署`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
