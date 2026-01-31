export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  const db = env.DB;

  // /api/members/list  — members 테이블은 id 컬럼이 없음
  if (path === "/api/members/list") {
    const { results } = await db
      .prepare("SELECT * FROM members ORDER BY member_name ASC")
      .all();

    return new Response(JSON.stringify({ ok: true, items: results }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // /api/users/list
  if (path === "/api/users/list") {
    const { results } = await db
      .prepare("SELECT * FROM users ORDER BY id DESC")
      .all();

    return new Response(JSON.stringify({ ok: true, items: results }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: false, error: "NOT_FOUND", message: "NOT_FOUND" }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}
