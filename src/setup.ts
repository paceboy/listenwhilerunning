import "dotenv/config";
import { loadConfig } from "./store.js";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { R2Storage } from "./r2.js";
import type { AppConfig } from "./types.js";

/**
 * 一键部署:npm run setup
 * 前置只需要 .env 里的 R2_ACCOUNT_ID + R2_API_TOKEN(脚本会指路怎么拿)。
 * 自动完成:建 R2 bucket + 公开域名 + CORS → 生成管理口令 → 播放器指向你的存储
 * → 建 Pages 项目并部署 → 打印播放器地址/登录链接/播客订阅地址。
 * 幂等:重复运行只是把各项收敛到位,不会破坏已有部署。
 */

const ENV_PATH = new URL("../.env", import.meta.url);

function upsertEnv(key: string, value: string): void {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = text + (text === "" || text.endsWith("\n") ? "" : "\n") + line + "\n";
  writeFileSync(ENV_PATH, text);
}

async function main() {
  const config = loadConfig();

  const { R2_ACCOUNT_ID, R2_API_TOKEN } = process.env;
  if (!R2_ACCOUNT_ID || !R2_API_TOKEN) {
    console.log(`还差两个值。在 .env 里填(没有 .env 先 cp .env.example .env):

  R2_ACCOUNT_ID   Cloudflare Dash 首页右侧栏的 Account ID
  R2_API_TOKEN    打开 https://dash.cloudflare.com/?to=/:account/r2/api-tokens
                  → Create API Token → 权限选 Admin Read & Write → 复制 Token 值

填好后重新运行 npm run setup`);
    process.exit(1);
  }

  console.log("== 1/4 R2 存储 ==");
  const storage = new R2Storage(
    R2_ACCOUNT_ID,
    R2_API_TOKEN,
    config.bucket,
    process.env.R2_PUBLIC_BASE ?? "https://pending",
  );
  await storage.ensureBucket();
  await storage.ensureCors();
  const domain = await storage.enableManagedDomain();
  const publicBase = `https://${domain}`;
  upsertEnv("R2_PUBLIC_BASE", publicBase);
  console.log(`   bucket "${config.bucket}" 就绪,公开域名 ${publicBase}`);
  // 私有伴生桶(不开公开域名):收听进度/waitlist 等隐私数据
  const priv = new R2Storage(R2_ACCOUNT_ID, R2_API_TOKEN, `${config.bucket}-priv`, "https://private");
  await priv.ensureBucket();
  console.log(`   私有桶 "${config.bucket}-priv" 就绪(无公开域名)`);

  console.log("== 2/4 管理口令 ==");
  let admin = process.env.LWR_ADMIN_TOKEN;
  if (!admin) {
    admin = randomBytes(12).toString("hex");
    upsertEnv("LWR_ADMIN_TOKEN", admin);
    console.log("   已生成并写入 .env(LWR_ADMIN_TOKEN)");
  } else {
    console.log("   已有,沿用 .env 里的 LWR_ADMIN_TOKEN");
  }

  console.log("== 3/4 播放器指向你的存储 ==");
  // 写 gitignored 的 docs/config.js,不碰 git 跟踪的播放器源文件(git pull 永不冲突)
  writeFileSync(
    new URL("../docs/config.js", import.meta.url),
    `// 由 npm run setup 生成:播放器指向你自己的对象存储公开域名\nwindow.LWR_CONFIG = { base: '${publicBase}/' };\n`,
  );
  console.log(`   docs/config.js → ${publicBase}/`);

  console.log("== 4/4 部署播放器(Cloudflare Pages)==");
  let project = process.env.PAGES_PROJECT;
  if (!project) {
    // pages.dev 子域全球唯一,加随机后缀避免撞名;想改名就改 .env 的 PAGES_PROJECT 再跑一次
    project = `lwr-${randomBytes(2).toString("hex")}`;
    upsertEnv("PAGES_PROJECT", project);
  }
  // wrangler.toml 与项目名/bucket 必须一致,否则 R2 绑定不生效(设置页 API 全 500)——直接生成
  writeFileSync(
    new URL("../wrangler.toml", import.meta.url),
    `# 由 npm run setup 生成(项目名/bucket 改 .env 的 PAGES_PROJECT / config.json 的 bucket 后重跑 setup)
name = "${project}"
compatibility_date = "2026-01-01"
pages_build_output_dir = "docs"

[[r2_buckets]]
binding = "LWR"
bucket_name = "${config.bucket}"

# 私有桶(无公开域名):收听进度等隐私数据
[[r2_buckets]]
binding = "WL"
bucket_name = "${config.bucket}-priv"
`,
  );
  // wrangler 认 CLOUDFLARE_API_TOKEN;没单独配就复用 R2_API_TOKEN(.env.example 引导建的是 R2+Pages 双权限 token)
  const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: R2_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? R2_API_TOKEN,
  };
  // production branch 必须等于当前 git 分支,否则 deploy 落进 preview 环境,
  // 正式域名 <项目>.pages.dev 一直 404(本仓库默认分支是 master,不能写死 main)
  let branch = "main";
  try {
    const b = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
    if (b && b !== "HEAD") branch = b;
  } catch {
    /* 非 git 目录(下载 zip 的用户)用 main,deploy 侧也传同名 branch,两边一致即可 */
  }
  try {
    execSync(`npx wrangler pages project create ${project} --production-branch ${branch}`, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    console.log(`   Pages 项目 ${project} 已创建`);
  } catch (e) {
    const out = String((e as { stderr?: Buffer; stdout?: Buffer }).stderr ?? "") + String((e as { stdout?: Buffer }).stdout ?? "");
    if (/already exists/i.test(out)) {
      console.log(`   项目 ${project} 已存在,继续`);
      // 收敛 production branch(老版本 setup 写死过 main,分支不符会让部署落进 preview)
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}/pages/projects/${project}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ production_branch: branch }),
        },
      ).catch(() => {});
    } else {
      console.error(out);
      throw new Error(
        `创建 Pages 项目失败。最可能:API token 缺 Pages 权限——去 dash.cloudflare.com → Manage Account → Account API Tokens,给 token 加上「Cloudflare Pages:Edit」权限(或按 .env.example 重建一个 R2+Pages 双权限 token);也可以 npx wrangler login 后重试`,
      );
    }
  }
  execSync(
    `npx wrangler pages deploy docs --project-name ${project} --branch ${branch} --commit-dirty=true`,
    { stdio: "inherit", env },
  );
  execSync(`npx wrangler pages secret put ADMIN_TOKEN --project-name ${project}`, {
    stdio: ["pipe", "inherit", "inherit"],
    env,
    input: admin + "\n",
  });

  console.log(`
✅ 部署完成!

  🎧 播放器          https://${project}.pages.dev
  🔑 免填口令登录链接  https://${project}.pages.dev/#tok=${admin}
     (自己收藏,每台设备点一次即自动登录;别外传)
  📡 播客订阅地址      ${publicBase}/feed.xml
     (Apple Podcasts 等 App 里"通过 URL 关注")

下一步:
  npm run pipeline               # 立刻生成第一批资讯(config.json 里改成你的源)
  播放器设置页可上传电子书、投递单篇文章、增删订阅源
  每日自动:GitHub Actions(README 有配法)或服务器 cron
  ⚠ 用 GitHub Actions 跑每日任务时,secrets 除了 R2_ACCOUNT_ID/R2_API_TOKEN,
    还必须加 R2_PUBLIC_BASE=${publicBase}(以及可选的 LLM_API_KEY)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
