import { handleRoute, ok } from "@/lib/api/response";
import { getLatestAnalysis } from "@/lib/portfolio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => ok(await getLatestAnalysis(), { mode: "llm" }));
}
