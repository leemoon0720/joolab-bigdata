export async function onRequestPost() {
  return new Response("ok", {
    headers: {
      "Set-Cookie": "admin=; Path=/; Max-Age=0; SameSite=Lax"
    }
  });
}