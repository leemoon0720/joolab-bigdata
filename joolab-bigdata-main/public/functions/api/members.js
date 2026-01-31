export async function onRequest(context) {
  const { DB } = context.env;

  const { results } = await DB
    .prepare("SELECT member_name, pay_day, next_pay_date FROM members ORDER BY member_name")
    .all();

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" }
  });
}