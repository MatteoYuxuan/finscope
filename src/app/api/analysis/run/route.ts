import { handleRoute, ok } from "@/lib/api/response";
import {
  loadNews,
  loadPortfolioPayload,
  saveAnalysisRecord,
  toAnalysisRequest,
} from "@/lib/portfolio/service";
import { quantFetch } from "@/lib/quant/client";
import type { AnalysisResult } from "@/lib/types/investment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return handleRoute(async () => {
    const payload = await loadPortfolioPayload();
    const news = await loadNews();
    const requestBody = toAnalysisRequest(payload, news);
    const result = await quantFetch<AnalysisResult>(
      "/analyze",
      { method: "POST", body: JSON.stringify(requestBody) },
      300_000,
    );
    await saveAnalysisRecord(requestBody, result, result.summary ?? "");
    return ok(result, { mode: "llm" });
  });
}
