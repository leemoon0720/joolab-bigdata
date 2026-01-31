export default {
  async fetch(req, env, ctx) {
    try{
      const url = new URL(req.url);
      if(url.pathname.startsWith("/api/")){
        if(!env.DB) return json({ ok:false, error:"NO_DB_BINDING", message:"D1 바인딩(DB)이 없습니다. Cloudflare Pages > Settings > Bindings에서 D1 database binding 변수명을 DB로 추가하십시오." }, 500);
        return await handleApi(req, env, ctx, url);
      }
      // static (clean urls are handled by Pages/ASSETS)
      return env.ASSETS.fetch(req);
    }catch(e){
      const msg=String(e?.message||e);
      if(msg.includes("no such table")||msg.includes("no such column")){
        return json({ ok:false, error:"DB_NOT_INIT", message:"DB 초기화가 필요합니다. Cloudflare D1 콘솔에서 schema.sql을 실행하십시오." }, 500);
      }
      return json({ ok:false, error:"INTERNAL", message:msg }, 500);
    }
  }
};
function json(obj, status=200, headers={}){
  return new Response(JSON.stringify(obj), { status, headers:{ "Content-Type":"application/json; charset=utf-8", ...headers }});
}
function getCookie(req,name){
  const c=req.headers.get("Cookie")||"";
  const m=c.match(new RegExp("(^|;\\s*)"+name+"=([^;]*)"));
  return m?decodeURIComponent(m[2]):null;
}
function setCookie(name,value,opts={}){
  const parts=[`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path||"/"}`);
  parts.push("HttpOnly");
  parts.push(opts.sameSite?`SameSite=${opts.sameSite}`:"SameSite=Lax");
  if(opts.secure) parts.push("Secure");
  if(opts.maxAge!=null) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}
function delCookie(name){ return setCookie(name,"",{maxAge:0}); }
function nowISO(){ return new Date().toISOString(); }
function randId(n=32){
  const a=new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function sha256Hex(s){
  const buf=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
// KST YYYY-MM-DD using +9h and UTC parts
function kstDateStr(d=new Date()){
  const x=new Date(d.getTime()+9*3600*1000);
  const y=x.getUTCFullYear();
  const m=String(x.getUTCMonth()+1).padStart(2,"0");
  const dd=String(x.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function parseYMD(s){
  const m=String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  return {y:+m[1],mo:+m[2],d:+m[3]};
}
function addDays(ymd,days){
  const p=parseYMD(ymd); if(!p) return null;
  const dt=new Date(Date.UTC(p.y,p.mo-1,p.d));
  dt.setUTCDate(dt.getUTCDate()+days);
  const y=dt.getUTCFullYear();
  const m=String(dt.getUTCMonth()+1).padStart(2,"0");
  const d=String(dt.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function cmpYMD(a,b){ if(a===b) return 0; return a<b?-1:1; }

async function ensureAdminSeed(env){
  const adminUser=(env.ADMIN_USER||"admin").trim();
  const adminPass=(env.ADMIN_PASS||"admin");
  const q=await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(adminUser).first();
  if(q?.id) return;
  const salt=randId(16);
  const pass_hash=await sha256Hex(adminPass+":"+salt);
  await env.DB.prepare("INSERT INTO users(username,pass_hash,salt,name,payer_name,role,blocked,created_at) VALUES(?,?,?,?,?,'admin',0,?)")
    .bind(adminUser, pass_hash, salt, "관리자", "", nowISO()).run();
}
async function getSession(env, req){
  const sid=getCookie(req,"sid");
  if(!sid) return null;
  const row=await env.DB.prepare("SELECT s.id,s.user_id,s.expires_at,u.username,u.role,u.blocked FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?")
    .bind(sid).first();
  if(!row) return null;
  if(new Date(row.expires_at).getTime() < Date.now()){
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
    return null;
  }
  return row;
}
async function requireAuth(env, req){
  const s=await getSession(env, req);
  if(!s) throw new Error("AUTH_REQUIRED");
  return s;
}
async function requireAdmin(env, req){
  const s=await requireAuth(env, req);
  if(s.role!=="admin") throw new Error("ADMIN_ONLY");
  return s;
}
async function lastConfirmedPaidAt(env, user_id){
  const row=await env.DB.prepare("SELECT paid_at FROM payments WHERE user_id=? AND status='CONFIRMED' ORDER BY paid_at DESC LIMIT 1")
    .bind(user_id).first();
  return row?.paid_at||null;
}
async function accessStatus(env, user_id){
  const today=kstDateStr();
  const last_paid_at=await lastConfirmedPaidAt(env, user_id);
  if(!last_paid_at) return { status:"NO_PAYMENT", last_paid_at:null, active_until:null, grace_until:null, allowed:false };
  const active_until=addDays(last_paid_at,30);
  const grace_until=addDays(active_until,7);
  if(cmpYMD(today, active_until)<=0) return { status:"ACTIVE", last_paid_at, active_until, grace_until, allowed:true };
  if(cmpYMD(today, grace_until)<=0) return { status:"GRACE", last_paid_at, active_until, grace_until, allowed:true };
  return { status:"BLOCKED", last_paid_at, active_until, grace_until, allowed:false };
}
async function enforceAccess(env, sess){
  if(sess.blocked) return { status:"BLOCKED", allowed:false };
  return await accessStatus(env, sess.user_id);
}
async function readJson(req){
  const ct=req.headers.get("Content-Type")||"";
  if(ct.includes("application/json")) return await req.json();
  const txt=await req.text(); if(!txt) return {};
  try{ return JSON.parse(txt); }catch(_){ return {}; }
}

async function handleApi(req, env, ctx, url){
  await ensureAdminSeed(env);
  const p=url.pathname;

  if(p==="/api/auth/signup" && req.method==="POST"){
    const body=await readJson(req);
    const username=String(body.username||"").trim();
    const password=String(body.password||"");
    const name=String(body.name||"").trim();
    const payer_name=String(body.payer_name||"").trim();
    if(!username || username.length<2 || username.length>50 || /\s/.test(username)) return json({ok:false,error:"BAD_USERNAME",message:"아이디는 공백 없이 2~50자"},400);
    if(password.length<1) return json({ok:false,error:"BAD_PASSWORD",message:"비밀번호는 1자 이상"},400);
    const exists=await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
    if(exists) return json({ok:false,error:"DUP",message:"이미 존재하는 아이디"},400);
    const salt=randId(16);
    const pass_hash=await sha256Hex(password+":"+salt);
    await env.DB.prepare("INSERT INTO users(username,pass_hash,salt,name,payer_name,role,blocked,created_at) VALUES(?,?,?,?,?,'customer',0,?)")
      .bind(username, pass_hash, salt, name||null, payer_name||null, nowISO()).run();
    return json({ok:true});
  }

  if(p==="/api/auth/login" && req.method==="POST"){
    const body=await readJson(req);
    const username=String(body.username||"").trim();
    const password=String(body.password||"");
    const u=await env.DB.prepare("SELECT id,pass_hash,salt,role,blocked FROM users WHERE username=?").bind(username).first();
    if(!u) return json({ok:false,error:"NOUSER",message:"아이디/비밀번호 확인"},401);
    const h=await sha256Hex(password+":"+u.salt);
    if(h!==u.pass_hash) return json({ok:false,error:"BADPASS",message:"아이디/비밀번호 확인"},401);
    if(u.blocked) return json({ok:false,error:"BLOCKED",message:"차단된 계정"},403);
    const sid=randId(24);
    const exp=new Date(Date.now()+7*24*3600*1000).toISOString();
    await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sid,u.id,exp,nowISO()).run();
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Set-Cookie": setCookie("sid", sid, { maxAge:7*24*3600, secure:false })
    }});
  }

  if(p==="/api/auth/logout" && req.method==="POST"){
    const sid=getCookie(req,"sid");
    if(sid) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Set-Cookie": delCookie("sid")
    }});
  }

  if(p==="/api/me"){
    const s=await requireAuth(env, req);
    const acc=await accessStatus(env, s.user_id);
    return json({ ok:true, user:{ id:s.user_id, username:s.username, role:s.role }, access:acc });
  }

  if(p==="/api/me/payments"){
    const s=await requireAuth(env, req);
    const rows=await env.DB.prepare("SELECT paid_at,amount,status,memo FROM payments WHERE user_id=? ORDER BY paid_at DESC, id DESC LIMIT 200")
      .bind(s.user_id).all();
    return json({ ok:true, items: rows.results||[] });
  }

  if(p==="/api/access/check"){
    const s=await requireAuth(env, req);
    const acc=await enforceAccess(env, s);
    if(!acc.allowed) return json({ ok:false, error:acc.status, message:acc.status }, 403);
    return json({ ok:true, access:acc });
  }

  if(p==="/api/deposit/request" && req.method==="POST"){
    const s=await requireAuth(env, req);
    const last=await env.DB.prepare("SELECT created_at FROM deposit_requests WHERE user_id=? ORDER BY id DESC LIMIT 1").bind(s.user_id).first();
    if(last){
      const t=new Date(last.created_at).getTime();
      if(Date.now()-t < 10*60*1000) return json({ok:false,error:"COOLDOWN",message:"요청은 10분에 1회만 가능합니다"},429);
    }
    const body=await readJson(req);
    const amount=(body.amount==null||body.amount==="")?null:Number(body.amount);
    await env.DB.prepare("INSERT INTO deposit_requests(user_id,amount,status,created_at) VALUES(?,?,'PENDING',?)")
      .bind(s.user_id, Number.isFinite(amount)?Math.max(0,Math.floor(amount)):null, nowISO()).run();

    const token=env.TELEGRAM_BOT_TOKEN, chat=env.ADMIN_CHAT_ID;
    if(token && chat){
      const msg=`[입금확인요청]\nuser: ${s.username} (id=${s.user_id})\namount: ${Number.isFinite(amount)?amount:"-"}\ntime: ${new Date().toLocaleString("ko-KR")}`;
      ctx.waitUntil(fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chat,text:msg})
      }).catch(()=>{}));
    }
    return json({ok:true});
  }

  if(p==="/api/posts/list"){
    const s=await requireAuth(env, req);
    const acc=await enforceAccess(env, s);
    if(!acc.allowed) return json({ ok:false, error:acc.status, message:acc.status }, 403);
    const rows=await env.DB.prepare("SELECT id,category,region,title,created_at FROM posts ORDER BY created_at DESC LIMIT 200").all();
    return json({ ok:true, items: rows.results||[] });
  }
  if(p==="/api/posts/get"){
    const s=await requireAuth(env, req);
    const acc=await enforceAccess(env, s);
    if(!acc.allowed) return json({ ok:false, error:acc.status, message:acc.status }, 403);
    const id=url.searchParams.get("id");
    const row=await env.DB.prepare("SELECT id,category,region,title,html,created_at FROM posts WHERE id=?").bind(id).first();
    if(!row) return json({ok:false,error:"NOT_FOUND",message:"NOT_FOUND"},404);
    return json({ ok:true, item:row });
  }
  if(p==="/api/posts/create" && req.method==="POST"){
    const s=await requireAdmin(env, req);
    const body=await readJson(req);
    const title=String(body.title||"").trim();
    const category=String(body.category||"").trim();
    const region=String(body.region||"").trim();
    const html=String(body.html||"");
    if(!title||!category||!region||!html) return json({ok:false,error:"BAD",message:"필수값 누락"},400);
    const id=randId(12);
    await env.DB.prepare("INSERT INTO posts(id,category,region,title,html,author_id,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(id, category, region, title, html, s.user_id, nowISO()).run();
    return json({ ok:true, id });
  }

  if(p==="/api/admin/users"){
    await requireAdmin(env, req);
    const rows=await env.DB.prepare("SELECT id,username,name,payer_name,role,blocked FROM users ORDER BY id DESC LIMIT 500").all();
    const items=[];
    for(const u of (rows.results||[])){
      const last_paid_at=await lastConfirmedPaidAt(env, u.id);
      const acc=await accessStatus(env, u.id);
      items.push({ ...u, last_paid_at, access_status: u.blocked ? "BLOCKED" : acc.status });
    }
    return json({ ok:true, items });
  }
  if(p==="/api/admin/users/block" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    await env.DB.prepare("UPDATE users SET blocked=? WHERE id=?").bind(body.blocked?1:0, Number(body.user_id)).run();
    return json({ ok:true });
  }
  if(p==="/api/admin/users/reset_password" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const new_password=String(body.new_password||"");
    if(new_password.length<3) return json({ok:false,error:"BAD_PASSWORD",message:"비밀번호가 너무 짧습니다"},400);
    const salt=randId(16);
    const pass_hash=await sha256Hex(new_password+":"+salt);
    await env.DB.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(pass_hash, salt, Number(body.user_id)).run();
    return json({ ok:true });
  }
  if(p==="/api/admin/unpaid"){
    await requireAdmin(env, req);
    const users=await env.DB.prepare("SELECT id,username,name,blocked FROM users WHERE role!='admin' ORDER BY id DESC LIMIT 1000").all();
    const grace=[], blocked=[];
    for(const u of (users.results||[])){
      const acc=await accessStatus(env, u.id);
      const last_paid_at=acc.last_paid_at;
      if(u.blocked || acc.status==="BLOCKED" || acc.status==="NO_PAYMENT") blocked.push({ username:u.username, name:u.name||"", access_status:u.blocked?"BLOCKED":acc.status, last_paid_at, active_until:acc.active_until, grace_until:acc.grace_until });
      if(acc.status==="GRACE") grace.push({ username:u.username, name:u.name||"", access_status:acc.status, last_paid_at, active_until:acc.active_until, grace_until:acc.grace_until });
    }
    return json({ ok:true, grace, blocked });
  }
  if(p==="/api/admin/payments/list"){
    await requireAdmin(env, req);
    const rows=await env.DB.prepare("SELECT p.id,u.username,p.paid_at,p.amount,p.status,p.memo FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.paid_at DESC,p.id DESC LIMIT 500").all();
    return json({ ok:true, items: rows.results||[] });
  }
  if(p==="/api/admin/payments/create" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const username=String(body.username||"").trim();
    const amount=Math.max(0, Math.floor(Number(body.amount||0)));
    const paid_at=String(body.paid_at||"").trim();
    const status=String(body.status||"CONFIRMED").trim();
    const memo=String(body.memo||"").trim();
    if(!username) return json({ok:false,error:"BAD",message:"username 필요"},400);
    if(!parseYMD(paid_at)) return json({ok:false,error:"BAD_DATE",message:"결제일 YYYY-MM-DD"},400);
    if(!["CONFIRMED","PENDING","CANCELED"].includes(status)) return json({ok:false,error:"BAD_STATUS",message:"status"},400);
    const u=await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
    if(!u) return json({ok:false,error:"NOUSER",message:"사용자 없음"},404);
    await env.DB.prepare("INSERT INTO payments(user_id,amount,paid_at,status,memo,created_at) VALUES(?,?,?,?,?,?)")
      .bind(u.id, amount, paid_at, status, memo||null, nowISO()).run();
    return json({ ok:true });
  }
  if(p==="/api/admin/payments/delete" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    await env.DB.prepare("DELETE FROM payments WHERE id=?").bind(Number(body.id)).run();
    return json({ ok:true });
  }
  if(p==="/api/admin/requests/list"){
    await requireAdmin(env, req);
    const rows=await env.DB.prepare("SELECT r.id,u.username,r.amount,r.created_at,r.status FROM deposit_requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 300").all();
    return json({ ok:true, items: rows.results||[] });
  }
  if(p==="/api/admin/requests/approve" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const id=Number(body.id);
    const rr=await env.DB.prepare("SELECT id,user_id,amount FROM deposit_requests WHERE id=?").bind(id).first();
    if(!rr) return json({ok:false,error:"NOT_FOUND",message:"NOT_FOUND"},404);
    const paid_at=body.paid_at ? String(body.paid_at).trim() : kstDateStr();
    if(!parseYMD(paid_at)) return json({ok:false,error:"BAD_DATE",message:"YYYY-MM-DD"},400);
    const amount = (body.amount==null) ? (rr.amount||0) : Math.max(0, Math.floor(Number(body.amount)));
    await env.DB.prepare("UPDATE deposit_requests SET status='APPROVED' WHERE id=?").bind(id).run();
    await env.DB.prepare("INSERT INTO payments(user_id,amount,paid_at,status,memo,created_at) VALUES(?,?,?,?,?,?)")
      .bind(rr.user_id, amount, paid_at, "CONFIRMED", "요청 승인", nowISO()).run();
    return json({ ok:true });
  }
  if(p==="/api/admin/requests/reject" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    await env.DB.prepare("UPDATE deposit_requests SET status='REJECTED' WHERE id=?").bind(Number(body.id)).run();
    return json({ ok:true });
  }
  if(p==="/api/admin/posts/delete" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    await env.DB.prepare("DELETE FROM posts WHERE id=?").bind(String(body.id||"").trim()).run();
    return json({ ok:true });
  }

  return json({ok:false,error:"NOT_FOUND",message:"NOT_FOUND"},404);
}
