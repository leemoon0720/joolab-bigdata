import { json, err, ensureAdmin, requireAdmin, readJson, makeSalt, makePassHash } from "../../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);
    const body = await readJson(request);
    const user_id = Number(body.user_id);
    const new_password = String(body.new_password||"");
    if(!user_id || !new_password) return err("MISSING_FIELDS", 400, "BAD_REQUEST");
    const salt = await makeSalt();
    const pass_hash = await makePassHash(new_password, salt);
    await env.DB.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(pass_hash, salt, user_id).run();
    // invalidate sessions
    await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user_id).run();
    return json({ ok:true }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
