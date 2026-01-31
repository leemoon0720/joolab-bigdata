export async function onRequest({ env }) {
  const db = env.DB;

  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
    .all();

  const membersCnt = await db.prepare("SELECT COUNT(*) AS cnt FROM members;").first();
  const usersCnt = await db.prepare("SELECT COUNT(*) AS cnt FROM users;").first();

  const membersSample = await db
    .prepare("SELECT * FROM members ORDER BY next_pay_date DESC LIMIT 3;")
    .all();

  return new Response(
    JSON.stringify({
      ok: true,
      tables: (tables.results || []).map(r => r.name),
      counts: { members: membersCnt?.cnt ?? null, users: usersCnt?.cnt ?? null },
      members_sample: membersSample.results || [],
    }),
    { headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
}
