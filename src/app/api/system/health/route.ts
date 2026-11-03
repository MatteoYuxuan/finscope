import { handleRoute, ok } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { quantHealth } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    let quant: Awaited<ReturnType<typeof quantHealth>> | null = null;
    let quantError: string | null = null;
    try {
      quant = await quantHealth();
    } catch (error) {
      quantError = error instanceof Error ? error.message : String(error);
    }
    const [assets, liabilities, goals, runs, reports] = await Promise.all([
      prisma.asset.count(),
      prisma.liability.count(),
      prisma.goal.count(),
      prisma.agentRun.count(),
      prisma.report.count(),
    ]);
    return ok(
      {
        quant,
        quantError,
        counts: { assets, liabilities, goals, runs, reports },
        checkedAt: new Date().toISOString(),
      },
      { mode: "mock" },
    );
  });
}
