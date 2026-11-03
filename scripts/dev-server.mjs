/**
 * 受限环境下的开发服务器兜底。
 *
 * 某些沙箱禁止 spawn 子进程，`next dev` 会因为内部 fork 失败（EPERM）。
 * 这里用 Next 的编程式 API 在当前进程内起服务，行为与 next dev 等价：
 *   node scripts/dev-server.mjs [port]
 * 正常本机开发仍然推荐 `npm run dev`。
 */
import { createServer } from "node:http";
import next from "next";

const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "127.0.0.1";

const app = next({ dev: true, dir: process.cwd(), hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("[dev-server] request failed", error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  });
}).listen(port, hostname, () => {
  console.log(`[dev-server] ready on http://${hostname}:${port}`);
});
