-- 初始 schema（SQLite）
-- 与 prisma/schema.prisma 一一对应；正常开发请使用 `npx prisma db push`。
-- 这份 SQL 用于“无法运行 Prisma 引擎二进制”的受限环境（如 CI 沙箱）或纯手工初始化兜底。

CREATE TABLE IF NOT EXISTS "Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "credibility" INTEGER NOT NULL DEFAULT 3,
    "topicHint" TEXT,
    "lastFetchedAt" DATETIME,
    "lastStatus" TEXT NOT NULL DEFAULT 'never',
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signature" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "themes" TEXT NOT NULL DEFAULT '[]',
    "industries" TEXT NOT NULL DEFAULT '[]',
    "regions" TEXT NOT NULL DEFAULT '[]',
    "currencies" TEXT NOT NULL DEFAULT '[]',
    "sentiment" TEXT NOT NULL DEFAULT 'neutral',
    "articleCount" INTEGER NOT NULL DEFAULT 1,
    "sourceCount" INTEGER NOT NULL DEFAULT 1,
    "credibility" INTEGER NOT NULL DEFAULT 60,
    "completeness" INTEGER NOT NULL DEFAULT 60,
    "firstSeenAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Event_signature_key" ON "Event"("signature");
CREATE INDEX IF NOT EXISTS "Event_lastSeenAt_idx" ON "Event"("lastSeenAt");

CREATE TABLE IF NOT EXISTS "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT,
    "url" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "region" TEXT NOT NULL DEFAULT 'CN',
    "currency" TEXT,
    "sentiment" TEXT NOT NULL DEFAULT 'neutral',
    "impactDims" TEXT NOT NULL DEFAULT '[]',
    "qualityScore" INTEGER NOT NULL DEFAULT 50,
    "qualityFlags" TEXT NOT NULL DEFAULT '[]',
    "contentHash" TEXT NOT NULL,
    "eventId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Article_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Article_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Article_contentHash_key" ON "Article"("contentHash");
CREATE INDEX IF NOT EXISTS "Article_publishedAt_idx" ON "Article"("publishedAt");
CREATE INDEX IF NOT EXISTS "Article_eventId_idx" ON "Article"("eventId");
CREATE INDEX IF NOT EXISTS "Article_sourceId_idx" ON "Article"("sourceId");

CREATE TABLE IF NOT EXISTS "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "followed" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Topic_slug_key" ON "Topic"("slug");

CREATE TABLE IF NOT EXISTS "ArticleTopic" (
    "articleId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "score" REAL NOT NULL DEFAULT 0,
    "hits" TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY ("articleId", "topicId"),
    CONSTRAINT "ArticleTopic_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ArticleTopic_topicId_idx" ON "ArticleTopic"("topicId");

CREATE TABLE IF NOT EXISTS "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "amount" REAL NOT NULL,
    "institution" TEXT,
    "industry" TEXT,
    "liquidity" TEXT,
    "maturityMonths" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "Asset_category_idx" ON "Asset"("category");

CREATE TABLE IF NOT EXISTS "Liability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "amount" REAL NOT NULL,
    "interestRate" REAL,
    "monthlyPayment" REAL,
    "remainingMonths" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "RiskProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "answers" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "citations" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Report_type_createdAt_idx" ON "Report"("type", "createdAt");

CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" TEXT NOT NULL DEFAULT '[]',
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
