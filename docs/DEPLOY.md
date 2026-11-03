# 部署与运行说明

本项目是**双服务单仓库**：

- **Next.js 15**：UI、用户数据 CRUD、BFF；
- **Python FastAPI**：真实数据、量化、Agent、报告。

默认本地运行，不需要外部数据库；LLM 可选。

---

## 一、环境要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | 20.11+（推荐 22/24） | Next 15 + Prisma 6 |
| npm | 10+ | 仓库含 `package-lock.json` |
| Python | 3.11+（推荐 3.13） | FastAPI、pandas、numpy、scipy、akshare |
| 磁盘 | 约 1 GB（含 node_modules 与 Python 包） | 行情缓存 < 50 MB |
| 网络 | 首次拉行情/宏观需要 | 之后可用本地缓存离线演示 |

```bash
node -v
npm -v
python --version
```

---

## 二、一键启动（推荐）

| 方式 | 操作 |
| --- | --- |
| Windows | 双击根目录 `一键启动.bat` |
| 任意系统 | `npm run start:easy` |

脚本会：

1. 检查 Node；
2. 安装 npm 依赖；
3. 生成 Prisma Client；
4. 初始化/保留 SQLite；
5. 检查 Python 依赖（缺失时 `pip install -r services/quant/requirements.txt`）；
6. 启动 FastAPI（默认 8000）；
7. 等待 `/health`；
8. 启动 Next.js（默认 3000）并打开浏览器。

常用参数：

```bash
node scripts/start.mjs --port 3001        # 指定 Next 端口
node scripts/start.mjs --quant-port 8001  # 指定量化服务端口
node scripts/start.mjs --no-open          # 不自动打开浏览器
node scripts/start.mjs --check            # 只检查环境
node scripts/start.mjs --no-quant         # 跳过 Python（分析不可用）
node scripts/start.mjs --reset --yes      # 清空并重建演示数据
```

---

## 三、手动启动（开发）

```bash
# 终端 1
npm run quant:dev

# 终端 2
npm run dev
```

打开 <http://localhost:3000>。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | Next 开发模式（3000） |
| `npm run quant:dev` | FastAPI + reload（8000） |
| `npm run quant:start` | FastAPI 生产启动 |
| `npm run build` | Next 生产构建 |
| `npm start` | Next 生产启动 |
| `npm test` | 140 条 TS 测试 |
| `npm run quant:test` | 6 条 Python 量化测试 |
| `npm run typecheck` | TypeScript 检查 |
| `npm run db:reset` | 清空并重建演示数据 |

---

## 四、环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

关键变量：

```bash
DATABASE_URL="file:./dev.db"

# Next -> FastAPI
QUANT_SERVICE_URL="http://127.0.0.1:8000"
QUANT_PORT="8000"

# LLM（可选）
LLM_BASE_URL="https://api.deepseek.com"
LLM_API_KEY=""
LLM_MODEL="deepseek-chat"
LLM_TIMEOUT_MS="90000"

# 视觉模型（可选）
LLM_VISION_BASE_URL=""
LLM_VISION_API_KEY=""
LLM_VISION_MODEL=""

# 数据
ALLOW_LIVE_DATA="true"
```

也可以在「设置 → LLM 接入」运行时填写；写入 `services/quant/data/llm.json`，不写日志。

---

## 五、数据文件

| 文件 | 内容 | 是否提交 |
| --- | --- | --- |
| `prisma/dev.db` | 用户持仓、负债、目标、运行记录 | 否 |
| `services/quant/data/market.db` | 行情、宏观、分析/Agent 运行、报告 | 否 |
| `services/quant/data/reports/*` | HTML/PDF 与图表 | 否 |
| `services/quant/data/llm.json` | LLM Key（本机） | 否 |

`.gitignore` 已排除以上内容。

---

## 六、Docker

```bash
docker compose up -d --build
```

`Dockerfile` 需要同时安装 Node 与 Python，并暴露 3000/8000；`docker-compose.yml` 挂载：

- `./prisma:/app/prisma`（持久化用户数据）
- `./services/quant/data:/app/services/quant/data`（行情缓存/报告）

首次启动后进入容器或页面执行一次数据刷新：

```bash
curl -X POST http://127.0.0.1:8000/data/refresh
```

> 如果部署平台不支持双进程，可拆成两个服务：Web（Next）与 Quant（FastAPI），用 `QUANT_SERVICE_URL` 连接。

---

## 七、生产部署

```bash
npm run build
npm run quant:start   # 终端 1
npm start             # 终端 2
```

或 `node scripts/start.mjs --prod`（会先 build）。

生产环境检查：

- `GET /api/health` 返回 Next 正常；
- `GET /api/system/health` 显示 `quant.status = ok`；
- 无痕窗口走一遍：首页 → 工作台 → 配置分析 → 智能决策 → PDF；
- 移动端可打开；
- 报告 PDF 中文字体正常（Linux 需安装中文字体，或把 `simhei.ttf` 放进镜像）。

---

## 八、常见故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面提示量化服务离线 | FastAPI 未启动/端口冲突 | `npm run quant:dev`；检查 8000 端口 |
| `ModuleNotFoundError: fastapi` | Python 依赖缺失 | `python -m pip install -r services/quant/requirements.txt` |
| 行情为空 | 网络不可用且无缓存 | 先联网刷新；或恢复演示数据 |
| 报告 PDF 中文乱码 | 容器缺中文字体 | 安装 `fonts-noto-cjk` 或复制 `simhei.ttf` |
| `next build` 报 worker 错误 | 受限沙箱 | 删除 `.next` 后重试；或在普通本机/Docker 构建 |
| 端口被占用 | 3000/8000 已用 | `--port` / `--quant-port` |
| LLM 超时 | Key/网络/模型 | 设置页测试连接；或关闭「使用 LLM」走规则智能体 |
