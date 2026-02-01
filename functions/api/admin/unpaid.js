import { json, err, ensureAdmin, requireAdmin, addDays, todayYmd } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);

    const res = await env.DB.prepare(
      `SELECT u.id, u.username, u.name, u.role, u.blocked,
              (SELECT paid_at FROM payments p WHERE p.user_id=u.id AND p.status='CONFIRMED' ORDER BY p.paid_at DESC LIMIT 1) AS last_paid_at
       FROM users u
       WHERE u.role!='admin'
       ORDER BY u.id DESC`
    ).all();

    const grace=[], blocked=[];
    const today=todayYmd();
    for(const u of (res.results||[])){
      if(u.blocked){
        blocked.push({ username:u.username, name:u.name||"", last_paid_at:u.last_paid_at||"", next_bill_at:"", grace_until:"", access_status:"BLOCKED" });
        continue;
      }
      if(!u.last_paid_at){
        blocked.push({ username:u.username, name:u.name||"", last_paid_at:"", next_bill_at:"", grace_until:"", access_status:"BLOCKED" });
        continue;
      }
      const active_until=addDays(u.last_paid_at,30);
      const grace_until=addDays(active_until,7);
      if(today <= active_until){
        // active: not included
        continue;
      }else if(today <= grace_until){
        grace.push({ username:u.username, name:u.name||"", last_paid_at:u.last_paid_at, next_bill_at:active_until, grace_until, access_status:"GRACE" });
      }else{
        blocked.push({ username:u.username, name:u.name||"", last_paid_at:u.last_paid_at, next_bill_at:active_until, grace_until, access_status:"BLOCKED" });
      }
    }
    return json({ ok:true, grace, blocked }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
