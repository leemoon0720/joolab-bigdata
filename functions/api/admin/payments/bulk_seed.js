import { json, err, ensureAdmin, requireAdmin, readJson, nowIso } from "../../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);
    const body = await readJson(request);
    const items = Array.isArray(body.items) ? body.items : [];
    let inserted=0;
    const missing=[], skipped=[];
    for(const it of items){
      const username = String(it.username||"").trim();
      const paid_at = String(it.paid_at||"").trim();
      if(!username || !paid_at){ skipped.push({username,paid_at,reason:"MISSING"}); continue; }
      const u = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
      if(!u){ missing.push({username,paid_at}); continue; }
      const ex = await env.DB.prepare("SELECT id FROM payments WHERE user_id=? AND status='CONFIRMED' AND paid_at=? LIMIT 1")
        .bind(u.id, paid_at).first();
      if(ex){ skipped.push({username,paid_at,reason:"EXISTS"}); continue; }

      await env.DB.prepare(
        "INSERT INTO payments (user_id, amount, paid_at, status, memo, created_at) VALUES (?,?,?,'CONFIRMED','bulk',?)"
      ).bind(u.id, 0, paid_at, nowIso()).run();
      inserted++;
    }
    return json({ ok:true, inserted, missing, skipped }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
