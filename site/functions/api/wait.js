// 托管版 waitlist:POST {email} → 私有 bucket(WL 绑定,无公开域名)每邮箱一个对象。
// 每邮箱独立对象:天然去重、无读改写竞态;绝不能写进公开 bucket(r2.dev 任何人可下载 = PII 泄露)。
export async function onRequestPost({ request, env }) {
  let email;
  try {
    email = ((await request.json()).email || "").trim().toLowerCase();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    return new Response("bad email", { status: 400 });
  }
  await env.WL.put(`waitlist/${email}`, JSON.stringify({ at: new Date().toISOString() }), {
    httpMetadata: { contentType: "application/json" },
  });
  // binding list() 单页上限 1000,必须翻页,否则计数在 1000 封顶
  let n = 0, cursor;
  do {
    const listed = await env.WL.list({ prefix: "waitlist/", cursor });
    n += listed.objects.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return new Response(JSON.stringify({ n }), {
    headers: { "content-type": "application/json" },
  });
}
