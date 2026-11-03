import { handleRoute, ok } from "@/lib/api/response";
import { quantFetch } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    const data = await quantFetch<Record<string, unknown>>("/reports", {}, 30_000);
    return ok(data, { mode: "llm" });
  });
}
