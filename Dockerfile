# syntax=docker/dockerfile:1

# ---------- 依赖层 ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---------- 构建层 ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="file:./prisma/build.db"
RUN npx prisma generate && npm run build

# ---------- 运行层 ----------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    QUANT_SERVICE_URL="http://127.0.0.1:8000" \
    QUANT_PORT=8000 \
    DATABASE_URL="file:/app/data/finscope.db"

# Python 量化服务 + 中文字体（PDF 报告）
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl curl python3 python3-pip python3-venv fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY services/quant/requirements.txt ./services/quant/requirements.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r services/quant/requirements.txt

COPY --from=builder --chown=node:node /app ./
RUN mkdir -p /app/data /app/services/quant/data \
    && chown -R node:node /app/data /app/services/quant/data
USER node
EXPOSE 3000 8000
VOLUME ["/app/data", "/app/services/quant/data"]
CMD ["node", "scripts/docker-start.mjs"]
