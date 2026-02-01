import { json, err, ensureAdmin, requireAdmin, readJson, nowIso, todayYmd } from "../../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);
    const body = await readJson(request);
    const username = String(body.username||"").trim();
    const amount = Number(body.amount||0);
    const paid_at = String(body.paid_at||"").trim() || todayYmd();
    const status = String(body.status||"CONFIRMED").trim() || "CONFIRMED";
    const memo = String(body.memo||"").trim();
    if(!username) return err("USERNAME_REQUIRED", 400, "BAD_REQUEST");

    const u = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
    if(!u) return err("USER_NOT_FOUND", 404, "NOT_FOUND");

    await env.DB.prepare(
      "INSERT INTO payments (user_id, amount, paid_at, status, memo, created_at) VALUES (?,?,?,?,?,?)"
    ).bind(u.id, amount, paid_at, status, memo, nowIso()).run();

    return json({ ok:true }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
