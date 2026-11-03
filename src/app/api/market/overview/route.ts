import { handleRoute, ok } from "@/lib/api/response";
import { quantFetch } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const data = await quantFetch<Record<string, unknown>>(
      `/market/overview?refresh=${refresh ? "true" : "false"}`,
      {},
      180_000,
    );
    return ok(data, { mode: "llm" });
  });
}
