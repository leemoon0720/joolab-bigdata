import { json, err, ensureAdmin, requireAdmin, readJson, nowIso, todayYmd } from "../../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    await ensureAdmin(env);
    await requireAdmin(env, request);
    const body = await readJson(request);
    const id = Number(body.id);
    if(!id) return err("ID_REQUIRED", 400, "BAD_REQUEST");

    const req = await env.DB.prepare("SELECT id, user_id, amount, status FROM deposit_requests WHERE id=?").bind(id).first();
    if(!req) return err("NOT_FOUND", 404, "NOT_FOUND");

    const paid_at = (body.paid_at ? String(body.paid_at).trim() : "") || todayYmd();
    const amount = (body.amount===null || body.amount===undefined) ? (req.amount||0) : Number(body.amount||0);

    await env.DB.prepare("UPDATE deposit_requests SET status='APPROVED' WHERE id=?").bind(id).run();

    await env.DB.prepare(
      "INSERT INTO payments (user_id, amount, paid_at, status, memo, created_at) VALUES (?,?,?,'CONFIRMED','request_approved',?)"
    ).bind(req.user_id, amount, paid_at, nowIso()).run();

    return json({ ok:true }, 200);
  }catch(e){
    const msg=e.message||"ERROR";
    if(msg==="AUTH_REQUIRED") return err("AUTH_REQUIRED", 401, "UNAUTHORIZED");
    if(msg==="ADMIN_ONLY") return err("ADMIN_ONLY", 403, "FORBIDDEN");
    return err(msg, 500, "SERVER_ERROR");
  }
}
