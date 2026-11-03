import { z } from "zod";
import { handleRoute, ok, readJson } from "@/lib/api/response";
import { loadNews, loadPortfolioPayload, toAnalysisRequest } from "@/lib/portfolio/service";
import { quantFetch } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  imageBase64: z.string().min(20).max(12_000_000),
  mime: z.string().max(40).default("image/png"),
  prompt: z.string().max(1000).default("请识别图片中的持仓/行情/财务信息，并说明它对我的资产配置有什么影响。"),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const input = inputSchema.parse(await readJson(request));
    const payload = await loadPortfolioPayload();
    const news = await loadNews(4);
    const portfolio = toAnalysisRequest(payload, news);
    const data = await quantFetch<Record<string, unknown>>(
      "/vision/analyze",
      {
        method: "POST",
        body: JSON.stringify({
          image_base64: input.imageBase64,
          mime: input.mime,
          prompt: input.prompt,
          portfolio,
        }),
      },
      180_000,
    );
    return ok(data, { mode: "llm" });
  });
}
