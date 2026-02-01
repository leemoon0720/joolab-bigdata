import { json, err, ensureAdmin, requireAdmin } from "../../../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);
    const res = await env.DB.prepare(
      `SELECT p.id, u.username, p.paid_at, p.amount, p.status, p.memo
       FROM payments p JOIN users u ON u.id=p.user_id
       ORDER BY p.paid_at DESC, p.id DESC
       LIMIT 500`
    ).all();
    return json({ ok:true, items: res.results || [] }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
