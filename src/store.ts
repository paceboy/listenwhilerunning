import { Storage } from "./storage.js";
import { readFileSync } from "node:fs";
import type { AppConfig } from "./types.js";
import type { ObjectStore } from "./storage.js";
import { storageFromEnv } from "./r2.js";

/** 统一入口:.env 配了 R2 三件套走 R2,否则走 Supabase */
export function makeStore(bucket: string): ObjectStore {
  const r2 = storageFromEnv(bucket);
  if (r2) return r2;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("configure R2_ACCOUNT_ID/R2_API_TOKEN/R2_PUBLIC_BASE or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in .env");
  }
  return new Storage(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, bucket);
}

/** 读本地 config.json(种子配置;运行时以 bucket 里的 config.json 为准,见 resolveRemoteConfig) */
export function loadConfig(): AppConfig {
  return JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8")) as AppConfig;
}
