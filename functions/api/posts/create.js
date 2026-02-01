import { json, err, ensureAdmin, requireAdmin, readJson, nowIso } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    const s = await requireAdmin(env, request);
    const body = await readJson(request);
    const title = String(body.title||"").trim();
    const category = String(body.category||"").trim();
    const region = String(body.region||"").trim();
    const html = String(body.html||"");
    if(!title || !category || !region || !html) return err("MISSING_FIELDS", 400, "BAD_REQUEST");

    const id = crypto.randomUUID();
    const created_at = nowIso();
    await env.DB.prepare(
      "INSERT INTO posts (id, category, region, title, html, author_id, created_at) VALUES (?,?,?,?,?,?,?)"
    ).bind(id, category, region, title, html, s.user.id, created_at).run();

    return json({ ok:true, id }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
