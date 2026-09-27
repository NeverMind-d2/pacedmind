import { llmsFullTxt } from "@/lib/llms";

// Written to out/llms-full.txt at build time.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsFullTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
