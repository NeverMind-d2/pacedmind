/** Public proof of domain ownership for the OpenAI submission portal; never an access credential. */
export function GET() {
  const token = process.env.ORGANIZER_OPENAI_APPS_CHALLENGE;
  if (process.env.ORGANIZER_MODE !== "web" || !token || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(token, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
