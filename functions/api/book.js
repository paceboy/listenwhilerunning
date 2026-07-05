// 电子书上传:PUT ?name=<文件名> 把 .epub/.txt/.html/.pdf 存进 bucket 的 bookuploads/,
// 服务器下次批次(每日管线或 npm run books:sync)自动导入 books/ 并生成音频。
// GET 返回待转换列表,播放器设置页用来显示"已上传待处理"。
const EXT_RE = /\.(epub|txt|html?|pdf)$/i;
const MAX_BYTES = 50 * 1024 * 1024;

export async function onRequest({ request, env }) {
  // 鉴权在 functions/api/_middleware.js 统一处理

  if (request.method === "GET") {
    const listed = await env.LWR.list({ prefix: "bookuploads/" });
    const pending = listed.objects.map((o) => o.key.slice("bookuploads/".length));
    return new Response(JSON.stringify({ pending }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (request.method !== "PUT") return new Response("method not allowed", { status: 405 });

  const name = new URL(request.url).searchParams.get("name") || "";
  if (!EXT_RE.test(name) || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    return new Response("bad filename (need .epub/.txt/.html/.pdf)", { status: 400 });
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return new Response("file too large (max 50MB)", { status: 413 });

  // Content-Length 是客户端自报的(chunked 时没有),按实际字节数校验后再落存储。
  // 整体缓冲安全:Cloudflare 边缘本身限制请求体 100MB,不会撑爆 Worker 内存。
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return new Response("empty body", { status: 400 });
  if (body.byteLength > MAX_BYTES) return new Response("file too large (max 50MB)", { status: 413 });

  await env.LWR.put(`bookuploads/${name}`, body, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  return new Response(JSON.stringify({ uploaded: name, bytes: body.byteLength }), {
    headers: { "content-type": "application/json" },
  });
}
