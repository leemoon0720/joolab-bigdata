import { json, err, ensureAdmin, requireAdmin, addDays, todayYmd, computeAccess } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);

    const res = await env.DB.prepare(
      `SELECT u.id, u.username, u.name, u.payer_name, u.role, u.blocked,
              (SELECT paid_at FROM payments p WHERE p.user_id=u.id AND p.status='CONFIRMED' ORDER BY p.paid_at DESC LIMIT 1) AS last_paid_at
       FROM users u
       ORDER BY u.id DESC`
    ).all();
    const items = (res.results||[]).map(u=>{
      const access = (u.role==="admin")
        ? { access_status:"ADMIN", last_paid_at:null, active_until:null, grace_until:null }
        : (u.blocked ? { access_status:"BLOCKED", last_paid_at:u.last_paid_at||null, active_until:null, grace_until:null } : null);
      if(!access || access.access_status===null){
        // compute based on last_paid_at
        if(!u.last_paid_at){
          return { ...u, access_status:"BLOCKED", next_bill_at:null, grace_until:null };
        }
        const active_until = addDays(u.last_paid_at, 30);
        const grace_until = addDays(active_until, 7);
        const today = todayYmd();
        let st = "BLOCKED";
        if(today <= active_until) st = "ACTIVE";
        else if(today <= grace_until) st = "GRACE";
        return {
          id:u.id, username:u.username, name:u.name, payer_name:u.payer_name, role:u.role, blocked:!!u.blocked,
          last_paid_at: u.last_paid_at,
          next_bill_at: active_until,
          grace_until,
          access_status: st
        };
      }
      return {
        id:u.id, username:u.username, name:u.name, payer_name:u.payer_name, role:u.role, blocked:!!u.blocked,
        last_paid_at: u.last_paid_at||null,
        next_bill_at: null,
        grace_until: null,
        access_status: u.role==="admin" ? "ADMIN" : "BLOCKED"
      };
    });

    return json({ ok:true, items }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
