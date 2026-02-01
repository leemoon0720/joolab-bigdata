import { json, err, ensureAdmin, requireUser, computeAccess } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    const s = await requireUser(env, request);
    const access = await computeAccess(env, s.user.id, s.user.role, s.user.blocked);
    return json({ ok:true, user: s.user, access }, 200);
  }catch(e){
    const msg = e.message || "AUTH_REQUIRED";
    const code = msg === "AUTH_REQUIRED" ? 401 : 500;
    return err(msg, code, msg === "AUTH_REQUIRED" ? "UNAUTHORIZED" : "SERVER_ERROR");
  }
}
