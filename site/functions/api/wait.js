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
  const listed = await env.WL.list({ prefix: "waitlist/" });
  return new Response(JSON.stringify({ n: listed.objects.length }), {
    headers: { "content-type": "application/json" },
  });
}
