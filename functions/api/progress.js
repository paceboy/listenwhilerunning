// 跨设备收听进度同步(书籍断点):GET 取云端进度,PUT 覆盖写。
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
  try {
    JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response("bad json", { status: 400 });
  }
  await env.WL.put("progress.json", body, {
    httpMetadata: { contentType: "application/json" },
  });
  return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
}
