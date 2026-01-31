export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  const db = env.DB;

  async function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    // 진단: 테이블/카운트/샘플
    if (path === "/api/diag") {
      const t = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all();
      const membersCnt = await db.prepare("SELECT COUNT(*) AS cnt FROM members;").first();
      const usersCnt = await db.prepare("SELECT COUNT(*) AS cnt FROM users;").first();
      const membersSample = await db.prepare("SELECT * FROM members ORDER BY next_pay_date DESC LIMIT 3;").all();

      return json({
        ok: true,
        tables: (t.results || []).map(r => r.name),
        counts: { members: membersCnt?.cnt ?? null, users: usersCnt?.cnt ?? null },
        members_sample: membersSample.results || []
      });
    }

    // members 목록 (next_pay_date DESC 고정)
    if (path === "/api/members/list") {
      const { results } = await db
        .prepare("SELECT * FROM members ORDER BY next_pay_date DESC")
        .all();

      return json({ ok: true, items: results || [] });
    }

    // users 목록
    if (path === "/api/users/list") {
      const { results } = await db
        .prepare("SELECT * FROM users ORDER BY id DESC")
        .all();

      return json({ ok: true, items: results || [] });
    }

    return json({ ok: false, error: "NOT_FOUND", message: "NOT_FOUND" }, 404);
  } catch (e) {
    return json(
      {
        ok: false,
        error: "EXCEPTION",
        message: String(e?.message || e),
      },
      500
    );
  }
}
