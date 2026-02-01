import { json, err, getCookie, cookieHeadersClear } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  try{
    const sid = getCookie(request, "sid");
    if(sid){
      await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
    }
    return json({ ok:true }, 200, cookieHeadersClear());
  }catch(e){
    return err(e.message||"LOGOUT_FAILED", 500, "SERVER_ERROR");
  }
}
