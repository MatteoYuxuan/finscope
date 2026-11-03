import { handleRoute, ok } from "@/lib/api/response";
import { clearBusinessData, seedDemoData } from "@/lib/services/seed";
import { getLLMMode } from "@/lib/services/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 恢复示例数据：清空业务数据（含主题）后重新灌入内置样例 */
export async function POST() {
  return handleRoute(async () => {
    await clearBusinessData({ includeTopics: true });
    const seeded = await seedDemoData();
    return ok(
      {
        cleared: true,
        seeded,
        message: "示例数据已重置为初始状态",
      },
      { mode: await getLLMMode(), degraded: false },
    );
  });
}
