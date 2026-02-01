import { json, err, readJson, ensureAdmin, nowIso, makeSalt, makePassHash } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    const body = await readJson(request);
    const username = String(body.username||"").trim();
    const password = String(body.password||"");
    const name = String(body.name||"").trim();
    const payer_name = String(body.payer_name||"").trim();

    if(!username || !password) return err("USERNAME_PASSWORD_REQUIRED", 400, "BAD_REQUEST");
    if(!/^[a-zA-Z0-9_\\-\\.]{3,32}$/.test(username)) return err("INVALID_USERNAME", 400, "BAD_REQUEST");

    const exists = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
    if(exists) return err("USERNAME_EXISTS", 409, "CONFLICT");

    const salt = await makeSalt();
    const pass_hash = await makePassHash(password, salt);
    const created_at = nowIso();

    await env.DB.prepare(
      "INSERT INTO users (username, pass_hash, salt, name, payer_name, role, blocked, created_at) VALUES (?,?,?,?,?,'customer',0,?)"
    ).bind(username, pass_hash, salt, name, payer_name, created_at).run();

    return json({ ok:true }, 200);
  }catch(e){
    return err(e.message||"SIGNUP_FAILED", 500, "SERVER_ERROR");
  }
}
