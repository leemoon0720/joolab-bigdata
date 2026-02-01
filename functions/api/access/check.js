import { json, err, ensureAdmin, requireUser, computeAccess } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    const s = await requireUser(env, request);
    const access = await computeAccess(env, s.user.id, s.user.role, s.user.blocked);
    if(!access.allowed){
      return err("ACCESS_BLOCKED", 403, "FORBIDDEN");
    }
    return json({ ok:true, access }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
