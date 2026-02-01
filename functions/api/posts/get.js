import { json, err, ensureAdmin, requireUser, computeAccess } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    const s = await requireUser(env, request);
    const access = await computeAccess(env, s.user.id, s.user.role, s.user.blocked);
    if(!access.allowed) return err("ACCESS_BLOCKED", 403, "FORBIDDEN");

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if(!id) return err("ID_REQUIRED", 400, "BAD_REQUEST");

    const row = await env.DB.prepare(
      "SELECT id, category, region, title, html, created_at FROM posts WHERE id=? LIMIT 1"
    ).bind(id).first();
    if(!row) return err("NOT_FOUND", 404, "NOT_FOUND");
    return json({ ok:true, item: row }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    return err(msg, 500, "SERVER_ERROR");
  }
}
