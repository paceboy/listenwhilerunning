// 跨设备收听进度同步(书籍断点):GET 取云端进度,PUT 服务端逐 key 按 at 合并新者胜。
// 整体覆盖会让久未刷新的设备用旧快照回滚其他书的新进度,所以合并必须在服务端做。
// 存私有 bucket(WL 绑定)——进度=收听习惯,属隐私数据,绝不能进有公开域名的桶。
// 鉴权在 functions/api/_middleware.js 统一处理。
const MAX_BYTES = 64 * 1024;

export async function onRequestGet({ env }) {
  const obj = await env.WL.get("progress.json");
  return new Response(obj ? await obj.text() : "{}", {
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPut({ request, env }) {
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
    return new Response("bad size", { status: 400 });
  }
  let incoming;
  try {
    incoming = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return new Response("bad json", { status: 400 });
  }
  let merged = {};
  try {
    const cur = await env.WL.get("progress.json");
    if (cur) merged = JSON.parse(await cur.text()) || {};
  } catch {}
  for (const k of Object.keys(incoming)) {
    if (k.indexOf("bk-") !== 0) continue;
    const v = incoming[k];
    if (!v || typeof v !== "object") continue;
    const old = merged[k];
    if (!old || typeof old !== "object" || (v.at || 0) >= (old.at || 0)) merged[k] = v;
  }
  await env.WL.put("progress.json", JSON.stringify(merged), {
    httpMetadata: { contentType: "application/json" },
  });
  return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
}
