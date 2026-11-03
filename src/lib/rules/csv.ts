import Papa from "papaparse";
import { ASSET_CATEGORIES, ASSET_CATEGORY_META, CURRENCIES, LIQUIDITY_LABELS } from "@/lib/constants";
import type { AssetCategory, Currency, LiquidityTier } from "@/lib/types/domain";
import { parseAmount } from "./money";

/**
 * 资产 CSV 解析（纯函数，便于单元测试）。
 * 设计目标：错误定位到“第几行第几列”，导入前可预览，坏行不阻塞好行。
 */

export const CSV_COLUMNS = [
  "name",
  "category",
  "currency",
  "amount",
  "institution",
  "industry",
  "liquidity",
  "maturityMonths",
  "note",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export interface CsvAssetDraft {
  name: string;
  category: AssetCategory;
  currency: Currency;
  amount: number;
  institution: string | null;
  industry: string | null;
  liquidity: LiquidityTier | null;
  maturityMonths: number | null;
  note: string | null;
}

export interface CsvRowResult {
  line: number;
  raw: Record<string, string>;
  value: CsvAssetDraft | null;
  errors: string[];
}

export interface CsvParseResult {
  columns: string[];
  missingColumns: string[];
  rows: CsvRowResult[];
  validCount: number;
  invalidCount: number;
  totalCount: number;
}

const CATEGORY_ALIASES: Record<string, AssetCategory> = {
  现金: "CASH",
  存款: "DEPOSIT",
  银行存款: "DEPOSIT",
  银行: "DEPOSIT",
  货基: "MONEY_FUND",
  货币基金: "MONEY_FUND",
  债券: "BOND",
  债基: "BOND",
  债券基金: "BOND",
  股票: "STOCK",
  基金: "FUND",
  公募基金: "FUND",
  房产: "REAL_ESTATE",
  房子: "REAL_ESTATE",
  保险: "INSURANCE",
  其他: "OTHER",
};

const LIQUIDITY_ALIASES: Record<string, LiquidityTier> = {
  高: "HIGH",
  高流动性: "HIGH",
  中: "MEDIUM",
  中流动性: "MEDIUM",
  低: "LOW",
  低流动性: "LOW",
};

export function normalizeCategory(input: string): AssetCategory | null {
  const text = input.trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if ((ASSET_CATEGORIES as string[]).includes(upper)) return upper as AssetCategory;
  if (CATEGORY_ALIASES[text]) return CATEGORY_ALIASES[text];
  for (const [label, category] of Object.entries(CATEGORY_ALIASES)) {
    if (text.includes(label)) return category;
  }
  return null;
}

export function normalizeCurrency(input: string): Currency | null {
  const text = input.trim().toUpperCase();
  if (!text) return "CNY";
  if ((CURRENCIES as string[]).includes(text)) return text as Currency;
  const map: Record<string, Currency> = {
    人民币: "CNY",
    元: "CNY",
    美元: "USD",
    美金: "USD",
    港币: "HKD",
    港元: "HKD",
    欧元: "EUR",
    日元: "JPY",
  };
  return map[input.trim()] ?? null;
}

export function normalizeLiquidity(input: string): LiquidityTier | null | "INVALID" {
  const text = input.trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (["HIGH", "MEDIUM", "LOW"].includes(upper)) return upper as LiquidityTier;
  return LIQUIDITY_ALIASES[text] ?? "INVALID";
}

/** 解析并逐行校验；表头缺列会被记录，不影响可解析的行 */
export function parseAssetCsv(csvText: string): CsvParseResult {
  const parsed = Papa.parse<string[]>(csvText.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });

  const matrix = (parsed.data ?? []).filter((row) => Array.isArray(row) && row.some((cell) => String(cell).trim() !== ""));
  if (matrix.length === 0) {
    return { columns: [], missingColumns: [...CSV_COLUMNS], rows: [], validCount: 0, invalidCount: 0, totalCount: 0 };
  }

  const header = matrix[0].map((cell) => String(cell).trim());
  const indexOf = new Map<string, number>();
  header.forEach((name, index) => {
    const key = name.toLowerCase().replace(/\s+/g, "");
    indexOf.set(key, index);
  });

  const columnAliases: Record<CsvColumn, string[]> = {
    name: ["name", "名称", "资产名称"],
    category: ["category", "类别", "资产类别"],
    currency: ["currency", "币种"],
    amount: ["amount", "金额", "市值"],
    institution: ["institution", "机构", "持有机构"],
    industry: ["industry", "行业"],
    liquidity: ["liquidity", "流动性"],
    maturityMonths: ["maturitymonths", "期限", "剩余期限", "剩余期限月"],
    note: ["note", "备注"],
  };

  const resolved = new Map<CsvColumn, number>();
  for (const column of CSV_COLUMNS) {
    for (const alias of columnAliases[column]) {
      const index = indexOf.get(alias);
      if (index !== undefined) {
        resolved.set(column, index);
        break;
      }
    }
  }

  const missingColumns = (["name", "category", "amount"] as CsvColumn[]).filter((column) => !resolved.has(column));
  if (missingColumns.length > 0) {
    return { columns: header, missingColumns, rows: [], validCount: 0, invalidCount: 0, totalCount: 0 };
  }

  const rows: CsvRowResult[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const cells = matrix[i].map((cell) => String(cell ?? "").trim());
    const raw: Record<string, string> = {};
    for (const column of CSV_COLUMNS) {
      const index = resolved.get(column);
      raw[column] = index === undefined ? "" : (cells[index] ?? "");
    }

    const errors: string[] = [];
    const category = normalizeCategory(raw.category);
    if (!category) {
      errors.push(
        `类别无法识别：「${raw.category}」（可用：${ASSET_CATEGORIES.map((c) => ASSET_CATEGORY_META[c].label).join("/")}）`,
      );
    }

    const currency = normalizeCurrency(raw.currency);
    if (!currency) errors.push(`币种无法识别：「${raw.currency}」（可用：${CURRENCIES.join("/")}）`);

    let amount = 0;
    try {
      const parsedAmount = parseAmount(raw.amount);
      if (parsedAmount === null) throw new Error("金额为空");
      amount = parsedAmount;
    } catch {
      errors.push(`金额格式不正确：「${raw.amount}」`);
    }
    if (Number.isFinite(amount) && amount <= 0) {
      errors.push("金额必须大于 0");
    }
    if (amount > 10_000_000_000) {
      errors.push("金额超出上限（100 亿）");
    }

    const liquidity = normalizeLiquidity(raw.liquidity);
    if (liquidity === "INVALID") errors.push(`流动性无法识别：「${raw.liquidity}」（可用：${Object.values(LIQUIDITY_LABELS).join("/")} 或 HIGH/MEDIUM/LOW）`);

    let maturityMonths: number | null = null;
    if (raw.maturityMonths) {
      const months = Number(raw.maturityMonths);
      if (!Number.isFinite(months) || months < 0 || months > 600) errors.push(`剩余期限应为 0–600 的月数：「${raw.maturityMonths}」`);
      else maturityMonths = Math.round(months);
    }

    if (!raw.name) errors.push("缺少资产名称");

    const value: CsvAssetDraft | null =
      errors.length === 0 && category && currency
        ? {
            name: raw.name,
            category,
            currency,
            amount: Math.round(amount * 100) / 100,
            institution: raw.institution || null,
            industry: raw.industry || null,
            liquidity: liquidity === "INVALID" ? null : liquidity,
            maturityMonths,
            note: raw.note || null,
          }
        : null;

    rows.push({ line: i + 1, raw, value, errors });
  }

  const validCount = rows.filter((row) => row.value !== null).length;
  return {
    columns: header,
    missingColumns,
    rows,
    validCount,
    invalidCount: rows.length - validCount,
    totalCount: rows.length,
  };
}

export function csvTemplate(): string {
  const header = CSV_COLUMNS.join(",");
  const rows = [
    "工资卡活期,现金,CNY,32000,示例银行,,HIGH,0,日常备用",
    "三年期存款,存款,CNY,80000,示例银行,,MEDIUM,24,虚构样例",
    "沪深300指数基金,基金,CNY,45000,示例基金,宽基指数,MEDIUM,,虚构样例",
    "美元货币基金,货币基金,USD,5000,示例海外机构,,HIGH,0,虚构样例",
  ];
  return `${header}\n${rows.join("\n")}\n`;
}
