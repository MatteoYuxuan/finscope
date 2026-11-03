/**
 * 轻量 TS 解析器：让 Node 直接运行本仓库的 .ts 源文件（依赖 Node 22.6+ 的类型擦除）。
 *
 * 用途：在禁止 spawn 子进程的受限环境（CI 沙箱）里执行 seed / 校验脚本，
 * 避免依赖 tsx(esbuild) 的常驻子进程。日常开发仍推荐 `npm run db:seed`（tsx）。
 *
 * 用法：node --import ./scripts/ts-loader.mjs prisma/seed.ts
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve-hooks.mjs", pathToFileURL(import.meta.filename));
