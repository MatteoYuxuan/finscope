import { DEMO_FX_RATES } from "@/lib/constants";
import type { Currency } from "@/lib/types/domain";
import { centsToYuan, toCents } from "./money";

export class UnknownCurrencyError extends Error {
  readonly currency: string;

  constructor(currency: string) {
    super(`不支持的币种：${currency}`);
    this.name = "UnknownCurrencyError";
    this.currency = currency;
  }
}

export function isCurrency(value: string): value is Currency {
  return Object.prototype.hasOwnProperty.call(DEMO_FX_RATES, value);
}

/** 演示汇率：1 单位外币 = N 元。未知币种抛错，避免静默算错。 */
export function fxRate(currency: string): number {
  if (!isCurrency(currency)) throw new UnknownCurrencyError(currency);
  return DEMO_FX_RATES[currency];
}

/** 折算为人民币（元），内部用整数分计算后再还原，保证可复现。 */
export function convertToCny(amount: number, currency: string): number {
  const cents = toCents(amount);
  const rate = fxRate(currency);
  return centsToYuan(Math.round(cents * rate));
}

/** 折算为人民币（分），用于聚合求和 */
export function convertToCnyCents(amount: number, currency: string): number {
  return Math.round(toCents(amount) * fxRate(currency));
}

export function sumCnyCents(items: { amount: number; currency: string }[]): number {
  return items.reduce((acc, item) => acc + convertToCnyCents(item.amount, item.currency), 0);
}

export function describeFxTable(): { currency: string; rate: number }[] {
  return Object.entries(DEMO_FX_RATES).map(([currency, rate]) => ({ currency, rate }));
}
