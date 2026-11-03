import { handleRoute, ok } from "@/lib/api/response";
import { listAgentRuns } from "@/lib/agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => ok(await listAgentRuns(30), { mode: "llm" }));
}
