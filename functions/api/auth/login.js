import { json, err, readJson, ensureAdmin, nowIso, makeSalt, makePassHash, hashPasswordVariants, cookieHeadersSet } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    const body = await readJson(request);
    const username = String(body.username||"").trim();
    const password = String(body.password||"");
    if(!username || !password) return err("USERNAME_PASSWORD_REQUIRED", 400, "BAD_REQUEST");

    const u = await env.DB.prepare("SELECT id, username, pass_hash, salt, role, blocked FROM users WHERE username=? LIMIT 1")
      .bind(username).first();
    if(!u) return err("INVALID_CREDENTIALS", 401, "UNAUTHORIZED");
    if(u.blocked) return err("USER_BLOCKED", 403, "FORBIDDEN");

    const variants = await hashPasswordVariants(password, u.salt);
    if(!variants.has(u.pass_hash)){
      return err("INVALID_CREDENTIALS", 401, "UNAUTHORIZED");
    }

    const sid = crypto.randomUUID();
    const created_at = nowIso();
    const expires_at = new Date(Date.now() + 35*24*60*60*1000).toISOString().slice(0,19);
    await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)")
      .bind(sid, u.id, expires_at, created_at).run();

    return json({ ok:true, sid, user:{ id:u.id, username:u.username, role:u.role } }, 200, cookieHeadersSet(sid));
  }catch(e){
    return err(e.message||"LOGIN_FAILED", 500, "SERVER_ERROR");
  }
}
