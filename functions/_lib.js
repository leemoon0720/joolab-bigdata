const encoder = new TextEncoder();

export function json(data, status=200, headers={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

export function err(message, status=400, errorCode="ERROR") {
  return json({ ok:false, error: errorCode, message }, status);
}

export async function readJson(request) {
  const txt = await request.text();
  if (!txt) return {};
  try { return JSON.parse(txt); } catch { throw new Error("INVALID_JSON"); }
}

export function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)"+name+"=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(str));
  return toHex(buf);
}

export function nowIso() {
  return new Date().toISOString().slice(0,19); // YYYY-MM-DDTHH:MM:SS
}

export function addDays(dateStr, days) {
  // dateStr: YYYY-MM-DD or ISO, return YYYY-MM-DD
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr+"T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

export function todayYmd() {
  return new Date().toISOString().slice(0,10);
}

export async function makeSalt() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}

export async function hashPasswordVariants(password, salt) {
  // Return a set of possible legacy hashes (for compatibility)
  const a = await sha256Hex(`${salt}:${password}`);
  const b = await sha256Hex(`${password}:${salt}`);
  const c = await sha256Hex(`${salt}${password}`);
  const d = await sha256Hex(`${password}${salt}`);
  return new Set([a,b,c,d]);
}

export async function makePassHash(password, salt) {
  // canonical: sha256(salt:password)
  return await sha256Hex(`${salt}:${password}`);
}

export async function ensureAdmin(env) {
  const adminUser = (env.ADMIN_USER || "admin").trim();
  const adminPass = (env.ADMIN_PASS || "admin");
  const row = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(adminUser).first();
  if (row && row.id) return;
  const salt = await makeSalt();
  const pass_hash = await makePassHash(adminPass, salt);
  const created_at = nowIso();
  await env.DB.prepare(
    "INSERT INTO users (username, pass_hash, salt, name, payer_name, role, blocked, created_at) VALUES (?,?,?,?,?,'admin',0,?)"
  ).bind(adminUser, pass_hash, salt, "관리자", "관리자", created_at).run();
}

export async function getSessionUser(env, request) {
  const sid = getCookie(request, "sid");
  if (!sid) return null;
  const now = nowIso();
  const row = await env.DB.prepare(
    `SELECT s.id as sid, s.expires_at, u.id as user_id, u.username, u.name, u.payer_name, u.role, u.blocked
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.id=? LIMIT 1`
  ).bind(sid).first();
  if (!row) return null;
  if (row.expires_at && row.expires_at < now) {
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run();
    return null;
  }
  return {
    sid: row.sid,
    user: {
      id: row.user_id,
      username: row.username,
      name: row.name,
      payer_name: row.payer_name,
      role: row.role,
      blocked: !!row.blocked
    }
  };
}

export async function requireUser(env, request) {
  const s = await getSessionUser(env, request);
  if (!s) throw new Error("AUTH_REQUIRED");
  return s;
}

export async function requireAdmin(env, request) {
  const s = await requireUser(env, request);
  if ((s.user.role || "") !== "admin") throw new Error("ADMIN_ONLY");
  return s;
}

export async function computeAccess(env, userId, userRole, userBlocked) {
  if (userRole === "admin") {
    return { access_status: "ADMIN", allowed: true, last_paid_at: null, active_until: null, grace_until: null };
  }
  if (userBlocked) {
    return { access_status: "BLOCKED", allowed: false, last_paid_at: null, active_until: null, grace_until: null };
  }
  // latest CONFIRMED payment
  const row = await env.DB.prepare(
    "SELECT paid_at FROM payments WHERE user_id=? AND status='CONFIRMED' ORDER BY paid_at DESC LIMIT 1"
  ).bind(userId).first();
  const last = row?.paid_at || null;
  if (!last) {
    return { access_status: "BLOCKED", allowed: false, last_paid_at: null, active_until: null, grace_until: null };
  }
  const active_until = addDays(last, 30);
  const grace_until = addDays(active_until, 7);
  const today = todayYmd();
  if (today <= active_until) return { access_status: "ACTIVE", allowed: true, last_paid_at: last, active_until, grace_until };
  if (today <= grace_until) return { access_status: "GRACE", allowed: true, last_paid_at: last, active_until, grace_until };
  return { access_status: "BLOCKED", allowed: false, last_paid_at: last, active_until, grace_until };
}

export function cookieHeadersSet(sid, maxAgeDays=35) {
  const maxAge = maxAgeDays * 24 * 60 * 60;
  // Secure is required on https; Pages uses https.
  const v = `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
  return { "Set-Cookie": v };
}

export function cookieHeadersClear() {
  const v = `sid=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
  return { "Set-Cookie": v };
}