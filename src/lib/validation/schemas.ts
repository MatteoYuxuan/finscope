import { z } from "zod";

export const ASSET_CATEGORY_VALUES = [
  "CASH",
  "DEPOSIT",
  "MONEY_FUND",
  "BOND",
  "STOCK",
  "FUND",
  "REAL_ESTATE",
  "INSURANCE",
  "OTHER",
] as const;

export const LIABILITY_CATEGORY_VALUES = ["MORTGAGE", "CONSUMER_LOAN", "CARD", "CAR_LOAN", "OTHER"] as const;

export const CURRENCY_VALUES = ["CNY", "USD", "HKD", "EUR", "JPY"] as const;

export const LIQUIDITY_VALUES = ["HIGH", "MEDIUM", "LOW"] as const;

export const AMOUNT_MAX = 10_000_000_000; // 100 亿，超过即视为录入错误

const amountSchema = z
  .number({ error: "金额必须是数字" })
  .finite("金额必须是有限数字")
  .gt(0, "金额必须大于 0")
  .max(AMOUNT_MAX, "金额超出合理范围（≤100 亿）");

export const assetInputSchema = z.object({
  name: z.string().trim().min(1, "请填写资产名称").max(60, "名称不超过 60 字"),
  category: z.enum(ASSET_CATEGORY_VALUES, { error: "请选择资产类别" }),
  currency: z.enum(CURRENCY_VALUES, { error: "请选择币种" }).default("CNY"),
  amount: amountSchema,
  institution: z.string().trim().max(60).optional().nullable(),
  industry: z.string().trim().max(40).optional().nullable(),
  liquidity: z.enum(LIQUIDITY_VALUES).optional().nullable(),
  maturityMonths: z.number().int().min(0).max(600).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
});

export const assetUpdateSchema = assetInputSchema.partial();

export const liabilityInputSchema = z.object({
  name: z.string().trim().min(1, "请填写负债名称").max(60, "名称不超过 60 字"),
  category: z.enum(LIABILITY_CATEGORY_VALUES, { error: "请选择负债类别" }),
  currency: z.enum(CURRENCY_VALUES).default("CNY"),
  amount: amountSchema,
  interestRate: z.number().min(0, "利率不能为负").max(100, "利率请填年化百分数（如 4.35）").optional().nullable(),
  monthlyPayment: z.number().min(0).max(AMOUNT_MAX).optional().nullable(),
  remainingMonths: z.number().int().min(0).max(600).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
});

export const liabilityUpdateSchema = liabilityInputSchema.partial();

export const sourceInputSchema = z.object({
  name: z.string().trim().min(1, "请填写信息源名称").max(60),
  kind: z.enum(["RSS", "JSON", "MANUAL"]).default("RSS"),
  url: z.string().trim().max(300).optional().nullable(),
  enabled: z.boolean().default(true),
  credibility: z.number().int().min(1).max(5).default(3),
  topicHint: z.string().trim().max(40).optional().nullable(),
});

export const sourceUpdateSchema = sourceInputSchema.partial();

export const topicUpdateSchema = z
  .object({
    followed: z.boolean().optional(),
    keywords: z.array(z.string().trim().min(1, "关键词不能为空").max(30)).max(20).optional(),
  })
  .refine(
    (value) => value.followed !== undefined || value.keywords !== undefined,
    "请至少提交 followed 或 keywords 之一",
  );

export const riskProfileInputSchema = z.object({
  answers: z
    .array(z.number().int().min(0, "答案超出范围").max(4, "答案超出范围"))
    .length(10, "问卷共 10 题，请全部作答"),
});

export const chatInputSchema = z.object({
  question: z.string().trim().min(1, "请输入问题").max(500, "问题不超过 500 字"),
});

export const importInputSchema = z.object({
  csv: z.string().min(1, "CSV 内容为空").max(200_000, "CSV 文件过大（上限 200KB）"),
  commit: z.boolean().default(false),
});

export const settingsInputSchema = z.object({
  entries: z
    .record(
      z.string().max(60),
      z.union([z.string().max(2000), z.number(), z.boolean()]),
    )
    .refine((value) => Object.keys(value).length > 0, "没有需要保存的设置"),
});

export const briefInputSchema = z.object({
  topicSlugs: z.array(z.string().max(40)).max(12).optional(),
  days: z.number().int().min(3, "时间窗口至少 3 天").max(60, "时间窗口最多 60 天").optional(),
});

export type AssetInput = z.infer<typeof assetInputSchema>;
export type LiabilityInput = z.infer<typeof liabilityInputSchema>;
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type ChatInput = z.infer<typeof chatInputSchema>;

/** 把 ZodError 压平成前端可直接渲染的字段级错误 */
export function flattenIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}
