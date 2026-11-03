-- 0002: 区分「内置样例源」与「真实网络源」
ALTER TABLE "Source" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;
