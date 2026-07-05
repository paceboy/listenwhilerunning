import type { Article } from "./types.js";

const MODELS = ["gemini-3-flash-preview", "gemini-2.5-flash"];

export type NewsStyle = "narration" | "dialogue";

export interface RewriteConfig {
  /** Google 官方 Gemini API key */
  geminiApiKey?: string;
  /** OpenAI 兼容第三方平台(如 laozhang.ai),设了 apiKey 就优先走这条 */
  compat?: { baseUrl: string; apiKey: string; model: string };
  /** 口播稿形式:单人直读 narration(默认)或双主播对话 dialogue */
  style?: NewsStyle;
}

const NARRATION_PROMPT = `你是一档单人电台节目的旁白撰稿人。把下面这篇文章改写成 2-3 分钟的中文口播稿(约 500-700 字),给跑步中的听众听。

要求:
- 单人自然旁白,像跟朋友讲这件事,不要"大家好欢迎收听"式的播音腔开场,直接进入内容
- 开头一句话点明这是什么事、为什么值得听
- 口语化:短句、有停顿感,数字和英文名词按中文口语习惯读出(如 "GPT-4" 写成 "GPT四")
- 只陈述文章里的事实,不编造;结尾一句话说明信息来自「{source}」
- 只输出口播稿正文纯文本,不要标题、不要 markdown、不要任何舞台提示

文章标题:{title}
文章内容:
{content}`;

const DIALOGUE_PROMPT = `你是一档双人对谈播客的撰稿人。把下面这篇文章改写成两位主播的中文对话脚本(约 600-900 字,3-4 分钟),给跑步中的听众听。

角色:A 是主持人,负责引入话题、提问、追问和承接;B 是懂行的嘉宾,负责把事实和背景讲清楚。
要求:
- 每句台词单独一行,以"A:"或"B:"开头;除台词外不要输出任何东西(不要标题、不要 markdown、不要舞台提示)
- 对话自然口语化,有来回、有追问,不要两人各说各的
- 直接进入话题,不要"欢迎收听"式开场;数字和英文名词按中文口语习惯读出(如 "GPT-4" 写成 "GPT四")
- 只陈述文章里的事实,不编造;结尾由 A 一句话说明信息来自「{source}」

文章标题:{title}
文章内容:
{content}`;

const SUMMARY_PROMPT = `用一句话概括下面这段书稿的内容(不超过 40 个字,像播客单集简介那样点出这段讲了什么),直接输出这句话,不要引号、不要"本段""这一部分"之类前缀。

书稿片段:
{content}`;

/** Gemini 直连单轮对话,失败返回 null(只配 Gemini 的用户走这条) */
async function geminiChat(prompt: string, config: RewriteConfig): Promise<string | null> {
  if (!config.geminiApiKey) return null;
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (out) return out;
    } catch {}
  }
  return null;
}

/** 兼容通道单轮对话,失败返回 null(锦上添花型能力共用) */
async function compatChat(prompt: string, config: RewriteConfig): Promise<string | null> {
  if (!config.compat) return null;
  const { baseUrl, apiKey, model } = config.compat;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

const SUMMARY_PROMPT_EN = `Summarize this book excerpt in one sentence (20 words max), like a podcast episode blurb pointing out what this part covers. Output only the sentence — no quotes, no prefix like "This section".

Excerpt:
{content}`;

/** 一句话概要,失败返回 null 由调用方降级 */
export async function summarizeText(
  text: string,
  config: RewriteConfig,
  lang: "zh" | "en" = "zh",
): Promise<string | null> {
  const tpl = lang === "en" ? SUMMARY_PROMPT_EN : SUMMARY_PROMPT;
  const s = await compatChat(tpl.replace("{content}", text.slice(0, 3000)), config);
  return s ? s.replace(/^["「『]+|["」』。]+$/g, "").slice(0, lang === "en" ? 160 : 60) : null;
}

const BOOK_INTRO_PROMPT = `你是一档双人读书播客的撰稿人。请为《{name}》写一期"导读"节目的对话脚本(约 1500-2200 字,8-12 分钟)。听众将在之后逐集收听这本书的原文朗读,这期导读帮他们决定要不要听、以及带着什么问题去听。

角色:A 是主持人,好奇但没读过这本书;B 是读完全书的领读人。
要求:
- 每句台词单独一行,以"A:"或"B:"开头;除台词外不要输出任何东西(不要标题、不要 markdown)
- 内容覆盖:这本书是谁写的、讲什么、最打动人的两三个点、适合什么人听、听的时候可以留意什么
- 只依据下面的书稿节选陈述,不要编造书里没有的情节细节;拿不准的地方说"书里会展开"
- 对话自然口语化,直接进入话题,不要"欢迎收听"式开场;数字和英文名词按中文口语习惯读出

书稿节选(开头/中段/结尾):
{content}`;

const TRANSLATE_PROMPT = `把下面这段书稿翻译成简体中文。这是有声书的朗读文本,要求:
- 自然流畅、适合朗读收听的书面口语
- 产品名/人名/公司名/网址保留英文原文(如 Product Hunt、Stripe、@levelsio)
- 忠实原意,不增删内容;只输出译文纯文本,不要任何注释、标题或说明

原文:
{content}`;

/** 书稿段落英译中(有声书用),3 次重试,全失败返回 null */
export async function translateChunkZh(text: string, config: RewriteConfig): Promise<string | null> {
  for (let att = 1; att <= 3; att++) {
    const out = await compatChat(TRANSLATE_PROMPT.replace("{content}", text), config);
    if (out) return out;
  }
  return null;
}

const BOOK_INTRO_PROMPT_EN = `You write scripts for a two-host book podcast. Write the dialogue script for an "introduction" episode about "{name}" (about 900-1400 words, 8-12 minutes). Listeners will then hear the book itself read aloud part by part; this intro helps them decide whether to listen and what to listen for.

Roles: A is the host, curious but has not read the book; B has read the whole book.
Rules:
- One line per utterance, each starting with "A:" or "B:"; output nothing except dialogue lines (no title, no markdown)
- Cover: who wrote it, what it is about, the two or three most striking points, who it is for, and what to pay attention to while listening
- Only state what is supported by the excerpts below; where unsure, say "the book goes deeper on this"
- Natural spoken style, get straight into the topic — no "welcome to the show" opening

Excerpts (beginning / middle / end):
{content}`;

/** 整本书的对话导读脚本,失败返回 null(导读是可选集,调用方跳过即可) */
export async function bookIntroScript(
  name: string,
  samples: string,
  config: RewriteConfig,
  lang: "zh" | "en" = "zh",
): Promise<string | null> {
  const tpl = lang === "en" ? BOOK_INTRO_PROMPT_EN : BOOK_INTRO_PROMPT;
  return compatChat(tpl.replace("{name}", name).replace("{content}", samples), config);
}

const BRIEF_PROMPT = `你是一档双人晨间播客的撰稿人。下面是今天的 {n} 条资讯(每条会在后续单集里详细展开),请写一期"今日速览"的对话脚本(约 500-800 字,3-5 分钟),让听众用几分钟知道今天都有什么、哪几条值得点开详细听。

角色:A 是主持人,B 是编辑。
要求:
- 每句台词单独一行,以"A:"或"B:"开头;除台词外不要输出任何东西(不要标题、不要 markdown)
- 每条资讯用一两句话带过核心信息,不展开细节;最后 B 推荐今天最值得完整听的 1-2 条并说为什么
- 只依据给出的内容陈述,不要编造;对话自然口语化,直接进入话题,不要"欢迎收听"式开场
- 数字和英文名词按中文口语习惯读出

今日资讯列表:
{content}`;

/** 今日速览:把当天全部资讯浓缩成一集对话简报(标题+摘要喂入,单条截断防超长) */
export async function briefScript(
  items: { title: string; text: string; sourceName: string }[],
  config: RewriteConfig,
): Promise<string | null> {
  const content = items
    .map((a, i) => `${i + 1}. 【${a.sourceName}】${a.title}\n${a.text.replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n\n");
  const prompt = BRIEF_PROMPT.replace("{n}", String(items.length)).replace("{content}", content.slice(0, 12000));
  return (await compatChat(prompt, config)) ?? geminiChat(prompt, config);
}

export async function rewriteToScript(article: Article, config: RewriteConfig): Promise<string> {
  const fallback = () => {
    const text = article.text.slice(0, 800);
    return `${article.title}。${text} 以上内容来自${article.sourceName}。`;
  };
  if (!config.geminiApiKey && !config.compat) {
    console.log(`[rewrite] no LLM key configured, fallback to raw text: ${article.title}`);
    return fallback();
  }

  const template = config.style === "dialogue" ? DIALOGUE_PROMPT : NARRATION_PROMPT;
  const prompt = template.replace("{source}", article.sourceName)
    .replace("{title}", article.title)
    .replace("{content}", article.text.slice(0, 6000));

  if (config.compat) {
    const { baseUrl, apiKey, model } = config.compat;
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
      });
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      const script = data.choices?.[0]?.message?.content?.trim();
      if (script) {
        console.log(`[rewrite] compat/${model} ok: ${article.title} (${script.length} chars)`);
        return script;
      }
      console.warn(`[rewrite] compat/${model} failed: ${data.error?.message ?? `HTTP ${res.status}`}`);
    } catch (e) {
      console.warn(`[rewrite] compat/${model} failed: ${(e as Error).message}`);
    }
    // 兼容通道失败继续尝试 Gemini 直连(如有 key),最后才降级
  }

  const apiKey = config.geminiApiKey;
  if (!apiKey) {
    console.warn(`[rewrite] all providers failed, fallback: ${article.title}`);
    return fallback();
  }

  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );
      if (!res.ok) {
        console.warn(`[rewrite] ${model} HTTP ${res.status}, trying next`);
        continue;
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const script = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      if (script) {
        console.log(`[rewrite] ${model} ok: ${article.title} (${script.length} chars)`);
        return script;
      }
    } catch (e) {
      console.warn(`[rewrite] ${model} failed: ${(e as Error).message}`);
    }
  }
  console.warn(`[rewrite] all models failed, fallback: ${article.title}`);
  return fallback();
}
