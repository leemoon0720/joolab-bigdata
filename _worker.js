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
// - 커뮤니티 회원 엑셀(assets/members_seed.json) 기반으로 로그인 허용
// - 관리자(admin)만 공지/팝업 저장 가능
// - 저장소: Cloudflare KV (권장: env.JLAB_KV). 없으면 읽기만(정적 JSON)로 폴백.
// ==============================

const COOKIE_NAME = 'jlab_sess';
const DEFAULT_SECRET = 'JLAB_CHANGE_ME_SECRET';

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

let SEED_CACHE = null;

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

async function loadSeed(env, baseUrl) {
  if (SEED_CACHE) return SEED_CACHE;
  const seed = await fetchStaticJSON(env, baseUrl, '/assets/members_seed.json');
  const users = seed && Array.isArray(seed.users) ? seed.users : [];
  const map = {};
  for (const u of users) {
    if (!u || !u.email) continue;
    map[String(u.email).toLowerCase()] = u;
  }
  SEED_CACHE = { updated_at: seed ? seed.updated_at : null, users_map: map };
  return SEED_CACHE;
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

async function getUser(env, baseUrl, emailLower) {
  const kvKey = `user:${emailLower}`;
  const kvUser = await kvGetJSON(env, kvKey);
  if (kvUser) return { source: 'kv', user: kvUser };
  const seed = await loadSeed(env, baseUrl);
  const u = seed.users_map[emailLower] || null;
  if (u) return { source: 'seed', user: u };
  return null;
}

async function ensureUserInKV(env, emailLower, seedUser, passwordPlain, secret) {
  if (!(env && env.JLAB_KV && typeof env.JLAB_KV.put === 'function')) return false;
  const kvKey = `user:${emailLower}`;
  const passHash = await sha256Hex(`${secret}|${passwordPlain}`);
  const obj = {
    email: emailLower,
    user_id: seedUser.user_id || '',
    name: seedUser.name || '',
    nickname: seedUser.nickname || '',
    role: seedUser.role || 'user',
    pass_hash: passHash,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await env.JLAB_KV.put(kvKey, JSON.stringify(obj));
  return true;
}

function isPublicPath(pathname) {
  // 공개 허용(로그인 없이 접근)
  if (pathname === '/') return true;
  if (pathname === '/account/' || pathname === '/account') return true;
  if (pathname === '/login/' || pathname === '/login') return true;
  if (pathname === '/signup/' || pathname === '/signup') return true;
  if (pathname === '/about.html') return true;
  if (pathname === '/contact.html') return true;
  if (pathname.startsWith('/notice/')) return true;
  if (pathname.startsWith('/news/')) return true;
  if (pathname.startsWith('/game/')) return true;
  if (pathname.startsWith('/meme/')) return true;
  if (pathname.startsWith('/help/')) return true;
  if (pathname.startsWith('/docs/')) return true;
  if (pathname.startsWith('/life/')) return true;
  if (pathname.startsWith('/tools/')) return true;
  if (pathname.startsWith('/mini/')) return true;
  if (pathname.startsWith('/assets/')) return true;
  if (pathname.startsWith('/api/')) return true;
  if (pathname.startsWith('/pay/')) return true;
  if (pathname === '/subscribe/' || pathname === '/subscribe') return true;
  if (pathname === '/terms/' || pathname === '/terms') return true;
  if (pathname === '/privacy/' || pathname === '/privacy') return true;
  if (pathname === '/refund/' || pathname === '/refund') return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/ads.txt') return true;
  if (pathname === '/robots.txt') return true;
  if (pathname === '/sitemap.xml') return true;
  return false;
}

function isBigdataPath(pathname){
  if(!pathname) return false;
  return pathname === '/data' || pathname === '/data/' || pathname.startsWith('/data/') ||
         pathname === '/strong' || pathname === '/strong/' || pathname.startsWith('/strong/') ||
         pathname === '/accum' || pathname === '/accum/' || pathname.startsWith('/accum/') ||
         pathname === '/suspicious' || pathname === '/suspicious/' || pathname.startsWith('/suspicious/');
}

function isBigdataCategory(cat){
  return cat === 'strong' || cat === 'accum' || cat === 'suspicious';
}

function membershipGateHtml(baseUrl){
  const u = (baseUrl || '').replace(/\/$/,'');
  return `<!doctype html>
  <html lang="ko"><head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>구독 멤버십 전용 | 주랩</title>
    <link rel="stylesheet" href="/assets/app.css"/>
  </head><body>
  <div class="topbar"><div class="container topbar-inner">
    <a class="brand" href="/"><div class="brand-badge">JL</div><div><div class="brand-title">주랩 빅데이터 센터</div><div class="brand-sub">데이터 · 성과 · 뉴스</div></div></a>
    <nav class="nav">
      <a href="/notice/">공지</a>
      <a href="/news/">뉴스센터</a>
      <a href="/sample/">샘플자료실</a>
      <a href="/performance/">성과표</a>
      <a href="/subscribe/">구독</a>
    </nav>
  </div></div>
  <main class="main"><div class="container">
    <section class="hero hero-compact">
      <h1>구독 멤버십 전용 공간입니다.</h1>
      <p>비구독자(로그인 불가)는 빅데이터센터를 열람할 수 없습니다. 샘플은 홈/샘플자료실에서 확인할 수 있습니다.</p>
      <div class="hero-row"><div class="hero-actions" style="display:flex;gap:10px;flex-wrap:wrap;">
        <a class="btn" href="/">홈으로</a>
        <a class="btn" href="/sample/">샘플자료실</a>
        <a class="btn primary" href="/subscribe/">구독 안내</a>
      </div></div>
    </section>
  </div></main>
  </body></html>`;
}

async function requireAuth(request, env, baseUrl) {
  const secret = (env && env.JLAB_AUTH_SECRET) ? env.JLAB_AUTH_SECRET : DEFAULT_SECRET;
  const cookies = parseCookies(request.headers.get('cookie') || '');
  const token = cookies[COOKIE_NAME] || '';
  const payload = await verifyToken(secret, token);
  if (!payload || !payload.email) return null;
  return payload;
}

async function handleAuthLogin(request, env, baseUrl) {
  const secret = (env && env.JLAB_AUTH_SECRET) ? env.JLAB_AUTH_SECRET : DEFAULT_SECRET;
  let body = null;
  try { body = await request.json(); } catch(e) {}
  const email = String(body && body.email ? body.email : '').trim().toLowerCase();
  const pass = String(body && body.password ? body.password : '').trim();
  if (!email || !email.includes('@') || !pass) return jsonResp({ ok:false, message:'이메일/비밀번호를 확인해 주십시오.' }, 200);

  const rec = await getUser(env, baseUrl, email);
  if (!rec || !rec.user) return jsonResp({ ok:false, message:'등록된 회원이 아닙니다.' }, 200);

  // KV에 비번이 있으면 KV 검증, 없으면 seed 방식(초기 비번=아이디)로 검증
  if (rec.source === 'kv' && rec.user.pass_hash) {
    const inHash = await sha256Hex(`${secret}|${pass}`);
    if (inHash !== rec.user.pass_hash) return jsonResp({ ok:false, message:'비밀번호가 올바르지 않습니다.' }, 200);
  } else {
    const seedUser = rec.user;
    const initPass = String(seedUser.user_id || '').trim();
    if (!initPass || pass !== initPass) return jsonResp({ ok:false, message:'초기 비밀번호는 "커뮤니티 아이디"입니다.' }, 200);
    // KV가 있으면 최초 로그인 시 KV 유저로 승격(비번 변경 가능)
    await ensureUserInKV(env, email, seedUser, pass, secret);
  }

  const role = rec.user.role || 'user';
  const now = Date.now();
  const exp = now + 1000*60*60*24*14; // 14일
  const token = await makeToken(secret, { email, role, iat: now, exp });
  const setCookie = makeCookie(COOKIE_NAME, token, 60*60*24*14, new URL(request.url).hostname);
  return jsonResp({ ok:true, user:{ email, role } }, 200, { 'set-cookie': setCookie });
}

async function handleAuthMe(request, env, baseUrl) {
  const payload = await requireAuth(request, env, baseUrl);
  if (!payload) return jsonResp({ ok:false }, 200);
  return jsonResp({ ok:true, user:{ email: payload.email, role: payload.role || 'user' } }, 200);
}

async function handleAuthLogout(request, env, baseUrl) {
  const setCookie = makeCookie(COOKIE_NAME, '', 0, new URL(request.url).hostname);
  return jsonResp({ ok:true }, 200, { 'set-cookie': setCookie });
}

async function handleAuthChangePassword(request, env, baseUrl) {
  const secret = (env && env.JLAB_AUTH_SECRET) ? env.JLAB_AUTH_SECRET : DEFAULT_SECRET;
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

  const allowed = ['strong','accum','suspicious','sample','perf','meme'];
  if(!allowed.includes(category)) return jsonResp({ok:false, error:'BAD_CATEGORY'}, 200);
  if(!['KR','US'].includes(region)) return jsonResp({ok:false, error:'BAD_REGION'}, 200);
  if(!title || html.length < 10) return jsonResp({ok:false, error:'BAD_PAYLOAD'}, 200);

  // sample은 독립 카테고리로 운영(별도 체크 없이도 샘플로 취급)
  const is_sample = (category === 'sample') ? true : Boolean(body.is_sample);

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
  if(category === 'sample'){
    await env.JLAB_KV.put('posts/latest/sample.json', JSON.stringify(meta));
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
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')||'30',10)||30, 1), 80);

  const sampleOnly = String(url.searchParams.get('sample')||'').trim() === '1';

  const allowed = ['strong','accum','suspicious','sample','perf','meme'];
  if(!allowed.includes(category)) return jsonResp({ok:false, error:'BAD_CATEGORY', items:[]}, 200);

  let items=[];
  if(region && region !== 'ALL'){
    const prefix = `posts/meta/${category}/${region}/`;
    items = await _listMetaByPrefix(env, prefix, limit);
  }else{
    const a = await _listMetaByPrefix(env, `posts/meta/${category}/KR/`, limit);
    const b = await _listMetaByPrefix(env, `posts/meta/${category}/US/`, limit);
    items = a.concat(b);
  }

  if(sampleOnly && category !== 'sample'){ items = (items||[]).filter(x=>!!(x && x.is_sample)); }

  items.sort((x,y)=> String(y.created_ts||'').localeCompare(String(x.created_ts||'')));
  items = items.slice(0, limit);

  const updated_at = items[0]?.created_at || new Date().toISOString();
  return jsonResp({ok:true, updated_at, count: items.length, items}, 200);
}

async function handlePostsLatest(request, env){
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING'}, 200);
  const url = new URL(request.url);
  const scope = String(url.searchParams.get('scope')||'bigdata').trim();
  const key = (scope === 'sample') ? 'posts/latest/sample.json' : (scope === 'perf') ? 'posts/latest/perf.json' : (scope === 'meme') ? 'posts/latest/meme.json' : 'posts/latest/bigdata.json';
  const v = await env.JLAB_KV.get(key);
  if(!v) return jsonResp({ok:false, error:'EMPTY'}, 200);
  try{
    return jsonResp({ok:true, meta: JSON.parse(v)}, 200);
  }catch(e){
    return jsonResp({ok:false, error:'BAD_JSON'}, 200);
  }
}

async function handlePostsGet(request, env, baseUrl){
  if(!env || !env.JLAB_KV) return jsonResp({ok:false, error:'KV_MISSING'}, 200);
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id')||'').trim();
  if(!id) return jsonResp({ok:false, error:'NO_ID'}, 200);

  const metaStr = await env.JLAB_KV.get(`posts/id/${id}.json`);
  const html = await env.JLAB_KV.get(`posts/html/${id}.html`);
  if(!metaStr || !html) return jsonResp({ok:false, error:'NOT_FOUND'}, 200);

  let meta=null;
  try{ meta = JSON.parse(metaStr); }catch(e){ meta=null; }

  // 비구독자(로그인 불가)는 멤버십 전용 글(빅데이터)을 열람할 수 없습니다.
  // 단, sample 카테고리 또는 과거 호환 is_sample=true 글은 공개 허용.
  const authed = await requireAuth(request, env, baseUrl);
  if(!authed && meta && isBigdataCategory(String(meta.category||'').trim()) && !meta.is_sample){
    return jsonResp({ok:false, error:'MEMBERSHIP_ONLY'}, 200);
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

  if(scope === 'sample'){
    await pull('posts/meta/sample/KR/');
    await pull('posts/meta/sample/US/');
    if(latest) await env.JLAB_KV.put('posts/latest/sample.json', JSON.stringify(latest));
    else await env.JLAB_KV.delete('posts/latest/sample.json');
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
    const realScope = (category === 'sample') ? 'sample' : scope;
    const latestKey = (realScope === 'sample') ? 'posts/latest/sample.json' : (realScope === 'perf') ? 'posts/latest/perf.json' : (realScope === 'meme') ? 'posts/latest/meme.json' : 'posts/latest/bigdata.json';
    const lv = await env.JLAB_KV.get(latestKey);
    if(lv){
      let lm=null;
      try{ lm = JSON.parse(lv); }catch(e){ lm=null; }
      if(lm && lm.id === id){
        await _recomputeLatest(env, realScope);
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
    const realScope = (category === 'sample') ? 'sample' : scope;
    const latestKey = (realScope === 'sample') ? 'posts/latest/sample.json' : (realScope === 'perf') ? 'posts/latest/perf.json' : (realScope === 'meme') ? 'posts/latest/meme.json' : 'posts/latest/bigdata.json';
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
      // 비구독자(로그인 불가)는 빅데이터 전체목록을 볼 수 없고,
      // 샘플(sample=1) 또는 sample 카테고리만 공개합니다.
      try{
        const u = new URL(request.url);
        const cat = String(u.searchParams.get('category')||'').trim();
        const sampleOnly = String(u.searchParams.get('sample')||'').trim() === '1';
        if(isBigdataCategory(cat) && !sampleOnly){
          const authed = await requireAuth(request, env, url.origin);
          if(!authed) return jsonResp({ok:false, error:'MEMBERSHIP_ONLY', items:[]}, 200);
        }
      }catch(e){}
      return await handlePostsList(request, env);
    }
    if (url.pathname === '/api/posts/get') {
      return await handlePostsGet(request, env, url.origin);
    }
    if (url.pathname === '/api/posts/latest') {
      // 빅데이터 최신 포인터는 멤버십 전용(샘플/성과/짤은 공개)
      try{
        const u = new URL(request.url);
        const scope = String(u.searchParams.get('scope')||'bigdata').trim();
        if(scope === 'bigdata'){
          const authed = await requireAuth(request, env, url.origin);
          if(!authed) return jsonResp({ok:false, error:'MEMBERSHIP_ONLY'}, 200);
        }
      }catch(e){}
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
    // Membership gate: Bigdata pages only
    // - 비구독자는 로그인 자체가 불가하므로, 빅데이터는 안내문 화면을 노출합니다.
    // - 나머지 페이지는 모두 공개(로그아웃 상태에서도 이동 가능)
    // ==============================
    if (request.method === 'GET' && isBigdataPath(url.pathname)) {
      const payload = await requireAuth(request, env, url.origin);
      if (!payload) {
        return new Response(membershipGateHtml(url.origin), {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }
    }

    // Static assets passthrough
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  }
};
