# listenwhilerunning · 跑步听什么

Turn **your own RSS feeds and ebooks** into a personal podcast you can binge on runs and commutes — open source, zero backend, roughly **$0/month**.

**[Live demo](https://demo.runcast.app)** · [Website](https://runcast.app) · [中文文档 ↓](#中文)

<p align="center">
  <img src="assets/screenshots/demo-news.png" alt="News tab: AI-generated dialogue episodes" width="300">
  &nbsp;&nbsp;
  <img src="assets/screenshots/demo-books.png" alt="Books tab: serialized audiobook with AI intro and per-episode summaries" width="300">
</p>

- 📰 **News → two-host dialogue podcast**: RSS / subreddits / any article URL → LLM rewrites into a natural conversation → neural TTS → new episodes appear in your podcast app every morning
- 📚 **Ebooks → audiobooks**: upload an epub/pdf/txt/html (even from your phone), get a serialized audiobook plus an AI-generated "hosts discuss this book" intro episode; generation runs ~10x faster than playback, so you can start listening within minutes
- 📡 **Standard podcast RSS**: Apple Podcasts, Pocket Casts, Overcast — anything with "follow by URL" just works
- 🏃 **Runner-friendly PWA player**: lock-screen controls, ±15s skip, speed, sleep timer, offline caching, resume everywhere
- 🧱 **Zero backend**: batch pipeline + object storage + static page, all within free tiers (Cloudflare R2 10GB with free egress, GitHub Actions, Cloudflare Pages)

Architecture and product thinking: [DESIGN.md](./DESIGN.md) · market research: [PRODUCT.md](./PRODUCT.md) · License: **AGPL-3.0**

> ⚠️ The default TTS is the free Edge TTS channel — **personal use only**. For anything commercial, implement the `TtsProvider` interface (MiniMax, ElevenLabs, Azure…). Book files are copyrighted content: `books/` is gitignored, never commit it.

## Quick start (5 minutes)

You need Node 20+, a free Cloudflare account, and optionally an LLM key (any OpenAI-compatible endpoint; without one, episodes fall back to plain readout).

```bash
git clone https://github.com/paceboy/listenwhilerunning.git && cd listenwhilerunning
npm install
cp .env.example .env      # fill just TWO values: R2_ACCOUNT_ID + R2_API_TOKEN (comments show where)
npm run setup             # one command: bucket + public domain + admin token + player deploy
npm run pipeline          # generate your first batch (edit config.json sources first)
```

`setup` prints three things: your **player URL** (bookmark on your phone), a **one-tap login link** (unlocks the settings page: add feeds, queue articles, upload ebooks), and your **podcast feed URL** ("follow by URL" in any podcast app). The script is idempotent — rerun it anytime.

### Daily automation (pick one)

- **GitHub Actions (recommended, no server)**: fork, add your `.env` values as repository secrets, set repo variable `ENABLE_PIPELINE=true`. Runs daily at 22:30 UTC — see [.github/workflows/pipeline.yml](./.github/workflows/pipeline.yml)
- **Your own machine**: cron / systemd timer running `npm run pipeline`; add a 3-minute `npm run poll` timer and player uploads / queued articles go live in minutes instead of next-day

### Audiobooks

Upload an **epub/pdf/txt/html directly from the player's settings page** (listening starts minutes later, while the rest generates), or on the server:

```bash
cp somebook.epub books/   # epub/pdf/html converts automatically; mobi → epub via Calibre first
npm run books:sync        # generates the whole book (interruptible, resumes); delete the file + rerun to free space
npm run books:translate -- SomeEnglishBook   # listen to an English book as a Chinese audiobook
```

### Newsletters → podcast (optional)

Give your pipeline an email address: Cloudflare Email Routing → the included [email-worker](./email-worker) parses incoming newsletters into a private R2 inbox, and the pipeline turns them into episodes (group "邮件"/Mail) within minutes. Setup: deploy the worker (`cd email-worker && npx wrangler deploy`), then in the Cloudflare dash enable Email Routing on your domain and route an address (e.g. `read@yourdomain`) to the `lwr-mail` worker. Subscribe your newsletters with that address.

### Single article, right now

Paste a URL in the player settings, or:

```bash
npm run add -- https://example.com/some-article
```

## Architecture

```
scheduled pipeline (GitHub Actions / systemd, daily)
  fetch RSS → LLM dialogue script → neural TTS → upload
  ↓ writes static files only
object storage (Cloudflare R2 / Supabase Storage)
  feed.xml + books.json + mp3 + config.json (editable from the settings page)
  ↓ read-only
podcast apps (subscribe to feed) / web player (Cloudflare Pages, PWA)
```

No servers, no database at runtime. Source layout:

```
src/index.ts      pipeline entry (round-robin topic pick, queue.json consumption)
src/rewrite.ts    dialogue/narration/book-intro/summary prompts + LLM calls (compat endpoint → Gemini → plain fallback)
src/tts.ts        Edge TTS (throttle backoff, XML escaping) + two-host DialogueTts; TtsProvider is swappable
src/syncBooks.ts  full book sync (epub→txt, chunking, intro, summaries, cleanup, player-upload import)
src/setup.ts      one-command deploy;  src/poll.ts  3-min "upload → listening" poller
src/r2.ts         Cloudflare R2 store (CF REST);  src/storage.ts  Supabase implementation
docs/             player (static PWA);  functions/  settings API (Pages Functions);  site/  marketing site
```

## FAQ

- **My favorite site has no RSS?** Self-host [RSSHub](https://docs.rsshub.app/) — nearly everything gets a feed
- **Edge TTS returns empty audio?** Microsoft-side throttling; there's built-in 5-attempt quadratic backoff. Wrap long jobs in a retry loop (systemd unit) for extra safety
- **Dialogue quality not to your taste?** Edit the prompts in `src/rewrite.ts`; set `newsStyle: "narration"` in `config.json` for single-voice readout
- **Change voices?** `voice` / `dialogueVoices` in `config.json`; list voices with `edge-tts --list-voices`

---

## 中文

**跑步听什么**:把你自己订阅的信息源和电子书,每天自动变成能在跑步/通勤时连续收听的私人电台。

- 📰 资讯 → 双主播对谈播客:RSS/Reddit/任意文章链接 → LLM 改写 → TTS 合成,每早自动出现在播客 App
- 📚 电子书 → 有声书:epub/pdf/txt/html 手机上传即转,整本连载 + 一集对话导读;生成比播放快约 10 倍,几分钟后即可边生成边听;英文书可整本翻译成中文再听
- 📡 标准播客 RSS:Apple Podcasts 等任何 App"通过 URL 关注"直接订阅
- 🏃 跑步场景播放器(PWA):锁屏控制、±15s、倍速、睡眠定时、离线缓存、断点记忆
- 🧱 零后台:批处理管线 + 对象存储 + 静态页,全部免费额度(R2 10GB、出口流量免费)

### 5 分钟跑起来

```bash
git clone https://github.com/paceboy/listenwhilerunning.git && cd listenwhilerunning
npm install
cp .env.example .env      # 只需填 R2_ACCOUNT_ID + R2_API_TOKEN 两行(注释里有指路)
npm run setup             # 一键:建存储+公开域名+管理口令+部署播放器,打印三个地址
npm run pipeline          # 生成第一批资讯(config.json 改成你自己的源)
```

`setup` 会打印:**播放器地址**(手机收藏)、**免填口令登录链接**(点一次即登录,解锁设置页:加订阅源/转单篇/传电子书)、**播客订阅地址**。脚本幂等,重复跑不会弄坏已有部署。

### 每日自动(二选一)

- **GitHub Actions(推荐,无需服务器)**:fork 后配 `.env` 同名 secrets + 仓库变量 `ENABLE_PIPELINE=true`,每天 UTC 22:30(北京 06:30)自动跑
- **自己的机器**:cron / systemd 定时 `npm run pipeline`;再配每 3 分钟的 `npm run poll`,上传书/投递文章分钟级生效

### Newsletter 转播客(可选)

给管线一个专属邮箱:部署 [email-worker](./email-worker)(`cd email-worker && npx wrangler deploy`),在 Cloudflare 后台开启域名的 Email Routing,把某个地址(如 `read@你的域名`)路由到 `lwr-mail` worker;用这个地址订阅 newsletter,来信几分钟内自动变成播客集(分组「邮件」)。

### 听书 / 单篇转换

播放器**设置页直接上传** epub/pdf/txt/html(扫描版 PDF 需先 OCR);或服务器上 `cp 书.epub books/ && npm run books:sync`(可中断续传,删文件重跑即释放空间);英文书 `npm run books:translate -- 书名` 整本翻成中文。单篇文章:设置页贴链接,或 `npm run add -- <url>`。

### 常见问题

- **知乎/公众号没有 RSS?** 自托管 [RSSHub](https://docs.rsshub.app/) 或 [wewe-rss](https://github.com/cooderl/wewe-rss)
- **Edge TTS 报 empty audio?** 微软端节流,内置 5 次二次方退避;长任务建议 systemd 单元包失败冷却重试
- **对话质量不满意?** 改 `src/rewrite.ts` 的 prompt;`config.json` 的 `newsStyle` 改 `narration` 即单人直读
- **换声音?** `config.json` 的 `voice` / `dialogueVoices`
