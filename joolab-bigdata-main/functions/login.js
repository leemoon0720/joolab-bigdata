export async function onRequestPost(context) {
  const { DB } = context.env;
  const { id, pw } = await context.request.json();

  const { results } = await DB
    .prepare("SELECT member_name FROM members WHERE user_id = ? AND user_pw = ?")
    .bind(id, pw)
    .all();

  if (results.length === 1) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "admin=1; Path=/; Max-Age=604800; SameSite=Lax"
      }
    });
  }
  return new Response(JSON.stringify({ ok: false }), { status: 401 });
}