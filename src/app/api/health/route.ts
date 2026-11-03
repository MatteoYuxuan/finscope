import { prisma } from "@/lib/db";
import { handleRoute, ok } from "@/lib/api/response";
import { describeRuntimeLlm } from "@/lib/llm/config-store";
import { getLLMMode } from "@/lib/services/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return handleRoute(async () => {
    const started = Date.now();
    const [sources, articles, events, assets, liabilities, reports] = await Promise.all([
      prisma.source.count(),
      prisma.article.count(),
      prisma.event.count(),
      prisma.asset.count(),
      prisma.liability.count(),
      prisma.report.count(),
    ]);
    const mode = await getLLMMode();
    const llm = await describeRuntimeLlm();

    return ok(
      {
        status: "ok",
        service: "知衡 FinScope",
        llmConfigured: llm.configured,
        llmSource: llm.source,
        llmModel: llm.model,
        counts: { sources, articles, events, assets, liabilities, reports },
        latencyMs: Date.now() - started,
        time: new Date().toISOString(),
      },
      { mode },
    );
  });
}
