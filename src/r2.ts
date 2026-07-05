import type { ObjectStore } from "./storage.js";
import type { State } from "./types.js";

const STATE_PATH = "state.json";

/**
 * Cloudflare R2 实现(走 CF REST API,Bearer token,免 SigV4 签名)。
 * .env 需要:
 *   R2_ACCOUNT_ID   Cloudflare 账号 ID
 *   R2_API_TOKEN    有 Workers R2 Storage: Edit 权限的 API token
 *   R2_PUBLIC_BASE  公开访问域名(开启 r2.dev 或自定义域后填,如 https://pub-xxxx.r2.dev)
 * 三个都配置时 storageFromEnv() 自动选 R2。免费额度 10GB 且出口流量免费,适合音频。
 */
export class R2Storage implements ObjectStore {
  private api: string;

  constructor(
    accountId: string,
    private token: string,
    private bucket: string,
    private publicBase: string,
  ) {
    this.api = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`;
    this.publicBase = publicBase.replace(/\/$/, "");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }

  private objUrl(path: string): string {
    return `${this.api}/${this.bucket}/objects/${encodeURIComponent(path).replace(/%2F/gi, "/")}`;
  }

  async ensureBucket(): Promise<void> {
    const res = await fetch(`${this.api}/${this.bucket}`, { headers: this.headers() });
    if (res.ok) return;
    const create = await fetch(this.api, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: this.bucket }),
    });
    if (!create.ok) throw new Error(`R2 createBucket failed: ${create.status} ${await create.text()}`);
    console.log(`[r2] created bucket "${this.bucket}"`);
  }

  /** 允许浏览器跨域 GET(播放器 fetch feed/books.json/音频) */
  async ensureCors(): Promise<void> {
    const res = await fetch(`${this.api}/${this.bucket}/cors`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        rules: [
          {
            allowed: { methods: ["GET", "HEAD"], origins: ["*"], headers: ["range", "content-type"] },
            exposeHeaders: ["content-length", "content-range", "accept-ranges"],
            maxAgeSeconds: 86400,
          },
        ],
      }),
    });
    if (!res.ok) console.warn(`[r2] set CORS failed: ${res.status} ${await res.text()}`);
  }

  /** 开启 r2.dev 公开域名,返回域名(已开则直接返回) */
  async enableManagedDomain(): Promise<string> {
    const res = await fetch(`${this.api}/${this.bucket}/domains/managed`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled: true }),
    });
    const data = (await res.json()) as { result?: { domain?: string }; errors?: unknown };
    if (!data.result?.domain) throw new Error(`R2 enable r2.dev failed: ${JSON.stringify(data.errors)}`);
    return data.result.domain;
  }

  async loadState(): Promise<State> {
    return (await this.loadJson<State>(STATE_PATH)) ?? { seen: [], episodes: [] };
  }

  async saveState(state: State): Promise<void> {
    await this.uploadJson(STATE_PATH, state);
  }

  async loadJson<T>(path: string): Promise<T | null> {
    const res = await fetch(this.objUrl(path), { headers: this.headers() });
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  async uploadJson(path: string, obj: unknown): Promise<void> {
    await this.uploadFile(path, Buffer.from(JSON.stringify(obj, null, 2)), "application/json");
  }

  async uploadAudio(path: string, audio: Buffer): Promise<void> {
    await this.uploadFile(path, audio, "audio/mpeg");
  }

  async uploadFeed(xml: string): Promise<void> {
    await this.uploadFile("feed.xml", Buffer.from(xml), "application/rss+xml; charset=utf-8");
  }

  async uploadFile(path: string, body: Buffer, contentType: string): Promise<void> {
    const res = await fetch(this.objUrl(path), {
      method: "PUT",
      headers: this.headers({ "Content-Type": contentType }),
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`R2 upload ${path} failed: ${res.status} ${await res.text()}`);
  }

  async exists(path: string): Promise<boolean> {
    const res = await fetch(this.objUrl(path), { method: "HEAD", headers: this.headers() });
    return res.ok;
  }

  publicUrl(path: string): string {
    return `${this.publicBase}/${path}`;
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "";
    for (;;) {
      const url = `${this.api}/${this.bucket}/objects?per_page=1000&prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) throw new Error(`R2 list failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as {
        result?: { key: string }[];
        result_info?: { cursor?: string; is_truncated?: boolean };
      };
      // 个别 API 版本忽略 prefix 参数,自己再过滤一遍兜底
      keys.push(...(data.result ?? []).map((o) => o.key).filter((k) => k.startsWith(prefix)));
      if (!data.result_info?.is_truncated || !data.result_info.cursor) break;
      cursor = data.result_info.cursor;
    }
    return keys;
  }

  async downloadFile(path: string): Promise<Buffer> {
    const res = await fetch(this.objUrl(path), { headers: this.headers() });
    if (!res.ok) throw new Error(`R2 download ${path} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(this.objUrl(path), { method: "DELETE", headers: this.headers() });
    if (!res.ok && res.status !== 404) {
      console.warn(`[r2] delete ${path} failed: ${res.status}`);
    }
  }
}

/** env 里配齐 R2 三件套就用 R2,否则用 Supabase */
export function storageFromEnv(bucket: string): ObjectStore | null {
  const { R2_ACCOUNT_ID, R2_API_TOKEN, R2_PUBLIC_BASE } = process.env;
  if (R2_ACCOUNT_ID && R2_API_TOKEN && R2_PUBLIC_BASE) {
    return new R2Storage(R2_ACCOUNT_ID, R2_API_TOKEN, bucket, R2_PUBLIC_BASE);
  }
  return null;
}
