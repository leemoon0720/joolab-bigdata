import { json, err, ensureAdmin, requireUser, computeAccess } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    const s = await requireUser(env, request);
    const access = await computeAccess(env, s.user.id, s.user.role, s.user.blocked);
    if(!access.allowed) return err("ACCESS_BLOCKED", 403, "FORBIDDEN");

    const res = await env.DB.prepare(
      "SELECT id, category, region, title, created_at FROM posts ORDER BY created_at DESC LIMIT 300"
    ).all();
    return json({ ok:true, items: res.results || [] }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    return err(msg, 500, "SERVER_ERROR");
  }
}
