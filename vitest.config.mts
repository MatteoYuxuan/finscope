import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest 配置。
 * - 只测纯函数层（规则引擎、校验、检索、Markdown 组合），不依赖数据库与网络
 * - 使用 threads 池，避免在受限环境里 fork 子进程
 * - 串行执行，保证输出稳定、便于答辩现场演示测试过程
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "threads",
    fileParallelism: false,
    reporters: ["default"],
    testTimeout: 20_000,
  },
});
