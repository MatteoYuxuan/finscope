import { handleRoute } from "@/lib/api/response";
import { QUANT_BASE_URL } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleRoute(async () => {
    const response = await fetch(`${QUANT_BASE_URL}/report/${encodeURIComponent(id)}/pdf`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return new Response("PDF 尚未生成", { status: response.status });
    }
    return new Response(await response.arrayBuffer(), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${id}.pdf"`,
      },
    });
  });
}
