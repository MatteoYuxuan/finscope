#!/usr/bin/env node
/**
 * 容器启动脚本：
 *   1. prisma db push（保证新表结构）
 *   2. 启动 Python 量化服务并等待 /health
 *   3. 必要时写入演示数据
 *   4. 用 Next 编程式 API 启动 Web（避免额外 spawn 限制）
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import next from "next";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const quantPort = Number(process.env.QUANT_PORT ?? 8000);

register("./ts-resolve-hooks.mjs", pathToFileURL(import.meta.filename));

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const filePart = databaseUrl.replace(/^file:/, "");
const dbPath = filePart.startsWith("/") ? filePart : resolve(root, filePart);
mkdirSync(dirname(dbPath), { recursive: true });
process.env.DATABASE_URL = `file:${dbPath}`;

function runPrismaPush() {
  const cli = resolve(root, "node_modules/prisma/build/index.js");
  if (!existsSync(cli)) return;
  const result = spawnSync(process.execPath, [cli, "db", "push", "--skip-generate"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
  if (result.status !== 0) {
    console.warn("[start] prisma db push 失败，继续尝试启动（可能是只读卷）");
  }
}

function startQuant() {
  const child = spawn(
    "python3",
    ["-m", "uvicorn", "app.main:app", "--app-dir", "services/quant", "--host", "127.0.0.1", "--port", String(quantPort)],
    { cwd: root, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, QUANT_PORT: String(quantPort) } },
  );
  child.on("exit", (code) => {
    if (code && code !== 0) console.warn(`[start] 量化服务退出 code=${code}`);
  });
  return child;
}

async function waitForQuant(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${quantPort}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

runPrismaPush();
const quant = startQuant();
const ready = await waitForQuant();
if (!ready) console.warn("[start] 量化服务未在 60 秒内就绪，页面会提示离线");

const probe = await import("../src/lib/db.ts");
const count = await probe.prisma.agentRun.count().catch(() => 0);
if (count === 0) {
  console.log("[start] 写入演示数据…");
  const { seedDemoData } = await import("../src/lib/services/seed.ts");
  const result = await seedDemoData();
  console.log("[start] 演示数据就绪：", JSON.stringify(result));
}
await probe.prisma.$disconnect();

const app = next({ dev: false, dir: root, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("[start] 请求处理失败：", error);
    response.statusCode = 500;
    response.end("Internal Server Error");
  });
}).listen(port, hostname, () => {
  console.log(`[start] 知衡 FinScope 已启动：http://${hostname}:${port}`);
});

const shutdown = () => {
  quant.kill("SIGINT");
  setTimeout(() => process.exit(0), 800);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
