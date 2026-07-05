// POST {url}:把单篇文章 URL 追加进 bucket 的 queue.json,下次管线运行生成一集
// (服务器侧想立即生成可跑 npm run add)
export async function onRequest({ request, env }) {
  // 鉴权在 functions/api/_middleware.js 统一处理
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  let url;
  try {
    url = (await request.json()).url;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!/^https?:\/\/.{4,}/.test(url || "")) return new Response("bad url", { status: 400 });

  const obj = await env.LWR.get("queue.json");
  const queue = obj ? await obj.json() : { urls: [] };
  if (!queue.urls.includes(url)) queue.urls.push(url);
  await env.LWR.put("queue.json", JSON.stringify(queue, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return new Response(JSON.stringify({ queued: queue.urls.length }), {
    headers: { "content-type": "application/json" },
  });
}
