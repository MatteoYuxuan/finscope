import { AppError, handleRoute, ok } from "@/lib/api/response";
import { getAgentRun } from "@/lib/agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await context.params;
    const run = await getAgentRun(id);
    if (!run) throw new AppError("NOT_FOUND", "运行记录不存在", "可能已被清理，请重新运行");
    return ok(run, { mode: run.mode === "llm" ? "llm" : "fallback" });
  });
}
