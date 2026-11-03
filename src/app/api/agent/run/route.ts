import { z } from "zod";
import { handleRoute, ok, readJson } from "@/lib/api/response";
import { saveAgentRun } from "@/lib/agent/service";
import { loadNews, loadPortfolioPayload, toAnalysisRequest } from "@/lib/portfolio/service";
import { quantFetch } from "@/lib/quant/client";
import type { AgentRunResult } from "@/lib/types/investment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  task: z.string().trim().min(1).max(2000).default("请分析我的资产配置并给出再平衡建议"),
  useLlm: z.boolean().default(true),
  includeReport: z.boolean().default(true),
  history: z
    .array(z.object({ role: z.string(), content: z.string().max(2000) }))
    .max(12)
    .default([]),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const input = inputSchema.parse(await readJson(request));
    const payload = await loadPortfolioPayload();
    const news = await loadNews();
    const portfolio = toAnalysisRequest(payload, news);

    const result = await quantFetch<AgentRunResult>(
      "/agent/run",
      {
        method: "POST",
        body: JSON.stringify({
          task: input.task,
          portfolio,
          use_llm: input.useLlm,
          include_report: input.includeReport,
          history: input.history,
        }),
      },
      420_000,
    );

    await saveAgentRun(result);
    return ok(result, { mode: result.mode === "llm" ? "llm" : "fallback" });
  });
}
