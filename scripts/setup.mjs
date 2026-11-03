#!/usr/bin/env node
/**
 * 一键初始化（本机使用，需要 Node.js 20+ 与 npm）。
 *
 *   npm run setup
 *
 * 做的事：
 *   1. 生成 Prisma Client
 *   2. 创建/更新 SQLite 表结构（prisma db push）
 *   3. 写入虚构演示数据
 *
 * 如果当前环境禁止 spawn 原生引擎（例如受限沙箱），请改用：
 *   node scripts/db-init.mjs --force
 *   node --import ./scripts/ts-loader.mjs prisma/seed.ts
 */
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

function run(label, command, args) {
  console.log(`\n[setup] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: isWindows,
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`[setup] 步骤失败：${label}`);
    process.exit(result.status ?? 1);
  }
}

run("生成 Prisma Client", "npx", ["prisma", "generate"]);
run("创建数据库表结构", "npx", ["prisma", "db", "push"]);
run("写入虚构演示数据", "npx", ["tsx", "prisma/seed.ts"]);

console.log(`
[setup] 完成。

  npm run dev        # 启动开发服务器 http://localhost:3000
  npm run build      # 生产构建
  npm test           # 运行规则引擎单元测试
  npm run typecheck  # TypeScript 静态检查

提示：默认使用 Mock 模式，不需要任何 API Key 即可完整演示。
如需接入真实大模型，复制 .env.example 为 .env 并填写 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。
`);
