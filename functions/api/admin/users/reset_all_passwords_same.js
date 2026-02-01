import { json, err, ensureAdmin, requireAdmin, makeSalt, makePassHash } from "../../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);

    const res = await env.DB.prepare("SELECT id, username, role FROM users WHERE role!='admin'").all();
    let updated=0;
    for(const u of (res.results||[])){
      const salt = await makeSalt();
      const pass_hash = await makePassHash(u.username, salt);
      await env.DB.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(pass_hash, salt, u.id).run();
      await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id).run();
      updated++;
    }
    return json({ ok:true, updated }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
