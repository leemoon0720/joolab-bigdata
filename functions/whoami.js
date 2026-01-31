export async function onRequest(context) {
  const cookie = context.request.headers.get("Cookie") || "";
  const admin = cookie.includes("admin=1");
  return new Response(JSON.stringify({ admin }), {
    headers: { "Content-Type": "application/json" }
  });
}