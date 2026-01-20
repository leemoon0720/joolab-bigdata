// Cloudflare Pages (Direct Upload compatible) Worker
// 목적: 홈 상단 지수/환율이 '-'가 아니라 실제 값으로 표시되도록 /api/market 제공
// 배경: Pages Direct Upload(Zip 업로드)에서는 /functions 가 실행되지 않을 수 있어 _worker.js 로 처리합니다.

const UA = 'Mozilla/5.0 (compatible; JooLabBigData/1.0)';

function toNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept': 'text/html,application/json,text/plain,*/*',
      'accept-language': 'en-US,en;q=0.9,ko;q=0.8'
    }
  });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.text();
}

async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept': 'application/json,text/plain,*/*',
      'accept-language': 'en-US,en;q=0.9,ko;q=0.8'
    }
  });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return await r.json();
}

function computeAbsChangeFromPct(price, pct) {
  if (price === null || pct === null) return null;
  const p = pct / 100;
  if (1 + p === 0) return null;
  return price - (price / (1 + p));
}

function parseKrxIndex(html, label) {
  const re = new RegExp(`\\b${label}\\b\\s*([0-9][0-9,]*\\.?[0-9]*)\\s*\\(([-+][0-9.]+)%\\)`, 'i');
  const m = html.match(re);
  if (!m) return null;
  const price = toNum(m[1]);
  const pct = toNum(m[2]);
  const change = computeAbsChangeFromPct(price, pct);
  return { price, change, pct, time: null, symbol: label };
}

async function fetchKrxMain() {
  const html = await fetchText('https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd?locale=en');
  return {
    kospi: parseKrxIndex(html, 'KOSPI'),
    kosdaq: parseKrxIndex(html, 'KOSDAQ')
  };
}

function parseStooqQuote(html) {
  // Stooq quote pages tend to contain compact fields like:
  //   Last4309.63
  //   Change+95.46 (+2.27%)
  // We parse both, tolerating optional whitespace/newlines.
  const lastM = html.match(/Last\s*([0-9][0-9,]*\.?[0-9]*)/i);
  const chgM = html.match(/Change\s*([+-]?[0-9][0-9,]*\.?[0-9]*)\s*\(\s*([+-]?[0-9][0-9,]*\.?[0-9]*)%\s*\)/i);

  if (!lastM) return null;

  const price = toNum(lastM[1]);
  let change = null;
  let pct = null;

  if (chgM) {
    change = toNum(chgM[1]);
    pct = toNum(chgM[2]);
  } else {
    // fallback: sometimes only percent is present; try to recover
    const pctOnly = html.match(/\(\s*([+-]?[0-9][0-9,]*\.?[0-9]*)%\s*\)/i);
    if (pctOnly) {
      pct = toNum(pctOnly[1]);
      change = computeAbsChangeFromPct(price, pct);
    }
  }

  if (pct === null || pct === undefined) return null;

  return { price, change, pct, time: null };
}

async function fetchStooq(sym) {
  const s = String(sym).toLowerCase();
  const url = `https://stooq.com/q/?s=${encodeURIComponent(s)}`;
  const html = await fetchText(url);
  return parseStooqQuote(html);
}

async function fetchYahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const j = await fetchJSON(url);
  const r = j && j.chart && j.chart.result && j.chart.result[0] ? j.chart.result[0] : null;
  const meta = r && r.meta ? r.meta : null;
  if (!meta) return null;

  const priceRaw = meta.regularMarketPrice ?? null;
  const prevRaw = meta.previousClose ?? null;
  const changeRaw = (priceRaw !== null && prevRaw !== null) ? (priceRaw - prevRaw) : (meta.regularMarketChange ?? null);
  const pctRaw = meta.regularMarketChangePercent ?? ((changeRaw !== null && prevRaw) ? (changeRaw / prevRaw) * 100 : null);
  const time = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;

  return {
    price: toNum(priceRaw),
    change: toNum(changeRaw),
    pct: toNum(pctRaw),
    time
  };
}

function withMeta(item, symbol) {
  if (!item) return null;
  return {
    symbol,
    price: item.price,
    change: item.change,
    pct: item.pct,
    time: item.time
  };
}

async function buildMarketItems() {
  const items = {};

  // 1) KR 지수: KRX 메인 페이지에서 파싱
  let krx = null;
  try { krx = await fetchKrxMain(); } catch (_) { krx = null; }
  if (krx && krx.kospi) items.kospi = withMeta(krx.kospi, 'KOSPI');
  if (krx && krx.kosdaq) items.kosdaq = withMeta(krx.kosdaq, 'KOSDAQ');

  // 2) 누락 시 폴백
  if (!items.kospi) {
    try {
      const st = await fetchStooq('^KOSPI');
      if (st) items.kospi = withMeta(st, '^KOSPI');
    } catch (_) {}
  }
  if (!items.kosdaq) {
    try {
      const yh = await fetchYahooChart('^KQ11');
      if (yh) items.kosdaq = withMeta(yh, '^KQ11');
    } catch (_) {}
  }

  // 3) 환율 + 미국지수: Stooq 우선, 실패 시 Yahoo 폴백
  const tasks = [
    ['usdkrw', 'usdkrw', 'USDKRW'],
    ['dow', '^dji', '^DJI'],
    ['nasdaq', '^ndq', '^NDQ'],
    ['sp500', '^spx', '^SPX']
  ];

  await Promise.all(tasks.map(async ([key, stSym, label]) => {
    try {
      const st = await fetchStooq(stSym);
      if (st) {
        items[key] = withMeta(st, label);
        return;
      }
    } catch (_) {}

    try {
      const map = { dow: '^DJI', nasdaq: '^IXIC', sp500: '^GSPC', usdkrw: 'USDKRW=X' };
      const yh = await fetchYahooChart(map[key]);
      if (yh) items[key] = withMeta(yh, map[key]);
    } catch (_) {}
  }));

  return items;
}

async function handleMarket() {
  const items = await buildMarketItems();
  const ok = Object.keys(items).length > 0;
  const body = JSON.stringify({
    ok,
    updated_at: new Date().toISOString(),
    items
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ok ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' : 'no-store'
    }
  });
}



// ==============================
// Auth / Session / Admin Storage
// - 목적: 로컬스토리지 기반 "가짜 로그인" 제거
// - 정적 회원명단(seed) 미사용
// - 관리자(admin)만 공지/팝업 저장 가능
// - 저장소: Cloudflare KV (권장: env.JLAB_KV). 없으면 읽기만(정적 JSON)로 폴백.
// ==============================

const COOKIE_NAME = 'jlab_sess';

function getAuthSecret(env) {
  const s = (env && env.JLAB_AUTH_SECRET) ? String(env.JLAB_AUTH_SECRET).trim() : '';
  return s ? s : null;
}
function jsonResp(obj, status=200, extraHeaders={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

function b64urlEncode(bytes) {
  let s = '';
  bytes = new Uint8Array(bytes);
  for (let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecodeToBytes(s) {
  s = (s||'').replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret, dataStr) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataStr));
  return b64urlEncode(sig);
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2,'0');
  return hex;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx+1).trim();
    out[k] = v;
  }
  return out;
}

function makeCookie(name, value, maxAgeSec, host) {
  const attrs = [
    `${name}=${value}`,
    `Path=/`,
    `SameSite=Lax`
  ];

  // 동일 최상위 도메인(joolab.co.kr) 하위 서브도메인 간 세션 유지
  try {
    const h = String(host || '').toLowerCase();
    if (h === 'joolab.co.kr' || h.endsWith('.joolab.co.kr')) {
      attrs.push('Domain=.joolab.co.kr');
    }
  } catch (e) {}

  // Pages/Workers는 HTTPS가 기본이므로 Secure를 켭니다.
  attrs.push('Secure');
  // XSS 방지
  attrs.push('HttpOnly');
  if (typeof maxAgeSec === 'number') attrs.push(`Max-Age=${maxAgeSec}`);
  return attrs.join('; ');
}

async function makeToken(secret, payload) {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

async function verifyToken(secret, token) {
  if (!token || token.indexOf('.') === -1) return null;
  const [body, sig] = token.split('.');
  const expect = await hmacSign(secret, body);
  if (expect !== sig) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(body)));
    if (payload && payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}


async function kvGetJSON(env, key) {
  try {
    if (env && env.JLAB_KV && typeof env.JLAB_KV.get === 'function') {
      const v = await env.JLAB_KV.get(key);
      if (!v) return null;
      return JSON.parse(v);
    }
  } catch (e) {}
  return null;
}

async function kvPutJSON(env, key, obj) {
  if (!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')) return false;
  await env.JLAB_KV.put(key, JSON.stringify(obj));
  return true;
}


async function fetchStaticJSON(env, baseUrl, path) {
  try {
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const req = new Request(new URL(path, baseUrl).toString(), { method: 'GET' });
      const res = await env.ASSETS.fetch(req);
      if (!res.ok) return null;
      return await res.json();
    }
  } catch (e) {}
  return null;
}

async function getUser(env, emailLower) {
  const kvKey = `user:${emailLower}`;
  const kvUser = await kvGetJSON(env, kvKey);
  if (kvUser) return { source: 'kv', user: kvUser };
  return null;
}


async function upsertUserInKV(env, emailLower, profile, passwordPlain, secret, roleOverride) {
  if (!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')) return false;
  const kvKey = `user:${emailLower}`;
  const passHash = await sha256Hex(`${secret}|${passwordPlain}`);
  const nowISO = new Date().toISOString();
  let existing = null;
  try { existing = await kvGetJSON(env, kvKey); } catch (e) { existing = null; }
  const obj = {
    email: emailLower,
    user_id: (profile && profile.user_id) ? String(profile.user_id) : (existing && existing.user_id ? existing.user_id : ''),
    name: (profile && profile.name) ? String(profile.name) : (existing && existing.name ? existing.name : ''),
    nickname: (profile && profile.nickname) ? String(profile.nickname) : (existing && existing.nickname ? existing.nickname : ''),
    phone: (profile && profile.phone) ? String(profile.phone) : (existing && existing.phone ? existing.phone : ''),
    role: roleOverride ? String(roleOverride) : (existing && existing.role ? existing.role : 'user'),
    pass_hash: passHash,
    created_at: (existing && existing.created_at) ? existing.created_at : nowISO,
    updated_at: nowISO
  };
  await env.JLAB_KV.put(kvKey, JSON.stringify(obj));
  return true;
}


function isPublicPath(pathname) {
  if (pathname === '/bigdata_gate' || pathname.startsWith('/bigdata_gate/')) return true;
  // 기본: 전부 공개
  // 예외: 빅데이터(/data, /strong, /accum, /suspicious)와 운영(/ops)은 로그인 필요
  if (pathname === "/data" || pathname.startsWith("/data/")) return false;
  if (pathname === "/strong" || pathname.startsWith("/strong/")) return false;
  if (pathname === "/accum" || pathname.startsWith("/accum/")) return false;
  if (pathname === "/suspicious" || pathname.startsWith("/suspicious/")) return false;
  if (pathname === "/ops" || pathname.startsWith("/ops/")) return false;
  return true;
}


async function requireAuth(request, env, baseUrl) {
  const secret = getAuthSecret(env);
  if (!secret) return null;
  const cookies = parseCookies(request.headers.get('cookie') || '');
  const token = cookies[COOKIE_NAME] || '';
  const payload = await verifyToken(secret, token);
  if (!payload || !payload.email) return null;
  return payload;
}

async function handleAuthLogin(request, env, baseUrl) {
  const secret = getAuthSecret(env);
  if (!secret) return jsonResp({ ok:false, message:'서버 설정이 완료되지 않았습니다. (JLAB_AUTH_SECRET 필요)' }, 200);

  let body = null;
  try { body = await request.json(); } catch(e) {}
  const email = String(body && body.email ? body.email : '').trim().toLowerCase();
  const pass = String(body && body.password ? body.password : '').trim();
  if (!email || !email.includes('@') || !pass) return jsonResp({ ok:false, message:'이메일/비밀번호를 확인해 주십시오.' }, 200);

  // 관리자 부트스트랩(시드/정적 회원명단 미사용)
  const adminEmail = String(env && env.JLAB_ADMIN_EMAIL ? env.JLAB_ADMIN_EMAIL : '').trim().toLowerCase();
  const adminPass = String(env && env.JLAB_ADMIN_PASSWORD ? env.JLAB_ADMIN_PASSWORD : '').trim();
  if (adminEmail && adminPass && email === adminEmail && pass === adminPass) {
    try { await upsertUserInKV(env, email, { user_id:'', name:'', nickname:'' }, pass, secret, 'admin'); } catch(e) {}
    const now = Date.now();
    const exp = now + 1000*60*60*24*14; // 14일
    const token = await makeToken(secret, { email, role: 'admin', iat: now, exp });
    const setCookie = makeCookie(COOKIE_NAME, token, 60*60*24*14, new URL(request.url).hostname);
    return jsonResp({ ok:true, user:{ email, role:'admin' } }, 200, { 'set-cookie': setCookie });
  }

  // 일반 회원: KV 기반 계정만 허용(정적 seed 폴백 제거)
  const rec = await getUser(env, email);
  if (!rec || !rec.user) return jsonResp({ ok:false, message:'등록된 회원이 아닙니다.' }, 200);

  if (!rec.user.pass_hash) return jsonResp({ ok:false, message:'비밀번호가 설정되지 않았습니다. 관리자에게 문의하십시오.' }, 200);
  const inHash = await sha256Hex(`${secret}|${pass}`);
  if (inHash !== rec.user.pass_hash) return jsonResp({ ok:false, message:'비밀번호가 올바르지 않습니다.' }, 200);

  const role = rec.user.role || 'user';
  const now = Date.now();
  const exp = now + 1000*60*60*24*14; // 14일
  const token = await makeToken(secret, { email, role, iat: now, exp });
  const setCookie = makeCookie(COOKIE_NAME, token, 60*60*24*14, new URL(request.url).hostname);
  return jsonResp({ ok:true, user:{ email, role } }, 200, { 'set-cookie': setCookie });
}




async function handleAuthSignupOrLogin(request, env, baseUrl) {
  const secret = getAuthSecret(env);
  if (!secret) return jsonResp({ ok:false, message:'서버 설정이 완료되지 않았습니다. (JLAB_AUTH_SECRET 필요)' }, 200);
  if (!(env && env.JLAB_KV && typeof env.JLAB_KV.get === 'function')) {
    return jsonResp({ ok:false, message:'서버 저장소(KV)가 설정되지 않아 회원가입을 지원하지 않습니다.' }, 200);
  }

  let body = null;
  try { body = await request.json(); } catch(e) {}

  const email = String(body && body.email ? body.email : '').trim().toLowerCase();
  const pass = String(body && body.password ? body.password : '').trim();
  const name = String(body && body.name ? body.name : '').trim();
  const nickname = String(body && body.nickname ? body.nickname : '').trim();
  const phone = String(body && body.phone ? body.phone : '').trim();

  if (!email || !email.includes('@') || pass.length < 8) {
    return jsonResp({ ok:false, message:'이메일/비밀번호(8자 이상)를 확인해 주십시오.' }, 200);
  }

  // If user exists -> login
  const rec = await getUser(env, email);
  if (rec && rec.user) {
    if (!rec.user.pass_hash) {
      return jsonResp({ ok:false, message:'비밀번호가 설정되지 않았습니다. 관리자에게 문의하십시오.' }, 200);
    }
    const inHash = await sha256Hex(`${secret}|${pass}`);
    if (inHash !== rec.user.pass_hash) {
      return jsonResp({ ok:false, message:'비밀번호가 올바르지 않습니다.' }, 200);
    }
    const role = rec.user.role || 'user';
    const now = Date.now();
    const exp = now + 1000*60*60*24*14;
    const token = await makeToken(secret, { email, role, iat: now, exp });
    const setCookie = makeCookie(COOKIE_NAME, token, 60*60*24*14, new URL(request.url).hostname);
    return jsonResp({ ok:true, mode:'login', user:{ email, role } }, 200, { 'set-cookie': setCookie });
  }

  // Otherwise create user -> login
  const profile = { user_id:'', name, nickname, phone };
  try {
    await upsertUserInKV(env, email, profile, pass, secret, 'user');
  } catch (e) {
    return jsonResp({ ok:false, message:'회원가입 처리 중 오류가 발생했습니다.' }, 200);
  }

  const now = Date.now();
  const exp = now + 1000*60*60*24*14;
  const token = await makeToken(secret, { email, role: 'user', iat: now, exp });
  const setCookie = makeCookie(COOKIE_NAME, token, 60*60*24*14, new URL(request.url).hostname);
  return jsonResp({ ok:true, mode:'signup', user:{ email, role:'user' } }, 200, { 'set-cookie': setCookie });
}
async function handleAuthMe(request, env, baseUrl) {
  const payload = await requireAuth(request, env, baseUrl);
  if (!payload) return jsonResp({ ok:false }, 200);
  return jsonResp({ ok:true, user:{ email: payload.email, role: payload.role || 'user' } }, 200);
}

async function handleAuthLogout(request, env, baseUrl) {
  const host = new URL(request.url).hostname;
  const h = String(host || '').toLowerCase();

  // 쿠키 삭제는 'Domain 유무'에 따라 별개로 존재할 수 있으므로
  // 1) host-only 쿠키 삭제 2) (해당 시) .joolab.co.kr 도메인 쿠키 삭제를 함께 수행합니다.
  const cookies = [];

  // 1) host-only 삭제 (Domain 속성 없이)
  cookies.push(makeCookie(COOKIE_NAME, '', 0, ''));

  // 2) 최상위 도메인 공유 쿠키 삭제 (.joolab.co.kr)
  if (h === 'joolab.co.kr' || h.endsWith('.joolab.co.kr')) {
    const attrs = [
      `${COOKIE_NAME}=`,
      `Path=/`,
      `SameSite=Lax`,
      `Domain=.joolab.co.kr`,
      `Secure`,
      `HttpOnly`,
      `Max-Age=0`
    ];
    cookies.push(attrs.join('; '));
  }

  const u = new URL(request.url);
  const next = u.searchParams.get('next');

  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  for (const c of cookies) headers.append('set-cookie', c);

  // next가 있으면 브라우저 네비게이션 기반 로그아웃도 지원(세션 반영이 확실합니다)
  if (next) {
    headers.set('location', next);
    return new Response('', { status: 302, headers });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}


async function handleAuthChangePassword(request, env, baseUrl) {
  const secret = getAuthSecret(env);
  if (!secret) return jsonResp({ ok:false, message:'서버 설정이 완료되지 않았습니다. (JLAB_AUTH_SECRET 필요)' }, 200);
  const payload = await requireAuth(request, env, baseUrl);
  if (!payload) return jsonResp({ ok:false, message:'로그인이 필요합니다.' }, 200);
  if (!(env && env.JLAB_KV && typeof env.JLAB_KV.get === 'function')) {
    return jsonResp({ ok:false, message:'서버 저장소(KV)가 설정되지 않아 비밀번호 변경을 지원하지 않습니다.' }, 200);
  }
  let body=null;
  try{ body=await request.json(); } catch(e){}
  const oldPass=String(body && body.old_password ? body.old_password : '').trim();
  const newPass=String(body && body.new_password ? body.new_password : '').trim();
  if (newPass.length < 8) return jsonResp({ ok:false, message:'비밀번호는 8자 이상으로 설정해 주십시오.' }, 200);

  const email = String(payload.email).toLowerCase();
  const kvKey = `user:${email}`;
  const kvUser = await kvGetJSON(env, kvKey);
  if (!kvUser || !kvUser.pass_hash) return jsonResp({ ok:false, message:'계정 정보가 올바르지 않습니다.' }, 200);
  const oldHash = await sha256Hex(`${secret}|${oldPass}`);
  if (oldHash !== kvUser.pass_hash) return jsonResp({ ok:false, message:'기존 비밀번호가 올바르지 않습니다.' }, 200);

  kvUser.pass_hash = await sha256Hex(`${secret}|${newPass}`);
  kvUser.updated_at = new Date().toISOString();
  await kvPutJSON(env, kvKey, kvUser);
  return jsonResp({ ok:true, message:'비밀번호가 변경되었습니다.' }, 200);
}

// ==============================
// Subscription (server-side)
// - 목적: localStorage 기반 구독 판정 제거
// - 저장: KV key sub:<email>
//   { email, plan, status, expire_at, created_at, updated_at }
// - access_active: (status in [active,canceled]) && (expire_at null or expire_at > now)
// ==============================
function _normalizePlan(p){
  const x = String(p||'').trim().toLowerCase();
  if(!x) return '';
  const map = {
    'basic':'basic',
    'pro':'pro',
    'premium':'pro',
    'vip':'vip',
    'coaching':'coaching'
  };
  return map[x] || x;
}
function _planDisplay(p){
  const x = _normalizePlan(p);
  if(x === 'basic') return 'BASIC';
  if(x === 'pro') return 'PREMIUM';
  if(x === 'vip') return 'VIP';
  if(x === 'coaching') return 'COACHING';
  if(x === 'admin') return 'ADMIN';
  return '미구독';
}

async function getSubscription(env, emailLower){
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.get === 'function')) return null;
  return await kvGetJSON(env, `sub:${emailLower}`);
}

function computeSubscriptionView(sub){
  if(!sub) return { plan:'', plan_display:'미구독', status:'none', expire_at:null, access_active:false };
  const plan = _normalizePlan(sub.plan||'');
  const status = String(sub.status||'none').trim().toLowerCase();
  const expire_at = sub.expire_at || null;
  let active = false;
  if(status === 'active' || status === 'canceled'){
    if(!expire_at){
      active = true
    } else {
      const ts = Date.parse(String(expire_at));
      if(Number.isFinite(ts) && ts > Date.now()) active = true;
    }
  }
  return {
    plan,
    plan_display: _planDisplay(plan),
    status,
    expire_at,
    access_active: active
  };
}

async function handleSubscriptionMe(request, env, baseUrl){
  const payload = await requireAuth(request, env, baseUrl);
  if(!payload) return jsonResp({ok:false, message:'로그인이 필요합니다.'}, 200);
  const email = String(payload.email||'').trim().toLowerCase();
  const role = String(payload.role||'user');

  if(role === 'admin'){
    return jsonResp({ ok:true, email, role, plan:'admin', plan_display:'ADMIN', status:'active', expire_at:null, access_active:true }, 200);
  }

  const sub = await getSubscription(env, email);
  const view = computeSubscriptionView(sub);
  return jsonResp({ ok:true, email, role, ...view }, 200);
}

async function handleSubscriptionAdminSet(request, env, baseUrl){
  const admin = await requireAdmin(request, env, baseUrl);
  if(!admin) return jsonResp({ok:false, message:'관리자 권한이 필요합니다.'}, 200);
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')){
    return jsonResp({ok:false, message:'서버 저장소(KV)가 설정되지 않았습니다.'}, 200);
  }

  const body = await request.json().catch(()=> ({}));
  const email = String(body.email||'').trim().toLowerCase();
  const planIn = _normalizePlan(body.plan||'');
  const days = Number(body.days);
  const expireAtIn = String(body.expire_at||'').trim();

  if(!email || !email.includes('@')) return jsonResp({ok:false, message:'이메일이 올바르지 않습니다.'}, 200);

  // planIn empty/none -> delete subscription
  const allowed = ['basic','pro','vip','coaching'];
  if(planIn && !allowed.includes(planIn)) return jsonResp({ok:false, message:'플랜이 올바르지 않습니다.'}, 200);

  const key = `sub:${email}`;
  if(!planIn){
    try{ await env.JLAB_KV.delete(key); }catch(e){}
    return jsonResp({ok:true, email, deleted:true}, 200);
  }

  let expire_at = null
  if(expireAtIn){
    // accept ISO or yyyy-mm-dd
    let d = Date.parse(expireAtIn);
    if(!Number.isFinite(d)) return jsonResp({ok:false, message:'만료일(expire_at)이 올바르지 않습니다.'}, 200);
    expire_at = new Date(d).toISOString();
  } else {
    const addDays = (Number.isFinite(days) && days>0) ? days : 30;
    expire_at = new Date(Date.now() + addDays*86400000).toISOString();
  }

  let existing = null;
  try{ existing = await kvGetJSON(env, key); }catch(e){ existing = null; }
  const nowISO = new Date().toISOString();
  const rec = {
    email,
    plan: planIn,
    status: 'active',
    expire_at,
    created_at: (existing && existing.created_at) ? existing.created_at : nowISO,
    updated_at: nowISO,
    updated_by: admin.email || admin.user_id || 'admin'
  };
  await env.JLAB_KV.put(key, JSON.stringify(rec));
  return jsonResp({ok:true, email, plan:planIn, plan_display:_planDisplay(planIn), status:'active', expire_at}, 200);
}

async function handleSubscriptionCancel(request, env, baseUrl){
  const payload = await requireAuth(request, env, baseUrl);
  if(!payload) return jsonResp({ok:false, message:'로그인이 필요합니다.'}, 200);
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')){
    return jsonResp({ok:false, message:'서버 저장소(KV)가 설정되지 않았습니다.'}, 200);
  }
  const email = String(payload.email||'').trim().toLowerCase();
  const key = `sub:${email}`;
  let existing = null;
  try{ existing = await kvGetJSON(env, key); }catch(e){ existing = null; }
  if(!existing){
    return jsonResp({ok:false, message:'구독 정보가 없습니다.'}, 200);
  }
  existing.status = 'canceled';
  existing.updated_at = new Date().toISOString();
  existing.updated_by = email;
  await env.JLAB_KV.put(key, JSON.stringify(existing));
  const view = computeSubscriptionView(existing);
  return jsonResp({ok:true, email, ...view}, 200);
}



// ==============================
// Payments (Toss, single payment → expiry subscription)
// - 목적: 승인 전 테스트 결제 흐름 구축 (단건결제/만료형 이용권)
// - 저장: KV
//    order:<orderId>  { orderId, email, plan, amount, status, created_at, updated_at, paymentKey? }
// - 구독: sub:<email> 업데이트 (active + expire_at + 30일)
// ==============================
function getPriceByPlan(env, plan){
  const p = _normalizePlan(plan);
  const ov = (k)=>{ const v=(env&&env[k]!=null)?String(env[k]).trim():''; const n=Number(v); return (Number.isFinite(n) && n>0) ? Math.floor(n) : null; };
  const defaults = { basic:29000, pro:99000, vip:199000, coaching:150000 };
  const map = { basic:'PRICE_BASIC', pro:'PRICE_PRO', vip:'PRICE_VIP', coaching:'PRICE_COACHING' };
  const key = map[p];
  const o = key ? ov(key) : null;
  return o || defaults[p] || 0;
}
function planToOrderName(plan){
  const p=_normalizePlan(plan);
  if(p==='basic') return '주랩 BASIC 월간 이용권';
  if(p==='pro') return '주랩 PREMIUM 월간 이용권';
  if(p==='vip') return '주랩 VIP 월간 이용권';
  if(p==='coaching') return '주랩 COACHING 이용권';
  return '주랩 이용권';
}
function addDaysISO(baseMs, days){
  const d = new Date(baseMs + days*86400000);
  return d.toISOString();
}
function safeOrigin(urlOrigin){
  return String(urlOrigin||'').replace(/\/+$/,'');
}

async function handleTossConfig(request, env, baseUrl){
  const clientKey = (env && env.TOSS_CLIENT_KEY) ? String(env.TOSS_CLIENT_KEY).trim() : '';
  if(!clientKey) return jsonResp({ok:false, message:'TOSS_CLIENT_KEY 미설정'}, 200);
  const origin = safeOrigin(baseUrl);
  return jsonResp({
    ok:true,
    clientKey,
    successUrl: origin + '/pay/success/',
    failUrl: origin + '/pay/fail/'
  }, 200);
}

async function handleOrdersCreate(request, env, baseUrl){
  const payload = await requireAuth(request, env, baseUrl);
  if(!payload) return jsonResp({ok:false, message:'로그인이 필요합니다.'}, 401);
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')){
    return jsonResp({ok:false, message:'서버 저장소(KV)가 설정되지 않았습니다.'}, 200);
  }
  const body = await request.json().catch(()=> ({}));
  const plan = _normalizePlan(body.plan||'');
  const allowed=['basic','pro','vip','coaching'];
  if(!allowed.includes(plan)) return jsonResp({ok:false, message:'플랜이 올바르지 않습니다.'}, 200);

  const amount = getPriceByPlan(env, plan);
  if(!amount || amount<100) return jsonResp({ok:false, message:'결제 금액 설정이 올바르지 않습니다.'}, 200);

  const orderId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + String(Date.now());
  const email = String(payload.email||'').trim().toLowerCase();
  const nowISO = new Date().toISOString();
  const origin = safeOrigin(baseUrl);
  const rec = {
    orderId,
    email,
    plan,
    amount,
    status:'READY',
    created_at: nowISO,
    updated_at: nowISO
  };
  await env.JLAB_KV.put(`order:${orderId}`, JSON.stringify(rec));
  return jsonResp({
    ok:true,
    orderId,
    orderName: planToOrderName(plan),
    amount,
    customerEmail: email,
    successUrl: origin + '/pay/success/',
    failUrl: origin + '/pay/fail/',
    customerKey: orderId
  }, 200);
}

async function handleTossConfirm(request, env, baseUrl){
  const payload = await requireAuth(request, env, baseUrl);
  if(!payload) return jsonResp({ok:false, message:'로그인이 필요합니다.'}, 401);
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')){
    return jsonResp({ok:false, message:'서버 저장소(KV)가 설정되지 않았습니다.'}, 200);
  }
  const secretKey = (env && env.TOSS_SECRET_KEY) ? String(env.TOSS_SECRET_KEY).trim() : '';
  if(!secretKey) return jsonResp({ok:false, message:'TOSS_SECRET_KEY 미설정'}, 200);

  const body = await request.json().catch(()=> ({}));
  const paymentKey = String(body.paymentKey||'').trim();
  const orderId = String(body.orderId||'').trim();
  const amount = Number(body.amount);
  if(!paymentKey || !orderId || !Number.isFinite(amount)) return jsonResp({ok:false, message:'요청 값이 올바르지 않습니다.'}, 200);

  const orderKey = `order:${orderId}`;
  const order = await kvGetJSON(env, orderKey);
  if(!order || !order.email) return jsonResp({ok:false, message:'주문 정보를 찾을 수 없습니다.'}, 200);

  const email = String(order.email||'').trim().toLowerCase();
  const me = String(payload.email||'').trim().toLowerCase();
  const role = String(payload.role||'user');
  if(role !== 'admin' && me !== email){
    return jsonResp({ok:false, message:'권한이 없습니다.'}, 403);
  }

  if(Number(order.amount) !== Math.floor(amount)){
    return jsonResp({ok:false, message:'결제 금액이 일치하지 않습니다.'}, 200);
  }

  if(String(order.status||'') === 'PAID'){
    const sub = await getSubscription(env, email);
    const view = computeSubscriptionView(sub);
    return jsonResp({ok:true, already:true, email, ...view}, 200);
  }

  const auth = btoa(secretKey + ':');
  let confirmJson = null;
  try{
    const resp = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method:'POST',
      headers:{
        'Authorization': 'Basic ' + auth,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Math.floor(amount) })
    });
    const text = await resp.text();
    try { confirmJson = JSON.parse(text); } catch(_) { confirmJson = { raw:text }; }
    if(!resp.ok){
      order.status = 'FAILED';
      order.updated_at = new Date().toISOString();
      order.fail = { status: resp.status, body: confirmJson };
      await env.JLAB_KV.put(orderKey, JSON.stringify(order));
      return jsonResp({ok:false, message:'결제 승인 실패', status: resp.status, detail: confirmJson}, 200);
    }
  }catch(e){
    order.status = 'FAILED';
    order.updated_at = new Date().toISOString();
    order.fail = { error: String(e && e.message ? e.message : e) };
    await env.JLAB_KV.put(orderKey, JSON.stringify(order));
    return jsonResp({ok:false, message:'결제 승인 요청 오류', detail: String(e && e.message ? e.message : e)}, 200);
  }

  order.status = 'PAID';
  order.paymentKey = paymentKey;
  order.updated_at = new Date().toISOString();
  order.paid_at = order.updated_at;
  await env.JLAB_KV.put(orderKey, JSON.stringify(order));

  const nowISO = new Date().toISOString();
  const days = 30;
  let baseMs = Date.now();
  let existing = await getSubscription(env, email);
  if(existing && existing.expire_at){
    const ex = Date.parse(String(existing.expire_at));
    if(Number.isFinite(ex) && ex > baseMs) baseMs = ex;
  }
  const expire_at = addDaysISO(baseMs, days);
  const subRec = {
    email,
    plan: order.plan,
    status: 'active',
    expire_at,
    created_at: (existing && existing.created_at) ? existing.created_at : nowISO,
    updated_at: nowISO,
    updated_by: 'payment'
  };
  await env.JLAB_KV.put(`sub:${email}`, JSON.stringify(subRec));
  const view = computeSubscriptionView(subRec);
  return jsonResp({ok:true, email, payment: confirmJson, ...view}, 200);
}


async function handleNoticeLatest(request, env, baseUrl) {
  const kvVal = await kvGetJSON(env, 'notice_latest');
  if (kvVal) return jsonResp({ ok:true, ...kvVal }, 200);
  const staticVal = await fetchStaticJSON(env, baseUrl, '/notice/latest.json');
  if (staticVal) return jsonResp({ ok:true, ...staticVal }, 200);
  return jsonResp({ ok:true, updated_at:new Date().toISOString(), status_text:'대기', status_kind:'wait', items:[] }, 200);
}

async function handlePopupConfig(request, env, baseUrl) {
  const kvVal = await kvGetJSON(env, 'popup_config');
  if (kvVal) return jsonResp({ ok:true, ...kvVal }, 200);
  const staticVal = await fetchStaticJSON(env, baseUrl, '/notice/popup.json');
  if (staticVal) return jsonResp({ ok:true, ...staticVal }, 200);
  return jsonResp({ ok:true, updated_at:new Date().toISOString(), enabled:false }, 200);
}

async function requireAdmin(request, env, baseUrl) {
  const payload = await requireAuth(request, env, baseUrl);
  if (!payload) return null;
  if ((payload.role || 'user') !== 'admin') return null;
  return payload;
}

async function handleAdminNoticeSave(request, env, baseUrl) {
  const admin = await requireAdmin(request, env, baseUrl);
  if (!admin) return jsonResp({ ok:false, message:'관리자 권한이 필요합니다.' }, 200);
  if (!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')) {
    return jsonResp({ ok:false, message:'서버 저장소(KV)가 설정되지 않아 저장할 수 없습니다.' }, 200);
  }
  let body=null;
  try{ body=await request.json(); } catch(e){}
  if (!body || typeof body !== 'object') return jsonResp({ ok:false, message:'저장 데이터가 올바르지 않습니다.' }, 200);

  const safe = {
    updated_at: new Date().toISOString(),
    status_text: String(body.status_text || '대기'),
    status_kind: String(body.status_kind || 'wait'),
    items: Array.isArray(body.items) ? body.items.slice(0, 50) : []
  };
  await kvPutJSON(env, 'notice_latest', safe);
  return jsonResp({ ok:true, updated_at: safe.updated_at }, 200);
}

async function handleAdminPopupSave(request, env, baseUrl) {
  const admin = await requireAdmin(request, env, baseUrl);
  if (!admin) return jsonResp({ ok:false, message:'관리자 권한이 필요합니다.' }, 200);
  if (!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')) {
    return jsonResp({ ok:false, message:'서버 저장소(KV)가 설정되지 않아 저장할 수 없습니다.' }, 200);
  }
  let body=null;
  try{ body=await request.json(); } catch(e){}
  if (!body || typeof body !== 'object') return jsonResp({ ok:false, message:'저장 데이터가 올바르지 않습니다.' }, 200);

  const safe = {
    updated_at: new Date().toISOString(),
    enabled: Boolean(body.enabled),
    title: String(body.title || '공지'),
    body: String(body.body || ''),
    link_url: String(body.link_url || ''),
    link_text: String(body.link_text || '자세히'),
    start_at: body.start_at || null,
    end_at: body.end_at || null,
    dismiss_hours: Number.isFinite(Number(body.dismiss_hours)) ? Number(body.dismiss_hours) : 24
  };
  await kvPutJSON(env, 'popup_config', safe);
  return jsonResp({ ok:true, updated_at: safe.updated_at }, 200);
}


// ==============================
// Admin User Management (KV)
// - 목적: 일반회원 생성/비밀번호 재설정(관리자 전용)
// - 저장: KV key user:<email>
// ==============================

async function handleAdminUsersCreate(request, env, baseUrl){
  const admin = await requireAdmin(request, env, baseUrl);
  if(!admin) return jsonResp({ ok:false, message:'관리자 권한이 필요합니다.' }, 200);
  const secret = getAuthSecret(env);
  if(!secret) return jsonResp({ ok:false, message:'서버 설정이 완료되지 않았습니다. (JLAB_AUTH_SECRET 필요)' }, 200);
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')){
    return jsonResp({ ok:false, message:'서버 저장소(KV)가 설정되지 않았습니다.' }, 200);
  }

  const body = await request.json().catch(()=> ({}));
  const email = String(body.email||'').trim().toLowerCase();
  const password = String(body.password||'').trim();
  const name = String(body.name||'').trim();
  const nickname = String(body.nickname||'').trim();
  const roleIn = String(body.role||'user').trim().toLowerCase();

  if(!email || !email.includes('@')) return jsonResp({ ok:false, message:'이메일이 올바르지 않습니다.' }, 200);
  if(password.length < 8) return jsonResp({ ok:false, message:'비밀번호는 8자 이상으로 설정해 주십시오.' }, 200);

  const role = (roleIn === 'admin') ? 'admin' : 'user';

  try{
    await upsertUserInKV(env, email, { name, nickname }, password, secret, role);
  }catch(e){
    return jsonResp({ ok:false, message:'생성 실패', detail:String(e && e.message ? e.message : e) }, 200);
  }

  return jsonResp({ ok:true, email, role }, 200);
}

async function handleAdminUsersResetPassword(request, env, baseUrl){
  const admin = await requireAdmin(request, env, baseUrl);
  if(!admin) return jsonResp({ ok:false, message:'관리자 권한이 필요합니다.' }, 200);
  const secret = getAuthSecret(env);
  if(!secret) return jsonResp({ ok:false, message:'서버 설정이 완료되지 않았습니다. (JLAB_AUTH_SECRET 필요)' }, 200);
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')){
    return jsonResp({ ok:false, message:'서버 저장소(KV)가 설정되지 않았습니다.' }, 200);
  }

  const body = await request.json().catch(()=> ({}));
  const email = String(body.email||'').trim().toLowerCase();
  const newPassword = String(body.new_password||'').trim();
  if(!email || !email.includes('@')) return jsonResp({ ok:false, message:'이메일이 올바르지 않습니다.' }, 200);
  if(newPassword.length < 8) return jsonResp({ ok:false, message:'비밀번호는 8자 이상으로 설정해 주십시오.' }, 200);

  const key = `user:${email}`;
  const existing = await kvGetJSON(env, key);
  if(!existing) return jsonResp({ ok:false, message:'등록된 회원이 아닙니다.' }, 200);

  try{
    await upsertUserInKV(env, email, { name: existing.name||'', nickname: existing.nickname||'', user_id: existing.user_id||'' }, newPassword, secret, existing.role || 'user');
  }catch(e){
    return jsonResp({ ok:false, message:'재설정 실패', detail:String(e && e.message ? e.message : e) }, 200);
  }

  return jsonResp({ ok:true, email }, 200);
}

async function handleAdminUsersGet(request, env, baseUrl){
  const admin = await requireAdmin(request, env, baseUrl);
  if(!admin) return jsonResp({ ok:false, message:'관리자 권한이 필요합니다.' }, 200);
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.get === 'function')){
    return jsonResp({ ok:false, message:'서버 저장소(KV)가 설정되지 않았습니다.' }, 200);
  }

  const u = new URL(request.url);
  const email = String(u.searchParams.get('email')||'').trim().toLowerCase();
  if(!email || !email.includes('@')) return jsonResp({ ok:false, message:'이메일이 올바르지 않습니다.' }, 200);

  const rec = await kvGetJSON(env, `user:${email}`);
  if(!rec) return jsonResp({ ok:false, message:'NOT_FOUND' }, 200);

  // do not expose pass_hash
  const out = { ...rec };
  if(out.pass_hash) delete out.pass_hash;
  return jsonResp({ ok:true, user: out }, 200);
}

async function handleAdminSignupRequests(request, env, baseUrl){
  const admin = await requireAdmin(request, env, baseUrl);
  if(!admin) return jsonResp({ ok:false, message:'관리자 권한이 필요합니다.' }, 200);
  if(!(env && env.JLAB_KV && typeof env.JLAB_KV.list === 'function')){
    return jsonResp({ ok:false, message:'서버 저장소(KV)가 설정되지 않았습니다.' }, 200);
  }

  const u = new URL(request.url);
  let limit = parseInt(u.searchParams.get('limit') || '20', 10);
  if(!Number.isFinite(limit) || limit < 1) limit = 20;
  if(limit > 50) limit = 50;

  const listed = await env.JLAB_KV.list({ prefix: 'signup/requests/', limit });
  const keys = (listed && listed.keys) ? listed.keys.map(k=>k.name) : [];
  // 최신이 앞으로 오도록 역순
  keys.sort();
  keys.reverse();

  const items = [];
  for(const k of keys){
    try{
      const v = await env.JLAB_KV.get(k);
      if(!v) continue;
      const j = JSON.parse(v);
      items.push(j);
    }catch(e){}
  }
  return jsonResp({ ok:true, items }, 200);
}

// ==============================
// Posts (KV storage)
// ==============================
function compactTs(d=new Date()){
  const pad=(n)=>String(n).padStart(2,'0');
  return String(d.getUTCFullYear()) + pad(d.getUTCMonth()+1) + pad(d.getUTCDate()) +
         pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
}

async function handlePostsCreate(request, env, baseUrl){
  const admin = await requireAdmin(request, env, baseUrl);
  if(!admin) return jsonResp({ok:false, error:'FORBIDDEN'}, 403);
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING'}, 200);

  const body = await request.json().catch(()=> ({}));
  const category = String(body.category||'').trim();
  const region = String(body.region||'').trim().toUpperCase();
  const title = String(body.title||'').trim();
  const date_key = String(body.date_key||'').trim();
  const html = String(body.html||'');
  const thumb = String(body.thumb||'');

  const is_sample = Boolean(body.is_sample);

  const allowed = ['strong','accum','suspicious','perf','meme'];
  if(!allowed.includes(category)) return jsonResp({ok:false, error:'BAD_CATEGORY'}, 200);
  if(!['KR','US'].includes(region)) return jsonResp({ok:false, error:'BAD_REGION'}, 200);
  if(!title || html.length < 10) return jsonResp({ok:false, error:'BAD_PAYLOAD'}, 200);

  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
  const ts = compactTs(new Date());
  const created_at = new Date().toISOString();

  const meta = { id, category, region, title, date_key, thumb, created_at, created_ts: ts, is_sample, by: admin.email || admin.user_id || 'admin' };

    if(thumb && thumb.length > 200000) {
    // thumbnail too large
    meta.thumb = '';
  }

const metaKey = `posts/meta/${category}/${region}/${ts}_${id}.json`;
  const idKey = `posts/id/${id}.json`;
  const htmlKey = `posts/html/${id}.html`;

  await env.JLAB_KV.put(metaKey, JSON.stringify(meta));
  await env.JLAB_KV.put(idKey, JSON.stringify(meta));
  await env.JLAB_KV.put(htmlKey, html);

  // latest pointers
  if(['strong','accum','suspicious'].includes(category)){
    await env.JLAB_KV.put('posts/latest/bigdata.json', JSON.stringify(meta));
  }
  if(category === 'perf'){
    await env.JLAB_KV.put('posts/latest/perf.json', JSON.stringify(meta));
  }
  if(category === 'meme'){
    await env.JLAB_KV.put('posts/latest/meme.json', JSON.stringify(meta));
  }

  return jsonResp({ok:true, id, meta}, 200);
}

async function _listMetaByPrefix(env, prefix, limit){
  const out=[];
  const listed = await env.JLAB_KV.list({prefix, limit: limit || 50});
  for(const k of (listed.keys||[])){
    try{
      const v = await env.JLAB_KV.get(k.name);
      if(v){
        const j = JSON.parse(v);
        out.push(j);
      }
    }catch(e){}
  }
  return out;
}

async function handlePostsList(request, env){
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING', items:[]}, 200);
  const url = new URL(request.url);
  const category = String(url.searchParams.get('category')||'').trim();
  const region = String(url.searchParams.get('region')||'').trim().toUpperCase();
  const reqLimit = Math.min(Math.max(parseInt(url.searchParams.get('limit')||'30',10)||30, 1), 80);

  const sampleOnly = String(url.searchParams.get('sample')||'').trim() === '1';

  const allowed = ['strong','accum','suspicious','perf','meme'];
  if(!allowed.includes(category)) return jsonResp({ok:false, error:'BAD_CATEGORY', items:[]}, 200);

  const isBigdataCat = (category === 'strong' || category === 'accum' || category === 'suspicious');

  // 빅데이터는 로그인 필요. 단, sample=1(샘플)은 비로그인 공개.
  if (isBigdataCat && !sampleOnly) {
    const payload = await requireAuth(request, env, url.origin);
    if(!payload) return jsonResp({ok:false, error:'LOGIN_REQUIRED', items:[]}, 401);
  }

  // 샘플은 "불리하게": 최대 1개만 노출
  const limit = (isBigdataCat && sampleOnly) ? Math.min(reqLimit, 1) : reqLimit;

  let items=[];
  if(region && region !== 'ALL'){
    const prefix = `posts/meta/${category}/${region}/`;
    items = await _listMetaByPrefix(env, prefix, limit);
  }else{
    const a = await _listMetaByPrefix(env, `posts/meta/${category}/KR/`, limit);
    const b = await _listMetaByPrefix(env, `posts/meta/${category}/US/`, limit);
    items = a.concat(b);
  }

  if(sampleOnly){ items = (items||[]).filter(x=>!!(x && x.is_sample)); }

  items.sort((x,y)=> String(y.created_ts||'').localeCompare(String(x.created_ts||'')));
  items = items.slice(0, limit);

  const updated_at = items[0]?.created_at || new Date().toISOString();
  return jsonResp({ok:true, updated_at, count: items.length, items}, 200);
}
async function handlePostsLatest(request, env){
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING'}, 200);
  const url = new URL(request.url);
  const scope = String(url.searchParams.get('scope')||'bigdata').trim();

  const isBigdataScope = !(scope === 'perf' || scope === 'meme');
  if (isBigdataScope) {
    const payload = await requireAuth(request, env, url.origin);
    if(!payload) return jsonResp({ok:false, error:'LOGIN_REQUIRED'}, 401);
  }

  const key = (scope === 'perf') ? 'posts/latest/perf.json' : (scope === 'meme') ? 'posts/latest/meme.json' : 'posts/latest/bigdata.json';
  const v = await env.JLAB_KV.get(key);
  if(!v) return jsonResp({ok:false, error:'EMPTY'}, 200);
  try{
    return jsonResp({ok:true, meta: JSON.parse(v)}, 200);
  }catch(e){
    return jsonResp({ok:false, error:'BAD_JSON'}, 200);
  }
}

async function handlePostsGet(request, env){
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING'}, 200);
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id')||'').trim();
  if(!id) return jsonResp({ok:false, error:'NO_ID'}, 200);

  const metaStr = await env.JLAB_KV.get(`posts/id/${id}.json`);
  const html = await env.JLAB_KV.get(`posts/html/${id}.html`);
  if(!metaStr || !html) return jsonResp({ok:false, error:'NOT_FOUND'}, 200);

  let meta=null;
  try{ meta = JSON.parse(metaStr); }catch(e){ meta=null; }

  const cat = String(meta && meta.category ? meta.category : '').trim();
  const isBigdataCat = (cat === 'strong' || cat === 'accum' || cat === 'suspicious');
  if (isBigdataCat && !(meta && meta.is_sample)) {
    const payload = await requireAuth(request, env, url.origin);
    if(!payload) return jsonResp({ok:false, error:'LOGIN_REQUIRED'}, 401);
  }

  return jsonResp({ok:true, meta, html}, 200);
}



// ==============================
// Posts Admin: delete / update title
// ==============================
async function _recomputeLatest(env, scope){
  if(!env || !env.JLAB_KV) return false;
  let latest = null;

  async function pull(prefix){
    try{
      const listed = await env.JLAB_KV.list({prefix, limit: 50});
      for(const k of (listed.keys||[])){
        const v = await env.JLAB_KV.get(k.name);
        if(!v) continue;
        let m=null;
        try{ m = JSON.parse(v); }catch(e){ m=null; }
        if(!m || !m.id) continue;
        if(!latest || String(m.created_ts||'').localeCompare(String(latest.created_ts||'')) > 0){
          latest = m;
        }
      }
    }catch(e){}
  }

  if(scope === 'perf'){
    await pull('posts/meta/perf/KR/');
    await pull('posts/meta/perf/US/');
    if(latest) await env.JLAB_KV.put('posts/latest/perf.json', JSON.stringify(latest));
    else await env.JLAB_KV.delete('posts/latest/perf.json');
    return true;
  }
  if(scope === 'meme'){
    await pull('posts/meta/meme/KR/');
    await pull('posts/meta/meme/US/');
    if(latest) await env.JLAB_KV.put('posts/latest/meme.json', JSON.stringify(latest));
    else await env.JLAB_KV.delete('posts/latest/meme.json');
    return true;
  }

  // bigdata (strong/accum/suspicious)
  const cats = ['strong','accum','suspicious'];
  for(const c of cats){
    await pull(`posts/meta/${c}/KR/`);
    await pull(`posts/meta/${c}/US/`);
  }
  if(latest) await env.JLAB_KV.put('posts/latest/bigdata.json', JSON.stringify(latest));
  else await env.JLAB_KV.delete('posts/latest/bigdata.json');
  return true;
}

async function handlePostsDelete(request, env, baseUrl){
  const admin = await requireAdmin(request, env, baseUrl);
  if(!admin) return jsonResp({ok:false, error:'FORBIDDEN'}, 403);
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING'}, 200);

  const body = await request.json().catch(()=> ({}));
  const id = String(body.id||'').trim();
  if(!id) return jsonResp({ok:false, error:'NO_ID'}, 200);

  const metaStr = await env.JLAB_KV.get(`posts/id/${id}.json`);
  if(!metaStr) return jsonResp({ok:false, error:'NOT_FOUND'}, 200);

  let meta=null;
  try{ meta = JSON.parse(metaStr); }catch(e){ meta=null; }
  if(!meta) return jsonResp({ok:false, error:'BAD_META'}, 200);

  const category = String(meta.category||'').trim();
  const region = String(meta.region||'').trim().toUpperCase();
  const ts = String(meta.created_ts||'').trim();

  const metaKey = (category && region && ts) ? `posts/meta/${category}/${region}/${ts}_${id}.json` : null;
  const idKey = `posts/id/${id}.json`;
  const htmlKey = `posts/html/${id}.html`;

  try{
    if(metaKey) await env.JLAB_KV.delete(metaKey);
    await env.JLAB_KV.delete(idKey);
    await env.JLAB_KV.delete(htmlKey);
  }catch(e){
    return jsonResp({ok:false, error:'DELETE_FAIL'}, 200);
  }

  // latest pointers: if the deleted post was the latest, recompute
  try{
    const scope = (category === 'perf') ? 'perf' : (category === 'meme') ? 'meme' : 'bigdata';
    const latestKey = (scope === 'perf') ? 'posts/latest/perf.json' : (scope === 'meme') ? 'posts/latest/meme.json' : 'posts/latest/bigdata.json';
    const lv = await env.JLAB_KV.get(latestKey);
    if(lv){
      let lm=null;
      try{ lm = JSON.parse(lv); }catch(e){ lm=null; }
      if(lm && lm.id === id){
        await _recomputeLatest(env, scope);
      }
    }
  }catch(e){}

  return jsonResp({ok:true, id}, 200);
}

async function handlePostsUpdateTitle(request, env, baseUrl){
  const admin = await requireAdmin(request, env, baseUrl);
  if(!admin) return jsonResp({ok:false, error:'FORBIDDEN'}, 403);
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING'}, 200);

  const body = await request.json().catch(()=> ({}));
  const id = String(body.id||'').trim();
  const title = String(body.title||'').trim();
  if(!id) return jsonResp({ok:false, error:'NO_ID'}, 200);
  if(!title) return jsonResp({ok:false, error:'NO_TITLE'}, 200);

  const metaStr = await env.JLAB_KV.get(`posts/id/${id}.json`);
  if(!metaStr) return jsonResp({ok:false, error:'NOT_FOUND'}, 200);

  let meta=null;
  try{ meta = JSON.parse(metaStr); }catch(e){ meta=null; }
  if(!meta) return jsonResp({ok:false, error:'BAD_META'}, 200);

  meta.title = title;
  meta.updated_at = new Date().toISOString();
  meta.updated_by = admin.email || admin.user_id || 'admin';

  const category = String(meta.category||'').trim();
  const region = String(meta.region||'').trim().toUpperCase();
  const ts = String(meta.created_ts||'').trim();
  const metaKey = (category && region && ts) ? `posts/meta/${category}/${region}/${ts}_${id}.json` : null;

  try{
    await env.JLAB_KV.put(`posts/id/${id}.json`, JSON.stringify(meta));
    if(metaKey) await env.JLAB_KV.put(metaKey, JSON.stringify(meta));
  }catch(e){
    return jsonResp({ok:false, error:'UPDATE_FAIL'}, 200);
  }

  // update latest pointer if this post is current latest in its scope
  try{
    const scope = (category === 'perf') ? 'perf' : (category === 'meme') ? 'meme' : 'bigdata';
    const latestKey = (scope === 'perf') ? 'posts/latest/perf.json' : (scope === 'meme') ? 'posts/latest/meme.json' : 'posts/latest/bigdata.json';
    const lv = await env.JLAB_KV.get(latestKey);
    if(lv){
      let lm=null;
      try{ lm = JSON.parse(lv); }catch(e){ lm=null; }
      if(lm && lm.id === id){
        await env.JLAB_KV.put(latestKey, JSON.stringify(meta));
      }
    }
  }catch(e){}

  return jsonResp({ok:true, id, meta}, 200);
}

// ==============================
// Signup request (store minimal)
// ==============================
async function handleSignupRequest(request, env){
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING'}, 200);
  const body = await request.json().catch(()=> ({}));
  const email = String(body.email||'').trim();
  const name = String(body.name||'').trim();
  const phone = String(body.phone||'').trim();
  const memo = String(body.memo||'').trim();
  if(!email || !name || !phone) return jsonResp({ok:false, error:'MISSING_FIELDS'}, 200);

  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
  const ts = compactTs(new Date());
  const created_at = new Date().toISOString();
  const rec = { id, email, name, phone, memo, created_at, created_ts: ts };

  await env.JLAB_KV.put(`signup/requests/${ts}_${id}.json`, JSON.stringify(rec));
  return jsonResp({ok:true}, 200);
}



// ==============================
// RSS proxy (Infomax) - JSON output
// - 목적: 브라우저에서 RSS 직접 호출 시 CORS 차단을 회피하기 위해 /api/rss 제공
// - 허용: https://news.einfomax.co.kr/rss/*
// ==============================
function stripCdata(s){
  if(!s) return '';
  return String(s).replace(/<!\[CDATA\[/g,'').replace(/\]\]>/g,'').trim();
}
function extractTag(block, tag){
  const re = new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, 'i');
  const m = String(block||'').match(re);
  return m ? stripCdata(m[1]) : '';
}
function parseRssItems(xml, limit){
  const out = [];
  const s = String(xml||'');
  const reItem = /<item>[\s\S]*?<\/item>/gi;
  let m;
  while((m = reItem.exec(s)) !== null){
    const it = m[0];
    const title = extractTag(it, 'title');
    const link  = extractTag(it, 'link');
    const desc  = extractTag(it, 'description');
    const pub   = extractTag(it, 'pubDate');
    if(title || link){
      out.push({'title': title, 'link': link, 'description': desc, 'pubDate': pub});
    }
    if(out.length >= limit) break;
  }
  return out;
}
async function handleRssProxy(request){
  const u = new URL(request.url);
  const feed = (u.searchParams.get('u')||'').trim();
  let limit = parseInt(u.searchParams.get('limit')||'10', 10);
  if(!limit || limit < 1) limit = 10;
  if(limit > 50) limit = 50;
  if(!feed) return jsonResp({ok:false, error:'MISSING_URL'}, 200, {'access-control-allow-origin':'*'});

  let feedUrl = feed;
  try{
    const fu = new URL(feedUrl);
    const okHost = (fu.hostname === 'news.einfomax.co.kr');
    const okPath = fu.pathname && fu.pathname.startsWith('/rss/');
    if(!okHost || !okPath) throw new Error('DENY');
  }catch(e){
    return jsonResp({ok:false, error:'DENY'}, 200, {'access-control-allow-origin':'*'});
  }

  const cache = caches.default;
  const cacheKey = new Request(u.origin + '/api/rss?u=' + encodeURIComponent(feedUrl) + '&limit=' + String(limit), {method:'GET'});
  const cached = await cache.match(cacheKey);
  if(cached) return cached;

  try{
    const xml = await fetchText(feedUrl);
    const items = parseRssItems(xml, limit);
    const body = JSON.stringify({ok:true, updated_at:new Date().toISOString(), source: feedUrl, items});
    const res = new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=600',
        'access-control-allow-origin': '*'
      }
    });
    await cache.put(cacheKey, res.clone());
    return res;
  }catch(e){
    return jsonResp({ok:false, error:String(e && e.message ? e.message : e)}, 200, {'access-control-allow-origin':'*'});
  }
}
// ==============================
// YouTube RSS (latest 1)
// ==============================
async function handleYouTubeLatest(){
  const channelId = 'UC85ROrNcbOFDOeC5b0RaQMQ';
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  try{
    const xml = await fetchText(url);
    const entry = xml.match(/<entry>[\s\S]*?<\/entry>/i);
    if(!entry) return jsonResp({ok:false, error:'EMPTY'}, 200);
    const e = entry[0];
    const titleM = e.match(/<title>([\s\S]*?)<\/title>/i);
    const linkM = e.match(/<link[^>]*href="([^"]+)"/i);
    const vidM = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i);
    const pubM = e.match(/<published>([^<]+)<\/published>/i);

    const videoId = vidM ? vidM[1].trim() : '';
    const thumb = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
    return jsonResp({
      ok:true,
      title: titleM ? titleM[1].trim() : '',
      url: linkM ? linkM[1].trim() : '',
      video_id: videoId,
      thumb,
      published_at: pubM ? pubM[1].trim() : ''
    }, 200);
  }catch(e){
    return jsonResp({ok:false, error:String(e && e.message ? e.message : e)}, 200);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ==============================
    // RSS Proxy (Public)
    // ==============================
    if (url.pathname === '/api/rss') {
      return await handleRssProxy(request);
    }

    // ==============================
    // Auth API
    // ==============================
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return await handleAuthLogin(request, env, url.origin);
    }
    if (url.pathname === '/api/auth/signup_or_login' && request.method === 'POST') {
      return await handleAuthSignupOrLogin(request, env, url.origin);
    }
    if (url.pathname === '/api/auth/me') {
      return await handleAuthMe(request, env, url.origin);
    }
    if (url.pathname === '/api/auth/logout') {
      return await handleAuthLogout(request, env, url.origin);
    }
    if (url.pathname === '/api/auth/change_password' && request.method === 'POST') {
      return await handleAuthChangePassword(request, env, url.origin);
    }

    // ==============================
        // ==============================
    // Payments (Toss)
    // ==============================
    if (url.pathname === '/api/payments/toss/config') {
      return await handleTossConfig(request, env, url.origin);
    }
    if (url.pathname === '/api/orders/create' && request.method === 'POST') {
      return await handleOrdersCreate(request, env, url.origin);
    }
    if (url.pathname === '/api/payments/toss/confirm' && request.method === 'POST') {
      return await handleTossConfirm(request, env, url.origin);
    }

// Subscription API
    // ==============================
    if (url.pathname === '/api/subscription/me') {
      return await handleSubscriptionMe(request, env, url.origin);
    }
    if (url.pathname === '/api/subscription/admin/set' && request.method === 'POST') {
      return await handleSubscriptionAdminSet(request, env, url.origin);
    }
    if (url.pathname === '/api/subscription/cancel' && request.method === 'POST') {
      return await handleSubscriptionCancel(request, env, url.origin);
    }

    // ==============================
    // Notice / Popup (Public read)
    // ==============================
    if (url.pathname === '/api/notice/latest') {
      return await handleNoticeLatest(request, env, url.origin);
    }
    if (url.pathname === '/api/popup/config') {
      return await handlePopupConfig(request, env, url.origin);
    }

    // ==============================
    // Admin Save
    // ==============================
    if (url.pathname === '/api/admin/notice/save' && request.method === 'POST') {
      return await handleAdminNoticeSave(request, env, url.origin);
    }
    if (url.pathname === '/api/admin/popup/save' && request.method === 'POST') {
      return await handleAdminPopupSave(request, env, url.origin);
    }


    // ==============================
    // Admin Users (Create/Reset/List Signup)
    // ==============================
    if (url.pathname === '/api/admin/users/create' && request.method === 'POST') {
      return await handleAdminUsersCreate(request, env, url.origin);
    }
    if (url.pathname === '/api/admin/users/reset_password' && request.method === 'POST') {
      return await handleAdminUsersResetPassword(request, env, url.origin);
    }
    if (url.pathname === '/api/admin/users/get') {
      return await handleAdminUsersGet(request, env, url.origin);
    }
    if (url.pathname === '/api/admin/signup/requests') {
      return await handleAdminSignupRequests(request, env, url.origin);
    }


    // ==============================
    // Posts API (Bigdata / Performance)
    // ==============================
    if (url.pathname === '/api/posts/create' && request.method === 'POST') {
      return await handlePostsCreate(request, env, url.origin);
    }
    if (url.pathname === '/api/posts/delete' && request.method === 'POST') {
      return await handlePostsDelete(request, env, url.origin);
    }
    if (url.pathname === '/api/posts/update_title' && request.method === 'POST') {
      return await handlePostsUpdateTitle(request, env, url.origin);
    }
    if (url.pathname === '/api/posts/list') {
      return await handlePostsList(request, env);
    }
    if (url.pathname === '/api/posts/get') {
      return await handlePostsGet(request, env);
    }
    if (url.pathname === '/api/posts/latest') {
      return await handlePostsLatest(request, env);
    }

    // ==============================
    // Signup Request (Public)
    // ==============================
    if (url.pathname === '/api/signup/request' && request.method === 'POST') {
      return await handleSignupRequest(request, env);
    }

    // ==============================
    // YouTube (Latest)
    // ==============================
    if (url.pathname === '/api/youtube/latest') {
      return await handleYouTubeLatest();
    }

    // ==============================
    // Market API (Home)
    // ==============================
    if (url.pathname === '/api/market') {
      try {
        return await handleMarket();
      } catch (e) {
        const body = JSON.stringify({
          ok: false,
          updated_at: new Date().toISOString(),
          error: String(e && e.message ? e.message : e),
          items: {}
        });
        return new Response(body, {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }
    }

    // ==============================
    // Login required gate (except public paths)
    // ==============================
    if (!isPublicPath(url.pathname)) {
      const payload = await requireAuth(request, env, url.origin);
      if (!payload) {
        // assets/api는 위에서 처리됨. 나머지는 account로 이동.
        const next = url.pathname + (url.search || '');
        const isBigdata = (url.pathname === '/data' || url.pathname.startsWith('/data/')
          || url.pathname === '/strong' || url.pathname.startsWith('/strong/')
          || url.pathname === '/accum' || url.pathname.startsWith('/accum/')
          || url.pathname === '/suspicious' || url.pathname.startsWith('/suspicious/'));
        if (isBigdata) {
          const to = new URL('/bigdata_gate/', url.origin);
          to.searchParams.set('next', next);
          return Response.redirect(to.toString(), 302);
        }
        const to = new URL('/login/', url.origin);
        to.searchParams.set('next', next);
        return Response.redirect(to.toString(), 302);
      }

      // 운영(/ops) 페이지는 관리자만 접근 허용
      const isOps = (url.pathname === "/ops" || url.pathname.startsWith("/ops/"));
      if (isOps && (payload.role || "user") !== "admin") {
        return Response.redirect(new URL("/account/", url.origin).toString(), 302);
      }


      // 구독(만료형) 게이트: 빅데이터 영역은 로그인 + 유효 구독이 필요합니다.
      const isBigdata = (url.pathname === '/data' || url.pathname.startsWith('/data/')
        || url.pathname === '/strong' || url.pathname.startsWith('/strong/')
        || url.pathname === '/accum' || url.pathname.startsWith('/accum/')
        || url.pathname === '/suspicious' || url.pathname.startsWith('/suspicious/'));

      if (isBigdata && (payload.role || 'user') !== 'admin') {
        const email = String(payload.email||'').trim().toLowerCase();
        const sub = await getSubscription(env, email);
        const view = computeSubscriptionView(sub);
        if (!view.access_active) {
          const next = url.pathname + (url.search || '');
          const to = new URL('/bigdata_gate/', url.origin);
          to.searchParams.set('next', next);
          return Response.redirect(to.toString(), 302);
        }
      }

    }

    // Static assets passthrough
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  }
};
