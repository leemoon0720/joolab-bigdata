const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

function fmt(n){
  if(n===null||n===undefined||n==="") return "-";
  const x = Number(String(n).replace(/[, ]/g,""));
  if(!Number.isFinite(x)) return String(n);
  return x.toLocaleString("ko-KR");
}
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}
function toast(msg,type="ok"){
  const el=$("#toast");
  if(!el){ alert(msg); return; }
  el.className="notice "+(type==="ok"?"ok":type==="warn"?"warn":"danger");
  el.textContent=msg; el.style.display="block";
  clearTimeout(window.__t); window.__t=setTimeout(()=>el.style.display="none",3500);
}
async function api(path, opts={}){
  const res = await fetch(path, { headers:{ "Content-Type":"application/json", ...(opts.headers||{}) }, credentials:"include", ...opts });
  const txt = await res.text();
  let data=null;
  try{ data = txt?JSON.parse(txt):null; }catch(_){ data={ ok:false, error:"INVALID_JSON", raw:txt }; }
  if(!res.ok || (data && data.ok===false)){
    const err=(data&&(data.message||data.error))||("HTTP_"+res.status);
    throw new Error(err);
  }
  return data;
}
function parseCSV(text){
  const rows=[]; let i=0, field="", row=[], inQ=false;
  while(i<text.length){
    const c=text[i];
    if(inQ){
      if(c==='"'){
        if(text[i+1]==='"'){ field+='"'; i+=2; continue; }
        inQ=false; i++; continue;
      }
      field+=c; i++; continue;
    }else{
      if(c==='"'){ inQ=true; i++; continue; }
      if(c===','){ row.push(field); field=""; i++; continue; }
      if(c==='\r'){ i++; continue; }
      if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=""; i++; continue; }
      field+=c; i++; continue;
    }
  }
  row.push(field);
  if(row.length>1 || (row.length===1 && row[0].trim()!=="")) rows.push(row);
  if(rows.length===0) return { headers:[], data:[] };
  const headers = rows[0].map(h=>h.trim());
  const data = rows.slice(1).map(r=>{
    const o={};
    for(let k=0;k<headers.length;k++) o[headers[k]]=(r[k]??"").trim();
    return o;
  });
  return { headers, data };
}
function pickKey(obj, cands){
  const ks=Object.keys(obj||{});
  for(const k of cands){
    if(k in obj) return k;
    const f=ks.find(x=>x.toLowerCase()===k.toLowerCase());
    if(f) return f;
  }
  return null;
}
function rankify(arr){
  const pairs=arr.map((v,idx)=>({v,idx})).filter(x=>Number.isFinite(x.v));
  pairs.sort((a,b)=>b.v-a.v);
  const rank=new Array(arr.length).fill(null);
  let r=1; for(const p of pairs) rank[p.idx]=r++;
  return rank;
}
function buildTableHtml(headers, rows, meta){
  const head=headers.map(h=>`<th>${esc(h)}</th>`).join("");
  const body=rows.map(r=>`<tr>${headers.map(h=>`<td>${esc(r[h]??"")}</td>`).join("")}</tr>`).join("");
  const badge = meta ? `<div class="row" style="gap:8px;flex-wrap:wrap">
    <span class="badge">카테고리: ${esc(meta.category)}</span>
    <span class="badge">리전: ${esc(meta.region)}</span>
    <span class="badge">행: ${fmt(rows.length)}</span>
    <span class="badge">생성: ${esc(meta.generatedAt)}</span>
  </div>` : "";
  const note = meta?.note ? `<div class="notice warn" style="margin-top:10px">${esc(meta.note)}</div>` : "";
  return `<div class="card">${badge}${note}<div style="margin-top:12px;overflow:auto;max-height:70vh">
    <table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </div></div>`;
}
function sortSuspicious(headers, data){
  const keyTV = pickKey(data[0]||{}, ["LastTV","거래대금","$TV","TV","tv"]);
  const keyOBV = pickKey(data[0]||{}, ["OBV_slope10","ΔOBV","OBV","obv"]);
  const tvArr = data.map(r=>{ const raw=keyTV?r[keyTV]:null; const x=Number(String(raw??"").replace(/[^\d\.\-]/g,"")); return Number.isFinite(x)?x:NaN;});
  const obvArr = data.map(r=>{ const raw=keyOBV?r[keyOBV]:null; const x=Number(String(raw??"").replace(/[^\d\.\-]/g,"")); return Number.isFinite(x)?x:NaN;});
  const rTV=rankify(tvArr), rOBV=rankify(obvArr);
  const scored=data.map((r,idx)=>{
    const a=rTV[idx], b=rOBV[idx];
    let score=999999;
    if(a!==null && b!==null) score=a+b;
    else if(a!==null) score=a;
    else if(b!==null) score=b;
    return {r,idx,score};
  });
  scored.sort((x,y)=>x.score-y.score || x.idx-y.idx);
  const top=scored.slice(0,15).map(x=>x.r);
  let note="Top15 기준: 거래대금 랭크 + OBV 랭크(없으면 자동 폴백)";
  if(!keyTV && !keyOBV) note="Top15 기준: 거래대금/OBV 컬럼이 없어 CSV 순서 상위 15개로 표시";
  else if(!keyOBV) note="Top15 기준: OBV 컬럼이 없어 거래대금 랭크 기준";
  else if(!keyTV) note="Top15 기준: 거래대금 컬럼이 없어 OBV 랭크 기준";
  return { rows:top, note };
}
function bindAuthUI(){
  const who=$("#who");
  if(!who) return;
  api("/api/me").then(d=>{
    who.innerHTML=`<span class="badge">로그인: ${esc(d.user.username)}</span> <span class="badge">${esc(d.access.status)}</span>`;
    $("#navAdmin")?.classList.toggle("hidden", d.user.role!=="admin");
  }).catch(()=>{ who.innerHTML=`<span class="badge">비로그인</span>`; $("#navAdmin")?.classList.add("hidden"); });
  $("#btnLogout")?.addEventListener("click", async ()=>{
    try{ await api("/api/auth/logout", {method:"POST", body:"{}"}); location.href="/login.html"; }
    catch(e){ toast(e.message,"danger"); }
  });
}
window.JOOLAB={ api, toast, parseCSV, buildTableHtml, sortSuspicious, fmt, esc, bindAuthUI };
