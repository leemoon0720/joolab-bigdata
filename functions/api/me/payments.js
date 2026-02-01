import { json, err, ensureAdmin, requireUser } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    const s = await requireUser(env, request);
    const res = await env.DB.prepare(
      "SELECT id, amount, paid_at, status, memo FROM payments WHERE user_id=? ORDER BY paid_at DESC, id DESC LIMIT 200"
    ).bind(s.user.id).all();
    return json({ ok:true, items: res.results || [] }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    return err(msg, 500, "SERVER_ERROR");
  }
}
