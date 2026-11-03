#!/usr/bin/env node
/**
 * 一键启动：检查环境 → 补依赖 → 生成 Prisma Client → 初始化数据库 → 启动服务 → 打开浏览器。
 *
 * 用法：
 *   node scripts/start.mjs                 # 开发模式，默认 3000 端口，自动开浏览器
 *   node scripts/start.mjs --port 3001     # 指定端口
 *   node scripts/start.mjs --no-open       # 不自动打开浏览器
 *   node scripts/start.mjs --prod          # 生产模式（先 build 再 start）
 *   node scripts/start.mjs --reset --yes   # 清空并重建示例数据（会清掉设置页的模型 Key）
 *   node scripts/start.mjs --check         # 只做启动前检查，不启动服务
 *
 * Windows 也可以直接双击根目录的「一键启动.bat」。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
process.chdir(ROOT);

const isWindows = process.platform === "win32";
const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(`--${name}`);
}
function optionValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const PORT = Number(optionValue("port", process.env.PORT ?? 3000));
const QUANT_PORT = Number(optionValue("quant-port", process.env.QUANT_PORT ?? 8000));
const OPEN_BROWSER = !hasFlag("no-open");
const PROD = hasFlag("prod");
const CHECK_ONLY = hasFlag("check");
const RESET = hasFlag("reset");
const CONFIRMED = hasFlag("yes");
const SKIP_QUANT = hasFlag("no-quant");

const log = (message) => console.log(`[启动] ${message}`);
const warn = (message) => console.warn(`[启动] ${message}`);
const fail = (message, hint) => {
  console.error(`\n[启动] 失败：${message}`);
  if (hint) console.error(`[启动] 建议：${hint}`);
  process.exit(1);
};

/* ---------------- 1. 环境检查 ---------------- */

const nodeMajor = Number(process.versions.node.split(".")[0]);
log(`Node.js ${process.versions.node} · ${process.platform} · ${ROOT}`);
if (nodeMajor < 20) {
  fail(`Node.js 版本过低（${process.versions.node}）`, "请安装 Node.js 20 或更高版本：https://nodejs.org/");
}

/* ---------------- 2. 依赖 ---------------- */

function runStep(label, command, commandArgs) {
  log(`${label} …`);
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: isWindows,
    env: process.env,
    cwd: ROOT,
  });
  return result.status === 0;
}

if (!existsSync(path.join(ROOT, "node_modules", "next", "package.json"))) {
  log("首次运行，正在安装依赖（可能需要几分钟）…");
  const ok = runStep(
    "npm install",
    "npm",
    ["install", "--no-audit", "--no-fund"],
  );
  if (!ok) {
    fail(
      "依赖安装失败",
      "请确认网络可用后重试；或手动执行 npm install --no-audit --no-fund",
    );
  }
} else {
  log("依赖已就绪");
}

/* ---------------- 3. Prisma Client ---------------- */

const prismaClientEntry = path.join(ROOT, "node_modules", ".prisma", "client", "index.js");
if (!existsSync(prismaClientEntry)) {
  log("生成 Prisma Client …");
  const localCli = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
  const ok = existsSync(localCli)
    ? runStep("prisma generate", process.execPath, [localCli, "generate"])
    : runStep("prisma generate", "npx", ["prisma", "generate"]);
  if (!ok) {
    fail("Prisma Client 生成失败", "可手动执行 npx prisma generate 查看详细错误。");
  }
} else {
  log("Prisma Client 已就绪");
}

/* ---------------- 4. 数据库 ---------------- */

const dbFile = path.join(ROOT, "prisma", "dev.db");
const dbExisted = existsSync(dbFile);

function initDatabase() {
  log("创建数据库表结构 …");
  const pushed = runStep("prisma db push", "npx", ["prisma", "db", "push", "--skip-generate"]);
  if (!pushed) {
    warn("prisma db push 不可用，改用内置 SQL 初始化（node scripts/db-init.mjs）");
    if (!runStep("db-init", process.execPath, ["scripts/db-init.mjs"])) {
      fail("数据库初始化失败", "请确认 prisma/schema.prisma 存在，且当前目录可写。");
    }
  }
}

function seedDatabase() {
  log("写入示例数据 …");
  const seeded =
    runStep("seed", "npx", ["tsx", "prisma/seed.ts"]) ||
    runStep("seed（ts-loader 兜底）", process.execPath, [
      "--import",
      "./scripts/ts-loader.mjs",
      "prisma/seed.ts",
    ]);
  if (!seeded) {
    fail("示例数据写入失败", "可手动执行 npx tsx prisma/seed.ts 查看详细错误。");
  }
}

if (RESET) {
  if (!CONFIRMED) {
    fail(
      "--reset 会清空本机数据库（包含设置页保存的模型 Key），请追加 --yes 确认",
      "只重建表结构可执行：node scripts/db-init.mjs --force && npx tsx prisma/seed.ts",
    );
  }
  log("重置数据库（--reset --yes）…");
  if (!runStep("db-init --force", process.execPath, ["scripts/db-init.mjs", "--force"])) {
    fail("数据库重置失败", "请关闭其他占用 prisma/dev.db 的程序后重试。");
  }
  seedDatabase();
} else if (!dbExisted) {
  initDatabase();
  seedDatabase();
} else {
  log("数据库已存在，保留现有数据（如需重建示例数据：--reset --yes）");
}

/* ---------------- 5. Python 量化服务 ---------------- */

const PYTHON = process.env.PYTHON ?? (isWindows ? "python" : "python3");
let quantChild = null;
let quantExternal = false;

function checkPython() {
  const result = spawnSync(PYTHON, ["-c", "import fastapi, uvicorn, pandas, numpy, scipy, akshare"], {
    cwd: ROOT,
    stdio: "pipe",
    encoding: "utf8",
  });
  return result.status === 0;
}

function installPythonDeps() {
  log("缺少 Python 依赖，正在安装 services/quant/requirements.txt …");
  const result = spawnSync(PYTHON, ["-m", "pip", "install", "-r", "services/quant/requirements.txt"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: isWindows,
  });
  return result.status === 0;
}

async function quantIsHealthy() {
  try {
    const response = await fetch(`http://127.0.0.1:${QUANT_PORT}/health`, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startQuant() {
  if (SKIP_QUANT) {
    warn("已跳过 Python 量化服务（--no-quant），配置分析将不可用");
    return null;
  }
  if (await quantIsHealthy()) {
    log(`复用已运行的量化服务：http://127.0.0.1:${QUANT_PORT}`);
    quantExternal = true;
    return null;
  }
  if (!checkPython()) {
    if (!installPythonDeps() || !checkPython()) {
      fail(
        "Python 量化服务依赖不可用",
        `请安装 Python 3.11+ 并执行：${PYTHON} -m pip install -r services/quant/requirements.txt`,
      );
    }
  }
  log(`启动量化服务：http://127.0.0.1:${QUANT_PORT}`);
  const child = spawn(
    PYTHON,
    ["-m", "uvicorn", "app.main:app", "--app-dir", "services/quant", "--host", "127.0.0.1", "--port", String(QUANT_PORT)],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, QUANT_PORT: String(QUANT_PORT) }, shell: false },
  );
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (/Application startup complete|Uvicorn running/i.test(text)) log("量化服务已就绪");
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (!/INFO:|WARNING:/.test(text)) process.stderr.write(`[quant] ${text}`);
  });
  child.on("exit", (code) => {
    if (code && code !== 0) warn(`量化服务退出（code ${code}）`);
  });
  quantChild = child;
  return child;
}

async function waitForQuant(timeoutMs = 60_000) {
  if (quantExternal) return true;
  if (!quantChild) return false;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${QUANT_PORT}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

/* ---------------- 6. 端口 ---------------- */

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(true));
  });
}

let finalPort = PORT;
for (let candidate = PORT; candidate < PORT + 20; candidate += 1) {
  // eslint-disable-next-line no-await-in-loop
  if (await isPortFree(candidate)) {
    finalPort = candidate;
    break;
  }
  if (candidate === PORT + 19) {
    fail(`端口 ${PORT}–${PORT + 19} 都被占用`, "请用 --port 指定空闲端口，例如 --port 3100");
  }
}
if (finalPort !== PORT) {
  warn(`端口 ${PORT} 被占用，改用 ${finalPort}`);
}

const url = `http://localhost:${finalPort}`;

if (CHECK_ONLY) {
  if (!SKIP_QUANT && !checkPython()) {
    fail(
      "Python 量化服务依赖不可用",
      `请执行：${PYTHON} -m pip install -r services/quant/requirements.txt`,
    );
  }
  log(`检查通过：将使用 ${PROD ? "生产" : "开发"}模式在 ${url} 启动`);
  process.exit(0);
}

/* ---------------- 6. 启动服务 ---------------- */

function openBrowser(target) {
  if (!OPEN_BROWSER) return;
  try {
    if (isWindows) {
      spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" });
    } else if (process.platform === "darwin") {
      spawn("open", [target], { detached: true, stdio: "ignore" });
    } else {
      spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
    }
  } catch {
    log(`请手动打开浏览器访问 ${url}`);
  }
}

async function startServer() {
  await startQuant();
  const quantReady = await waitForQuant();
  if (!quantReady && !SKIP_QUANT) {
    warn("量化服务未在 60 秒内就绪；页面会提示服务离线，请查看上方日志");
  }
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  let command;
  let commandArgs;
  if (PROD) {
    log("生产模式：先构建（首次可能需要 1–2 分钟）…");
    const built = runStep("next build", process.execPath, [nextBin, "build"]);
    if (!built) fail("生产构建失败", "可先用默认开发模式启动：node scripts/start.mjs");
    command = process.execPath;
    commandArgs = [nextBin, "start", "-p", String(finalPort)];
  } else {
    command = process.execPath;
    commandArgs = [nextBin, "dev", "-p", String(finalPort)];
  }

  log(`${PROD ? "生产" : "开发"}服务器启动中：${url}`);
  const child = spawn(command, commandArgs, {
    cwd: ROOT,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, PORT: String(finalPort), QUANT_SERVICE_URL: `http://127.0.0.1:${QUANT_PORT}` },
    shell: false,
  });

  let opened = false;
  const openOnce = () => {
    if (opened) return;
    opened = true;
    openBrowser(url);
  };

  // 受限环境（禁止 spawn 子进程）兜底：用 Next 编程式 API 在当前进程内启动。
  async function startEmbedded() {
    try {
      const [{ createServer }, nextModule] = await Promise.all([
        import("node:http"),
        import("next"),
      ]);
      const next = nextModule.default;
      const app = next({ dev: true, dir: ROOT, hostname: "127.0.0.1", port: finalPort });
      const handle = app.getRequestHandler();
      await app.prepare();
      createServer((req, res) => {
        handle(req, res).catch((error) => {
          console.error("[启动] 请求处理失败", error);
          res.statusCode = 500;
          res.end("Internal Server Error");
        });
      }).listen(finalPort, "127.0.0.1", () => {
        console.log(`\n[启动] 已就绪（内置模式）：${url}`);
        console.log("[启动] 按 Ctrl+C 停止服务\n");
        openOnce();
      });
    } catch (error) {
      fail(`内置服务器启动失败：${error.message}`, "可尝试手动执行 npx next dev 查看详细日志。");
    }
  }

  child.on("error", (error) => {
    if (!PROD && (error.code === "EPERM" || error.code === "EACCES")) {
      warn(`无法启动子进程（${error.code}），改用内置服务器模式`);
      void startEmbedded();
      return;
    }
    fail(`启动失败：${error.message}`, "请检查 Node.js 安装与目录权限。");
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!opened && /Ready in|Local:\s+http|started server/i.test(text)) {
      console.log(`\n[启动] 已就绪：${url}\n[启动] 按 Ctrl+C 停止服务\n`);
      setTimeout(openOnce, 300);
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));

  child.on("exit", (code) => {
    if (code === 0 || code === null) process.exit(0);
    fail(`服务进程退出（code ${code}）`, "若是端口或编译问题，请看上方日志；也可执行 npx next dev 复现。");
  });

  const shutdown = () => {
    child.kill("SIGINT");
    if (quantChild) quantChild.kill("SIGINT");
    setTimeout(() => process.exit(0), 800);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 兜底：15 秒后仍未捕获到 ready 文案也打开一次浏览器
  setTimeout(openOnce, 15_000);
}

setTimeout(() => {
  void startServer();
}, 200);
