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

function addMonthsYMD(ymd, months){
  const p=parseYMD(ymd); if(!p) return null;
  let y=p.y, mo=p.mo + months;
  while(mo>12){ y++; mo-=12; }
  while(mo<1){ y--; mo+=12; }
  const lastDay=new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const d=Math.min(p.d, lastDay);
  const m=String(mo).padStart(2,"0");
  const dd=String(d).padStart(2,"0");
  return `${y}-${m}-${dd}`;
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
  if(!last_paid_at) return { status:"NO_PAYMENT", last_paid_at:null, next_bill_at:null, active_until:null, grace_until:null, bill_day:null, allowed:false };
  const p=parseYMD(last_paid_at);
  const bill_day=p?p.d:null;
  const next_bill_at=addMonthsYMD(last_paid_at, 1);
  if(!next_bill_at) return { status:"NO_PAYMENT", last_paid_at:null, next_bill_at:null, active_until:null, grace_until:null, bill_day, allowed:false };
  const grace_until=addDays(next_bill_at, 7);
  const base={ bill_day, last_paid_at, next_bill_at, active_until:next_bill_at, grace_until };
  if(cmpYMD(today, next_bill_at)<0) return { status:"ACTIVE", allowed:true, ...base };
  if(cmpYMD(today, grace_until)<=0) return { status:"GRACE", allowed:true, ...base };
  return { status:"BLOCKED", allowed:false, ...base };
}
async function enforceAccess(env, sess){
  if(sess.role==="admin"){
    return { status:"ADMIN", allowed:true, last_paid_at:null, next_bill_at:null, active_until:null, grace_until:null, bill_day:null };
  }
  if(sess.blocked) return { status:"BLOCKED", allowed:false, bill_day:null };
  return await accessStatus(env, sess.user_id);
}
async function readJson(req){
  const ct=req.headers.get("Content-Type")||"";
  if(ct.includes("application/json")) return await req.json();
  const txt=await req.text(); if(!txt) return {};
  try{ return JSON.parse(txt); }catch(_){ return {}; }
}
const __TABLE_INFO_CACHE = {};
async function getTableInfo(env, table){
  if(__TABLE_INFO_CACHE[table]) return __TABLE_INFO_CACHE[table];
  const r = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  const info = (r.results||[]).map(x=>({ name:x.name, type:String(x.type||"").toUpperCase(), notnull:!!x.notnull, pk:!!x.pk }));
  __TABLE_INFO_CACHE[table] = info;
  return info;
}
function hasCol(info, name){ return (info||[]).some(c=>c.name===name); }
function isTextPkId(info){
  const c = (info||[]).find(x=>x.name==="id");
  return !!(c && c.pk && c.type.includes("TEXT"));
}
async function insertPayment(env, args){
  const info = await getTableInfo(env, "payments");
  const cols = [];
  const vals = [];
  if(hasCol(info,"id") && isTextPkId(info)){ cols.push("id"); vals.push(randId(12)); }
  if(hasCol(info,"user_id")){ cols.push("user_id"); vals.push(args.user_id); }
  if(hasCol(info,"amount")){ cols.push("amount"); vals.push(Number.isFinite(args.amount)?Math.max(0,Math.floor(args.amount)):0); }
  if(hasCol(info,"paid_at")){ cols.push("paid_at"); vals.push(args.paid_at); }
  if(hasCol(info,"status")){ cols.push("status"); vals.push(args.status||"CONFIRMED"); }
  if(hasCol(info,"memo")){ cols.push("memo"); vals.push(args.memo??null); }
  if(hasCol(info,"created_at")){ cols.push("created_at"); vals.push(nowISO()); }
  if(hasCol(info,"method")){ cols.push("method"); vals.push(args.method||"BANK"); }
  if(hasCol(info,"expires_at")){
    const ex = args.expires_at || addMonthsYMD(args.paid_at,1) || args.paid_at;
    cols.push("expires_at"); vals.push(ex);
  }
  const ph = cols.map(()=>"?").join(",");
  const sql = `INSERT INTO payments(${cols.join(",")}) VALUES(${ph})`;
  await env.DB.prepare(sql).bind(...vals).run();
}


async function handleApi(req, env, ctx, url){
  await ensureAdminSeed(env);
  const p=url.pathname;

  if(p==="/api/auth/signup" && req.method==="POST"){
    const body=await readJson(req);
    const username=String(body.username||body.id||body.user||body.userid||body.아이디||"").trim();
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
    const username=String(body.username||body.id||body.user||body.userid||body.아이디||"").trim();
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
    const acc = (s.role==="admin")
      ? { status:"ADMIN", allowed:true, last_paid_at:null, next_bill_at:null, active_until:null, grace_until:null, bill_day:null }
      : await accessStatus(env, s.user_id);
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
      items.push({ ...u, last_paid_at, next_bill_at: acc.next_bill_at||acc.active_until||null, grace_until: acc.grace_until||null, access_status: u.blocked ? "BLOCKED" : acc.status });
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
    if(new_password.length<1) return json({ok:false,error:"BAD_PASSWORD",message:"비밀번호는 1자 이상"},400);
    const salt=randId(16);
    const pass_hash=await sha256Hex(new_password+":"+salt);
    await env.DB.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(pass_hash, salt, Number(body.user_id)).run();
    return json({ ok:true });
  }
  
  if(p==="/api/admin/users/create" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const username=String(body.username||body.id||body.user||body.userid||body.아이디||"").trim();
    const password=String(body.password||body.pass||"");
    const name=String(body.name||"").trim();
    const payer_name=String(body.payer_name||body.payer||"").trim();
    const role=String(body.role||"customer").trim();
    const blocked=body.blocked?1:0;
    if(!username || username.length<2 || username.length>50 || /\s/.test(username)) return json({ok:false,error:"BAD_USERNAME",message:"아이디는 공백 없이 2~50자"},400);
    const exists=await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
    if(exists) return json({ok:false,error:"DUP",message:"이미 존재하는 아이디"},400);
    const salt=randId(16);
    const pass_hash=await sha256Hex((password||username)+":"+salt);
    await env.DB.prepare("INSERT INTO users(username,pass_hash,salt,name,payer_name,role,blocked,created_at) VALUES(?,?,?,?,?, ?,?,?)")
      .bind(username, pass_hash, salt, name||null, payer_name||null, role==="admin"?"admin":"customer", blocked, nowISO()).run();
    return json({ ok:true });
  }
  if(p==="/api/admin/users/update" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const user_id=Number(body.user_id);
    if(!Number.isFinite(user_id)) return json({ok:false,error:"BAD",message:"user_id 필요"},400);
    const cur=await env.DB.prepare("SELECT id,username,role FROM users WHERE id=?").bind(user_id).first();
    if(!cur) return json({ok:false,error:"NOT_FOUND",message:"사용자 없음"},404);

    const username = (body.username!=null) ? String(body.username).trim() : null;
    if(username!==null){
      if(!username || username.length<2 || username.length>50 || /\s/.test(username)) return json({ok:false,error:"BAD_USERNAME",message:"아이디는 공백 없이 2~50자"},400);
      const dup=await env.DB.prepare("SELECT id FROM users WHERE username=? AND id!=?").bind(username, user_id).first();
      if(dup) return json({ok:false,error:"DUP",message:"이미 존재하는 아이디"},400);
    }
    const name = (body.name!=null) ? String(body.name).trim() : null;
    const payer_name = (body.payer_name!=null) ? String(body.payer_name).trim() : null;
    const role = (body.role!=null) ? String(body.role).trim() : null;
    const blocked = (body.blocked!=null) ? (body.blocked?1:0) : null;

    const sets=[]; const vals=[];
    if(username!==null){ sets.push("username=?"); vals.push(username); }
    if(name!==null){ sets.push("name=?"); vals.push(name||null); }
    if(payer_name!==null){ sets.push("payer_name=?"); vals.push(payer_name||null); }
    if(role!==null){ sets.push("role=?"); vals.push(role==="admin"?"admin":"customer"); }
    if(blocked!==null){ sets.push("blocked=?"); vals.push(blocked); }

    if(!sets.length) return json({ ok:true, updated:0 });
    vals.push(user_id);
    await env.DB.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
    return json({ ok:true, updated:1 });
  }
  if(p==="/api/admin/users/delete" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const user_id=Number(body.user_id);
    if(!Number.isFinite(user_id)) return json({ok:false,error:"BAD",message:"user_id 필요"},400);
    const cur=await env.DB.prepare("SELECT id,role FROM users WHERE id=?").bind(user_id).first();
    if(!cur) return json({ ok:true, deleted:0 });
    if(cur.role==="admin") return json({ ok:false, error:"FORBIDDEN", message:"admin 삭제 불가" }, 403);
    await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user_id).run();
    await env.DB.prepare("DELETE FROM payments WHERE user_id=?").bind(user_id).run();
    await env.DB.prepare("DELETE FROM deposit_requests WHERE user_id=?").bind(user_id).run();
    await env.DB.prepare("DELETE FROM posts WHERE author_id=?").bind(user_id).run();
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(user_id).run();
    return json({ ok:true, deleted:1 });
  }

  if(p==="/api/admin/users/bulk_seed" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const users=Array.isArray(body.users)?body.users:[];
    let created=0, skipped=0;
    for(const it of users){
      const username=String(it.username||it.user||it.id||"").trim();
      if(!username) { skipped++; continue; }
      const name=String(it.name||"").trim();
      const payer_name=String(it.payer_name||it.payer||"").trim();
      const role=String(it.role||"customer").trim();
      const exists=await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
      if(exists?.id){ skipped++; continue; }
      const salt=randId(16);
      const pass_hash=await sha256Hex(username+":"+salt); // 비번=아이디
      await env.DB.prepare("INSERT INTO users(username,pass_hash,salt,name,payer_name,role,blocked,created_at) VALUES(?,?,?,?,?, ?,0,?)")
        .bind(username, pass_hash, salt, name||null, payer_name||null, role==="admin"?"admin":"customer", nowISO()).run();
      created++;
    }
    return json({ ok:true, created, skipped });
  }

  if(p==="/api/admin/users/reset_all_passwords_same" && req.method==="POST"){
    await requireAdmin(env, req);
    const rows=await env.DB.prepare("SELECT id,username FROM users WHERE role!='admin'").all();
    let updated=0;
    for(const u of (rows.results||[])){
      const salt=randId(16);
      const pass_hash=await sha256Hex(String(u.username)+":"+salt);
      await env.DB.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(pass_hash, salt, Number(u.id)).run();
      updated++;
    }
    return json({ ok:true, updated });
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
    const username=String(body.username||body.id||body.user||body.userid||body.아이디||"").trim();
    const amount=Number(String(body.amount??0).replace(/[^0-9]/g,""));
    const paid_at=String(body.paid_at||"").trim();
    const status=String(body.status||"CONFIRMED").trim();
    const memo=String(body.memo||"").trim();
    if(!username) return json({ok:false,error:"BAD",message:"username 필요"},400);
    if(!parseYMD(paid_at)) return json({ok:false,error:"BAD_DATE",message:"결제일 YYYY-MM-DD"},400);
    if(!["CONFIRMED","PENDING","CANCELED"].includes(status)) return json({ok:false,error:"BAD_STATUS",message:"status"},400);
    const u=await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
    if(!u) return json({ok:false,error:"NOUSER",message:"사용자 없음"},404);

    // 중복 방지: 같은 user_id + paid_at + status=CONFIRMED는 1건만 유지
    if(status==="CONFIRMED"){
      const exists=await env.DB.prepare("SELECT 1 as x FROM payments WHERE user_id=? AND paid_at=? AND status='CONFIRMED' LIMIT 1").bind(u.id, paid_at).first();
      if(exists?.x) return json({ ok:true, skipped:true, reason:"DUP_CONFIRMED" });
    }

    await insertPayment(env, { user_id:u.id, amount, paid_at, status, memo: memo||null });
    return json({ ok:true });
  }

  if(p==="/api/admin/payments/update" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const id=body.id;
    if(id==null||id==="") return json({ok:false,error:"BAD",message:"id 필요"},400);

    const sets=[]; const vals=[];

    if(body.amount!=null){
      const amount=Number(String(body.amount??0).replace(/[^0-9]/g,""));
      sets.push("amount=?");
      vals.push(Number.isFinite(amount)?Math.max(0,Math.floor(amount)):0);
    }
    if(body.paid_at!=null){
      const paid_at=String(body.paid_at||"").trim();
      if(!parseYMD(paid_at)) return json({ok:false,error:"BAD_DATE",message:"결제일 YYYY-MM-DD"},400);
      sets.push("paid_at=?");
      vals.push(paid_at);
    }
    if(body.status!=null){
      const status=String(body.status||"").trim();
      if(!["CONFIRMED","PENDING","CANCELED"].includes(status)) return json({ok:false,error:"BAD_STATUS",message:"status"},400);
      sets.push("status=?");
      vals.push(status);
    }
    if(body.memo!=null){
      const memo=String(body.memo||"").trim();
      sets.push("memo=?");
      vals.push(memo||null);
    }

    if(!sets.length) return json({ ok:true, updated:0 });
    vals.push(id);
    await env.DB.prepare(`UPDATE payments SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
    return json({ ok:true, updated:1 });
  }

  if(p==="/api/admin/payments/delete" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const id=body.id;
    if(id==null||id==="") return json({ok:false,error:"BAD",message:"id 필요"},400);
    await env.DB.prepare("DELETE FROM payments WHERE id=?").bind(id).run();
    return json({ ok:true });
  }
  if(p==="/api/admin/payments/bulk_seed" && req.method==="POST"){
    await requireAdmin(env, req);
    const body=await readJson(req);
    const items = Array.isArray(body.items) ? body.items : [];
    const ok=[], skipped=[], missing=[];
    for(const it of items){
      const username=String(it.username||"").trim();
      const paid_at=String(it.paid_at||"").trim();
      if(!username||!parseYMD(paid_at)){ skipped.push({username,paid_at}); continue; }
      const u=await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
      if(!u){ missing.push({username,paid_at}); continue; }
      const exists=await env.DB.prepare("SELECT 1 as x FROM payments WHERE user_id=? AND paid_at=? AND status='CONFIRMED' LIMIT 1").bind(u.id, paid_at).first();
      if(exists?.x){ skipped.push({username,paid_at}); continue; }
      await insertPayment(env, { user_id:u.id, amount:0, paid_at, status:"CONFIRMED", memo:"seed" });
      ok.push({username,paid_at});
    }
    return json({ ok:true, inserted:ok.length, ok, skipped, missing });
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
