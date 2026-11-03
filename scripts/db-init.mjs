#!/usr/bin/env node
/**
 * 数据库初始化兜底脚本（不依赖 Prisma 引擎二进制）。
 *
 * 优先使用 Prisma 官方流程：npx prisma db push
 * 当运行环境禁止 spawn 原生二进制（部分 CI / 安全沙箱）时，本脚本用 Node 内置 sqlite
 * 执行 prisma/migrations/0001_init/migration.sql，得到等价的表结构。
 *
 * 用法：node scripts/db-init.mjs [--force]
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, "utf8");
    const match = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(text);
    if (match) return match[1].trim();
  }
  return "file:./dev.db";
}

const url = readDatabaseUrl();
const file = url.replace(/^file:/, "");
const dbPath = resolve(root, "prisma", file.replace(/^\.\//, ""));
mkdirSync(dirname(dbPath), { recursive: true });

const sql = readFileSync(resolve(root, "prisma/migrations/0001_init/migration.sql"), "utf8");
const FORCE = process.argv.includes("--force");
if (FORCE && existsSync(dbPath)) {
  // 不删除文件：Windows 上数据库可能被其他进程占用，rmSync 会 EPERM。
  // “重置”的语义是清空数据，保表结构即可，效果与删库重建一致。
  const old = new DatabaseSync(dbPath);
  old.exec("PRAGMA foreign_keys = OFF;");
  const names = old
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name);
  for (const name of names) old.exec(`DELETE FROM "${name}";`);
  old.exec("PRAGMA foreign_keys = ON;");
  old.close();
  console.log(`[db-init] 已清空旧数据：${dbPath}`);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");

const exists = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Article'")
  .all().length > 0;

if (exists && !process.argv.includes("--force")) {
  console.log(`[db-init] 数据表已存在，跳过：${dbPath}`);
} else {
  db.exec(sql);
  console.log(`[db-init] 已应用初始 schema：${dbPath}`);
}

// 轻量迁移：按 0003_pipeline.sql 逐条执行，ALTER 前先检查列是否已存在。
// 这样老库可就地补列，新库也能在 0001 之后得到完整结构；与 Prisma 官方迁移保持同一份 SQL。
const pipelineSql = readFileSync(resolve(root, "prisma/migrations/0003_pipeline.sql"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("--"))
  .join("\n");

for (const statement of pipelineSql.split(";").map((part) => part.trim()).filter(Boolean)) {
  const alter = /^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/i.exec(statement);
  if (alter) {
    const [, table, column] = alter;
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name);
    if (columns.includes(column)) continue;
    db.exec(`${statement};`);
    console.log(`[db-init] 已迁移：${table}.${column}`);
    continue;
  }
  db.exec(`${statement};`);
}

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);
console.log(`[db-init] 表数量：${tables.length}（${tables.join(", ")}）`);
db.close();
