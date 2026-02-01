import { json, err, ensureAdmin, requireAdmin, readJson, nowIso, makeSalt, makePassHash } from "../../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);
    const body = await readJson(request);
    const users = Array.isArray(body.users) ? body.users : [];
    let created=0, skipped=0;

    for(const u of users){
      const username = String(u.username||"").trim();
      if(!username) { skipped++; continue; }
      const ex = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
      if(ex){ skipped++; continue; }
      const salt = await makeSalt();
      const pass_hash = await makePassHash(username, salt);
      const name = String(u.name||"").trim();
      const payer_name = String(u.payer_name||"").trim();
      await env.DB.prepare(
        "INSERT INTO users (username, pass_hash, salt, name, payer_name, role, blocked, created_at) VALUES (?,?,?,?,?,'customer',0,?)"
      ).bind(username, pass_hash, salt, name, payer_name, nowIso()).run();
      created++;
    }

    return json({ ok:true, created, skipped }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
