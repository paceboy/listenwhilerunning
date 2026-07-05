// /api/* 统一鉴权:x-admin-token 必须等于 Pages 环境变量 ADMIN_TOKEN。
// 集中在 middleware 里,新增 endpoint 不可能忘加鉴权;未配置 ADMIN_TOKEN 时全部锁死。
export async function onRequest({ request, env, next }) {
  if (request.headers.get("x-admin-token") !== env.ADMIN_TOKEN || !env.ADMIN_TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }
  return next();
}
