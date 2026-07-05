import type { State } from "./types.js";

const STATE_PATH = "state.json";

/** 对象存储抽象:Supabase Storage(默认)与 Cloudflare R2(r2.ts)双实现 */
export interface ObjectStore {
  ensureBucket(): Promise<void>;
  loadState(): Promise<State>;
  saveState(state: State): Promise<void>;
  loadJson<T>(path: string): Promise<T | null>;
  uploadJson(path: string, obj: unknown): Promise<void>;
  uploadAudio(path: string, audio: Buffer): Promise<void>;
  uploadFeed(xml: string): Promise<void>;
  uploadFile(path: string, body: Buffer, contentType: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  publicUrl(path: string): string;
  delete(path: string): Promise<void>;
  /** 列出某前缀下的对象 key(设置页上传的电子书就靠它发现) */
  list(prefix: string): Promise<string[]>;
  downloadFile(path: string): Promise<Buffer>;
}

/** Supabase Storage 的裸 REST 封装(避开 supabase-js 对 Node>=22 原生 WebSocket 的硬依赖) */
export class Storage implements ObjectStore {
  constructor(
    private baseUrl: string,
    private serviceRoleKey: string,
    private bucket: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.serviceRoleKey}`,
      apikey: this.serviceRoleKey,
      ...extra,
    };
  }

  async ensureBucket(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/storage/v1/bucket/${this.bucket}`, {
      headers: this.headers(),
    });
    if (res.ok) return;
    const create = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: this.bucket, name: this.bucket, public: true }),
    });
    if (!create.ok) throw new Error(`createBucket failed: ${create.status} ${await create.text()}`);
    console.log(`[storage] created public bucket "${this.bucket}"`);
  }

  async loadState(): Promise<State> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${STATE_PATH}`, {
      headers: this.headers(),
    });
    if (!res.ok) return { seen: [], episodes: [] };
    return (await res.json()) as State;
  }

  async saveState(state: State): Promise<void> {
    await this.upload(STATE_PATH, Buffer.from(JSON.stringify(state, null, 2)), "application/json");
  }

  async loadJson<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  async uploadJson(path: string, obj: unknown): Promise<void> {
    await this.upload(path, Buffer.from(JSON.stringify(obj, null, 2)), "application/json");
  }

  async uploadAudio(path: string, audio: Buffer): Promise<void> {
    await this.upload(path, audio, "audio/mpeg");
  }

  async uploadFeed(xml: string): Promise<void> {
    await this.upload("feed.xml", Buffer.from(xml), "application/rss+xml; charset=utf-8");
  }

  async exists(path: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      method: "HEAD",
      headers: this.headers(),
    });
    return res.ok;
  }

  async uploadFile(path: string, body: Buffer, contentType: string): Promise<void> {
    await this.upload(path, body, contentType);
  }

  publicUrl(path: string): string {
    return `${this.baseUrl}/storage/v1/object/public/${this.bucket}/${path}`;
  }

  async list(prefix: string): Promise<string[]> {
    const folder = prefix.replace(/\/$/, "");
    const res = await fetch(`${this.baseUrl}/storage/v1/object/list/${this.bucket}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: folder, limit: 1000 }),
    });
    if (!res.ok) return [];
    const items = (await res.json()) as { name: string; id: string | null }[];
    // id 为 null 的是"目录"占位,不是文件
    return items.filter((x) => x.id).map((x) => `${folder}/${x.name}`);
  }

  async downloadFile(path: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`download ${path} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`[storage] delete ${path} failed: ${res.status}`);
    }
  }

  private async upload(path: string, body: Buffer, contentType: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "true" }),
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`upload ${path} failed: ${res.status} ${await res.text()}`);
  }
}
