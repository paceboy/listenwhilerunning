# listenwhilerunning 开发须知

个人 AI 播客管线:RSS/电子书 → LLM 对话稿 → Edge TTS → 播客 RSS + 静态播放器。零后台:批处理 + Cloudflare R2 + Pages。

## 常用命令

```bash
npx tsc --noEmit                 # 类型检查(无测试框架,提交前必跑)
npm run pipeline                 # 每日资讯批次(抓源→改写→TTS→发 feed)
npm run books:sync               # 书籍全量同步(断点续传,可中断重跑)
npm run books:remove -- <书名>   # 显式删书(唯一的删除路径,见下)
npm run poll                     # 消费上传书/队列 URL(systemd 每 3 分钟跑)
npm run setup                    # 一键部署(幂等;生成 wrangler.toml 和 docs/config.js)
npx wrangler pages deploy docs --project-name <项目> --commit-dirty=true   # 部署播放器
```

## 硬约束(违反会出事故)

- **绝不自动删除书籍音频**。`syncBooksAll` 对"本地没有 txt 的书"只提示不删——GHA 等无状态环境 books/ 恒为空,按目录清除会把所有已生成音频一锅端。删书只走 `books:remove`。
- **上传的书源文件(bucket bookuploads/)在整本音频生成完之前不能删**,否则中途失败即永久丢书。
- **公开 bucket(有 r2.dev 域名的)绝不放隐私数据**——waitlist 邮箱在私有 bucket `lwr-priv`,任何新的用户数据同理。
- `books/`、`books-src/`、`.env`、`docs/config.js` 是 gitignored,**永不提交**(版权内容/密钥/部署本地事实)。
- **运营者专属标识(analytics ID、私人域名、bucket 名)绝不硬编码进仓库**——一律 gitignored 文件注入(如 site/ga.txt),缺省行为必须是零配置零跟踪;提交前 `git grep` 自查。
- 全角字符(:、,等)不要以字面量写进正则字符类,用 `：` 转义——曾因编辑器悄悄把全角冒号转半角,导致所有书籍导读静默生成失败。
- 进程互斥用 `src/lock.ts`(feed / books 两把锁);新的写 state.json/feed.xml 的入口要拿 feed 锁,写 books.json 的拿 books 锁。

## 架构要点

- 存储抽象 `src/storage.ts` 的 `ObjectStore` 接口,R2(src/r2.ts,CF REST + Bearer,免 SigV4)与 Supabase 双实现;`makeStore()` 按 env 三件套自动选。
- 运行配置以 bucket 里的 `config.json` 为准(设置页写入),本地 config.json 是种子;`bucket`/`booksDir` 永远以本地为准(resolveRemoteConfig)。
- 播放器 `docs/index.html` 单文件 PWA,存储地址由 gitignored `docs/config.js` 注入(`window.LWR_CONFIG.base`),不要写死。
- Pages Functions 鉴权统一在 `functions/api/_middleware.js`(x-admin-token === env.ADMIN_TOKEN),新 endpoint 自动被保护。
- Edge TTS 免费通道**仅限个人自用**,商用换 `TtsProvider` 实现;有 5 次二次方退避 + 3s 集间歇抗节流。
- 书籍生成核心是 `syncBooks.ts` 的 `generateBookAudio()`,syncBooksAll 与 demogen(演示站)共用,不要再复制这段循环。

## 验证方式

- 播放器改动:跑 jsdom 回归(会话 scratchpad 的 regress.mjs 模式:beforeParse 注入 `window.LWR_CONFIG` 和 fetch 桩)。
- 管线改动:`npm run books:sync` 在全量已生成状态下应快速无操作走完;`npm run poll` 空转应打印 "nothing new"。
- functions 改动:部署后 curl 三态(无口令 401 / 非法输入 4xx / 正常 200)。

## 部署事实(本机)

systemd user units:`lwr-pipeline.timer`(每日 22:30 UTC)、`lwr-poll.timer`(每 3 分钟);长任务用 `systemd-run --user --unit=<名> -p WorkingDirectory=$(pwd) bash -c 'until npm run ...; do sleep 300; done'`。生产三站点(播放器/官网/演示)的真实地址在本机 memory 与 .env,不写进仓库——私人播放器含版权内容,域名绝不入库。官网 SEO 生成器 site/gen_pages.py;演示站生成器 src/demogen.ts。
