export interface SourceConfig {
  name: string;
  url: string;
  /** 播放器资讯页的分组名(如 独立开发/世界杯),缺省归入"其他" */
  group?: string;
  /** 可选:标题+正文匹配此正则才收(如世界杯期间过滤足球源) */
  filter?: string;
}

export interface AppConfig {
  feed: {
    title: string;
    description: string;
    author: string;
    language: string;
  };
  sources: SourceConfig[];
  /** 本地书籍连载:目录下每个 .txt 每次运行产出一集 */
  booksDir: string;
  bookCharsPerEpisode: number;
  maxItemsPerRun: number;
  feedEpisodeCount: number;
  voice: string;
  /** 英文书用的声音(书籍按 CJK 占比自动检测语言),缺省 en-US-ChristopherNeural */
  voiceEn?: string;
  /** 每日资讯 ≥3 条时自动生成「今日速览」简报集(默认开,false 关闭) */
  dailyBrief?: boolean;
  /** 晨间简报的日期时区(IANA 名,如 Asia/Shanghai);UTC 服务器夜里跑的是听众"明早"的简报 */
  timezone?: string;
  /** 资讯口播形式:"dialogue" 双主播对话 / "narration" 单人直读(默认)。书籍连载始终直读 */
  newsStyle?: "narration" | "dialogue";
  /** dialogue 模式的声音 [主持人, 嘉宾];缺省或不足两个则自动退回单人旁白 */
  dialogueVoices?: string[];
  bucket: string;
}

export interface Article {
  guid: string;
  title: string;
  link: string;
  sourceName: string;
  pubDate: string;
  /** plain text extracted from the RSS entry */
  text: string;
  /** 原文即口播稿的内容,跳过 LLM 改写 */
  skipRewrite?: boolean;
  group?: string;
}

export interface Episode {
  id: string;
  title: string;
  description: string;
  link: string;
  sourceName: string;
  pubDate: string;
  audioPath: string;
  audioBytes: number;
  /** 播放器分组(feed 里输出为 <category>) */
  group?: string;
}

export interface State {
  seen: string[];
  episodes: Episode[];
  /** 历史遗留:书籍曾按日连载进 feed,现书籍全量生成(syncBooks),此字段不再使用 */
  bookProgress?: Record<string, unknown>;
}
