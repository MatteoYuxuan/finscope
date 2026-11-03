import { handleRoute, ok, readJson } from "@/lib/api/response";
import { loadPortfolioPayload, savePortfolioPayload } from "@/lib/portfolio/service";
import { portfolioPayloadSchema } from "@/lib/validation/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => ok(await loadPortfolioPayload(), { mode: "mock" }));
}

export async function PUT(request: Request) {
  return handleRoute(async () => {
    const body = portfolioPayloadSchema.parse(await readJson(request));
    const saved = await savePortfolioPayload(body);
    return ok(saved, { mode: "mock" });
  });
}
