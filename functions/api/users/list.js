export async function onRequest({ env }) {
  const db = env.DB;

  const { results } = await db
    .prepare("SELECT * FROM users ORDER BY id DESC")
    .all();

  return new Response(JSON.stringify({ ok: true, items: results || [] }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
