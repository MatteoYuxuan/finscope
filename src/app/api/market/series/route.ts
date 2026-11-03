import { handleRoute, ok } from "@/lib/api/response";
import { quantFetch } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const params = new URL(request.url).searchParams;
    const codes = params.get("codes") ?? "510300,510500,511010,518880,513100";
    const start = params.get("start") ?? "2020-01-01";
    const normalize = params.get("normalize") ?? "1";
    const data = await quantFetch<Record<string, unknown>>(
      `/market/series?codes=${encodeURIComponent(codes)}&start=${encodeURIComponent(start)}&normalize=${normalize}`,
      {},
      120_000,
    );
    return ok(data, { mode: "llm" });
  });
}
