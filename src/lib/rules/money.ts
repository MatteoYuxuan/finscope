/**
 * 金额工具：全站金额运算统一走“整数分”，避免浮点误差。
 * 存储层仍是元（Float），写入前由 Zod 限制为两位小数。
 */

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 元 → 分（整数）。非法或越界直接抛错，绝不让 NaN 流进业务层。 */
export function toCents(yuan: number): number {
  if (!Number.isFinite(yuan)) throw new RangeError("AMOUNT_NOT_FINITE");
  const cents = Math.round(yuan * 100);
  if (!Number.isSafeInteger(cents)) throw new RangeError("AMOUNT_OVERFLOW");
  return cents;
}

export function centsToYuan(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

/** 安全版：异常时返回 0，用于统计聚合（调用方已做校验） */
export function safeCents(yuan: number): number {
  try {
    return toCents(yuan);
  } catch {
    return 0;
  }
}

const FULL_WIDTH_DIGITS = /[０-９．，]/g;

function toHalfWidth(input: string): string {
  return input.replace(FULL_WIDTH_DIGITS, (ch) => {
    const code = ch.charCodeAt(0);
    if (ch === "．") return ".";
    if (ch === "，") return ",";
    return String.fromCharCode(code - 0xfee0);
  });
}

/**
 * 解析用户输入的金额，支持：1234、1,234.56、¥1234、1234元、1.2万、3亿、全角数字。
 * 解析失败返回 null（UI 显示“请填写有效金额”）。
 */
export function parseAmount(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? round2(input) : null;
  }
  if (typeof input !== "string") return null;

  let text = toHalfWidth(input.trim());
  text = text.replace(/[\s,]/g, "").replace(/[¥￥$€]/g, "");

  let multiplier = 1;
  if (text.endsWith("万")) {
    multiplier = 1e4;
    text = text.slice(0, -1);
  } else if (text.endsWith("亿")) {
    multiplier = 1e8;
    text = text.slice(0, -1);
  }
  if (text.endsWith("元")) text = text.slice(0, -1);

  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text) * multiplier;
  return Number.isFinite(value) ? round2(value) : null;
}

/** 常规金额展示：1,234,567.89 */
export function formatYuan(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 紧凑展示：12.5 万 / 3.20 亿，用于指标卡 */
export function formatCompactYuan(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e8) {
    return `${sign}${trimZero(abs / 1e8)} 亿`;
  }
  if (abs >= 1e4) {
    return `${sign}${trimZero(abs / 1e4)} 万`;
  }
  return `${sign}${trimZero(abs)}`;
}

/** 带人民币单位的紧凑展示：12.5 万元 */
export function formatCny(value: number): string {
  return `${formatCompactYuan(value)}元`;
}

function trimZero(value: number): string {
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
}

/** 百分比展示：0.4261 → 42.6% */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
