import { json, err, ensureAdmin, requireAdmin, readJson } from "../../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);
    const body = await readJson(request);
    const user_id = Number(body.user_id);
    const blocked = body.blocked ? 1 : 0;
    if(!user_id) return err("USER_ID_REQUIRED", 400, "BAD_REQUEST");
    await env.DB.prepare("UPDATE users SET blocked=? WHERE id=?").bind(blocked, user_id).run();
    return json({ ok:true }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
