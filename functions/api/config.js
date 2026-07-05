// GET/PUT bucket 里的 config.json(订阅源等运行配置,管线每次运行优先读它)
export async function onRequest({ request, env }) {
  // 鉴权在 functions/api/_middleware.js 统一处理
  if (request.method === "GET") {
    const obj = await env.LWR.get("config.json");
    return new Response(obj ? await obj.text() : "null", {
      headers: { "content-type": "application/json" },
    });
  }
  if (request.method === "PUT") {
    const body = await request.text();
    try {
      const parsed = JSON.parse(body);
      if (!parsed || !Array.isArray(parsed.sources)) throw new Error("sources missing");
    } catch (e) {
      return new Response("bad config: " + e.message, { status: 400 });
    }
    await env.LWR.put("config.json", body, {
      httpMetadata: { contentType: "application/json" },
    });
    return new Response("ok");
  }
  return new Response("method not allowed", { status: 405 });
}
