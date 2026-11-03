-- 0003：结构化推理层（文章抽取、事件分析、AI 审计与缓存）
-- SQLite 的 ALTER TABLE 每次只能加一列；全部列使用默认值，便于已有数据就地升级。

ALTER TABLE "Article" ADD COLUMN "entities" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Article" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "Article" ADD COLUMN "keyNumbers" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Article" ADD COLUMN "claims" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Article" ADD COLUMN "extractionMode" TEXT NOT NULL DEFAULT 'rule';
ALTER TABLE "Article" ADD COLUMN "extractedAt" DATETIME;

ALTER TABLE "Event" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "Event" ADD COLUMN "entities" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Event" ADD COLUMN "analysis" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Event" ADD COLUMN "analysisMode" TEXT NOT NULL DEFAULT 'rule';
ALTER TABLE "Event" ADD COLUMN "analysisAt" DATETIME;
ALTER TABLE "Event" ADD COLUMN "evidenceHash" TEXT;

ALTER TABLE "ChatMessage" ADD COLUMN "payload" TEXT;

CREATE TABLE IF NOT EXISTS "AiRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "task" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'mock',
  "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ok',
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "payloadHash" TEXT,
  "cacheHit" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "refType" TEXT,
  "refId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AiRun_createdAt_idx" ON "AiRun"("createdAt");
CREATE INDEX IF NOT EXISTS "AiRun_task_createdAt_idx" ON "AiRun"("task", "createdAt");

CREATE TABLE IF NOT EXISTS "AiCache" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "task" TEXT NOT NULL,
  "output" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'llm',
  "model" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS "AiCache_expiresAt_idx" ON "AiCache"("expiresAt");
