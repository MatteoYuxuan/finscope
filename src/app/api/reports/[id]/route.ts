import { handleRoute } from "@/lib/api/response";
import { QUANT_BASE_URL } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleRoute(async () => {
    const response = await fetch(`${QUANT_BASE_URL}/report/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return new Response("报告不存在或已过期", { status: response.status });
    }
    return new Response(await response.text(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
}
