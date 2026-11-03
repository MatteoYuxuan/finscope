import { handleRoute, ok } from "@/lib/api/response";
import { quantFetch } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return handleRoute(async () => {
    const data = await quantFetch<Record<string, unknown>>("/data/refresh", { method: "POST" }, 300_000);
    return ok(data, { mode: "llm" });
  });
}
