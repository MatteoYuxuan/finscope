import { handleRoute, ok, readJson } from "@/lib/api/response";
import { quantFetch } from "@/lib/quant/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    const data = await quantFetch<Record<string, unknown>>("/llm/config", {}, 10_000);
    return ok(data, { mode: "mock" });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await readJson(request);
    const data = await quantFetch<Record<string, unknown>>(
      "/llm/config",
      { method: "POST", body: JSON.stringify(body) },
      15_000,
    );
    return ok(data, { mode: "mock" });
  });
}
