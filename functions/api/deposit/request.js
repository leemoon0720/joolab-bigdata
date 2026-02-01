import { json, err, ensureAdmin, requireUser, readJson, nowIso } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    const s = await requireUser(env, request);
    const body = await readJson(request);
    const amount = (body.amount===null || body.amount===undefined) ? null : Number(body.amount);
    const created_at = nowIso();
    await env.DB.prepare(
      "INSERT INTO deposit_requests (user_id, amount, status, created_at, admin_memo) VALUES (?,?, 'PENDING', ?, '')"
    ).bind(s.user.id, amount, created_at).run();
    return json({ ok:true }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    return err(msg, 500, "SERVER_ERROR");
  }
}
