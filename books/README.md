# 书籍目录

把想听的书放进这个目录,支持两种格式:

- **`.epub`**:直接放入即可,`npm run books:sync` 会自动提取正文生成同名 `.txt`(目录/封面/脚注标记自动剔除)
- **`.txt`**(UTF-8):文件名即书名(如 `三体.txt`);GBK 先转码 `iconv -f GBK -t UTF-8 in.txt > out.txt`
- **mobi 不直接支持**:用 [Calibre](https://calibre-ebook.com/) 转成 epub 再放入

然后跑 `npm run books:sync`:

- 整本书一次性生成全部分集音频(约 2500 字/集 ≈ 8-10 分钟),断点续传,中断重跑即续
- 网页播放器"书籍"tab 逐集即时可见,记忆播放位置
- **删除一本书**:把它的 `.txt`(和 `.epub`)从本目录删掉再跑一次 sync,bucket 里的音频与清单自动清除,空间随之释放
- epub 转出的 `.txt` 是最终朗读文本,可以手工编辑(删致谢/附录等)后重跑 sync
- 书籍原文直接朗读,不经 LLM 改写
- 本目录中除本 README 外的文件不入 git(版权内容不进仓库)
