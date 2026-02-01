import { json, err, ensureAdmin, requireAdmin } from "../../../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);
    const res = await env.DB.prepare(
      `SELECT r.id, u.username, r.amount, r.created_at, r.status
       FROM deposit_requests r JOIN users u ON u.id=r.user_id
       ORDER BY CASE WHEN r.status='PENDING' THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT 300`
    ).all();
    return json({ ok:true, items: res.results || [] }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
