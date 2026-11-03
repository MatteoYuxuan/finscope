/**
 * 文章级结构化抽取（规则层）。
 *
 * 目标：把“标题 + 摘要 + 正文”变成可聚类、可对照、可追溯的结构化字段：
 * 实体、事件类型、关键数值、主张、地区与币种。
 *
 * 设计取舍：
 * - 纯函数、无网络与数据库依赖，保证离线与测试可复现；
 * - 规则优先，LLM 模式下由 ai/article_extract 覆盖（schema 完全一致）；
 * - 只抽取原文出现的信息，不做摘要、不做评价、不推断涨跌。
 */
import type {
  ArticleClaim,
  ArticleEventType,
  ArticleExtraction,
  ClaimKind,
  EntityType,
  ExtractedEntity,
  KeyNumber,
} from "@/lib/types/domain";
import { toHalfWidth } from "@/lib/rules/text";
import { ARTICLE_EVENT_TYPE_LABELS } from "@/lib/constants";

export { ARTICLE_EVENT_TYPE_LABELS };

export interface ExtractInput {
  title: string;
  summary: string;
  content?: string | null;
  sourceName?: string;
}



export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  fact: "已披露事实",
  claim: "单方说法",
  estimate: "测算估计",
  opinion: "观点评论",
  denial: "澄清否认",
};

export function eventTypeLabel(type: string): string {
  return ARTICLE_EVENT_TYPE_LABELS[type as ArticleEventType] ?? "其他";
}

const REGION_RULES: { region: string; pattern: RegExp }[] = [
  { region: "CN", pattern: /中国|国内|人民币|沪深|A股|统计局/ },
  { region: "US", pattern: /美国|美联储|美元|纽约|白宫/ },
  { region: "EU", pattern: /欧洲|欧元|欧央行|欧盟/ },
  { region: "JP", pattern: /日本|日元|东京/ },
  { region: "HK", pattern: /香港|港元|恒生/ },
];

/** 地区推断：命中多个时按“中国 → 美国 → 欧洲 → 日本 → 香港”的顺序取第一个 */
export function inferRegion(text: string): string {
  for (const rule of REGION_RULES) {
    if (rule.pattern.test(text)) return rule.region;
  }
  return "GLOBAL";
}

const CURRENCY_RULES: { currency: string; pattern: RegExp }[] = [
  { currency: "USD", pattern: /美元|USD/ },
  { currency: "EUR", pattern: /欧元|EUR/ },
  { currency: "JPY", pattern: /日元|JPY/ },
  { currency: "HKD", pattern: /港元|HKD/ },
  { currency: "CNY", pattern: /人民币|CNY/ },
];

export function inferCurrency(text: string): string | null {
  for (const rule of CURRENCY_RULES) {
    if (rule.pattern.test(text)) return rule.currency;
  }
  return null;
}

const INDICATOR_NAMES = [
  "GDP",
  "CPI",
  "PPI",
  "PMI",
  "社融",
  "M2",
  "LPR",
  "利率",
  "汇率",
  "美元指数",
  "营收",
  "净利润",
  "研发投入",
  "贡献率",
  "消费",
  "服务业",
  "固定资产投资",
  "出口",
  "订单",
  "过渡期",
  "排产",
  "库存",
  "产能",
  "价格",
  "金额",
];

const PRODUCT_NAMES = [
  "晶圆",
  "半导体设备",
  "刻蚀设备",
  "光伏组件",
  "硅料",
  "硅片",
  "原油",
  "化工品",
  "人民币",
  "美元",
  "债券",
  "股票",
];

const LOCATION_NAMES = ["中国", "美国", "欧洲", "欧元区", "日本", "香港"];

const COMPANY_PATTERN =
  /(^|[，。；：、\s（(])([\u4e00-\u9fa5A-Za-z0-9]{2,10}(?:科技|半导体|集团|控股|股份|银行|证券|保险|基金|医药|地产|实业))/g;

const POLICY_PATTERN = /《([^》]{2,40})》/g;

function pushEntity(
  map: Map<string, ExtractedEntity>,
  name: string,
  type: EntityType,
  role: string,
): void {
  const key = name.trim();
  if (!key || key.length > 40 || map.has(key)) return;
  map.set(key, { name: key, type, role });
}

export function extractEntities(text: string): ExtractedEntity[] {
  const entities = new Map<string, ExtractedEntity>();

  for (const match of text.matchAll(POLICY_PATTERN)) {
    pushEntity(entities, match[1], "POLICY", "文件");
  }
  for (const match of text.matchAll(COMPANY_PATTERN)) {
    const name = match[2].replace(/^(?:网传|据传|传闻|传|消息称)/, "");
    pushEntity(entities, name, "ORG", "主体");
  }
  for (const name of INDICATOR_NAMES) {
    if (text.includes(name)) pushEntity(entities, name, "INDICATOR", "指标");
  }
  for (const name of PRODUCT_NAMES) {
    if (text.includes(name)) pushEntity(entities, name, "PRODUCT", "产品");
  }
  for (const name of LOCATION_NAMES) {
    if (text.includes(name)) pushEntity(entities, name, "LOCATION", "地区");
  }

  return [...entities.values()].slice(0, 12);
}

const EVENT_TYPE_RULES: { type: ArticleEventType; pattern: RegExp }[] = [
  {
    type: "rumor",
    pattern: /据传|传闻|网传|内部人士|消息人士|知情人士|未获.{0,6}确认|尚未证实|未证实|未获证实|未回应|未具名|很快公布/,
  },
  {
    type: "policy",
    pattern: /征求意见|指引|条例|办法|通知|监管|政策|备案|过渡期|新规|修订/,
  },
  {
    type: "company_event",
    pattern: /公告|增资|财报|营收|净利润|股东|回购|订单|子公司|澄清|回应|分红|募资/,
  },
  {
    type: "macro_data",
    pattern: /GDP|CPI|PPI|PMI|社融|统计局|增加值|贡献率|经济数据/,
  },
  {
    type: "market_move",
    pattern: /汇率|美元指数|报价|升破|跌破|成交|指数|上涨|下跌|走强|走弱/,
  },
  {
    type: "industry_survey",
    pattern: /调研|排产|招标|库存|开工率|产业链|简报|产能/,
  },
];

export function classifyEventType(text: string): ArticleEventType {
  // 澄清/否认本身往往包含“传闻”字样，必须先判否认，否则会被误判成传闻
  if (/澄清|否认|不实|未签署|未获.{0,6}订单/.test(text)) return "company_event";
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return "other";
}

/** 指标归一化：把“增长的贡献率”“对 GDP 的贡献率”归到同一个可比较的指标键 */
const INDICATOR_KEYS: { key: string; pattern: RegExp }[] = [
  { key: "贡献率", pattern: /贡献率/ },
  { key: "过渡期", pattern: /过渡期/ },
  { key: "订单金额", pattern: /订单/ },
  { key: "GDP增速", pattern: /GDP|经济增长/ },
  { key: "营收", pattern: /营收|营业收入/ },
  { key: "净利润", pattern: /净利润/ },
  { key: "同比", pattern: /同比/ },
  { key: "环比", pattern: /环比/ },
  { key: "占比", pattern: /占比|比重/ },
  { key: "汇率", pattern: /汇率/ },
  { key: "利率", pattern: /利率/ },
  { key: "价格", pattern: /价格|报价/ },
  { key: "金额", pattern: /金额|亿元/ },
];

export function indicatorKeyOf(label: string, _context?: string): string | null {
  // 只按指标名归一化。用整句上下文匹配会把同一句里出现的其他指标也算进来，
  // 例如“GDP 增长 4.8%，服务业贡献率超过六成”会把 4.8% 误归到“贡献率”。
  for (const rule of INDICATOR_KEYS) {
    if (rule.pattern.test(label)) return rule.key;
  }
  return null;
}

const NUMBER_PATTERN =
  /([\u4e00-\u9fa5A-Za-z]{0,12})?\s*(-?\d+(?:\.\d+)?)\s*(%|％|亿元|万元|亿|万|个百分点|个月|年|倍|点)/g;

function cleanLabel(prefix: string): string {
  let label = prefix.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "");
  label = label.replace(
    /(?:约为|约|近|超过|超|达到|达|至|为|是|在|增长|下降|上升|回落|提高|减少|增加|同比|环比)+$/g,
    "",
  );
  label = label.replace(
    /^(?:同比|环比|约|近|超|达到|为|是|在|增长|下降|上升|回落|提高|减少|增加|的|了|共|将|已|至)+/g,
    "",
  );
  return label.slice(-8) || "数值";
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf("。", index) + 1,
    text.lastIndexOf("；", index) + 1,
    text.lastIndexOf("！", index) + 1,
  );
  const ends = ["。", "；", "！", "？"].map((mark) => {
    const found = text.indexOf(mark, index);
    return found === -1 ? text.length : found + 1;
  });
  const end = Math.min(...ends);
  return text.slice(start, Math.min(end, start + 120)).trim();
}

export function extractKeyNumbers(text: string): KeyNumber[] {
  const normalized = toHalfWidth(text);
  const results: KeyNumber[] = [];
  const seen = new Set<string>();

  for (const match of normalized.matchAll(NUMBER_PATTERN)) {
    const value = Number(match[2]);
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) continue;
    const unit = match[3] === "％" ? "%" : match[3];
    const rawLabel = cleanLabel(match[1] ?? "");
    // 同一指标在不同句式里可能带不同前缀（“经济增长的贡献率” vs “贡献率”），
    // 归一化后去重，避免主题页/事件页出现同值多条。
    const canonical = indicatorKeyOf(rawLabel);
    const label = canonical && canonical !== "金额" && canonical !== "价格" ? canonical : rawLabel;
    const context = sentenceAround(normalized, match.index ?? 0);
    const period = /([一二三四]季度|上半年|下半年|全年|\d{4}\s*年(?:\s*\d{1,2}\s*月)?)/.exec(context)?.[1];
    const dedupeKey = `${label}|${value}|${unit}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    results.push({
      label,
      value,
      unit,
      ...(period ? { period } : {}),
      ...(context ? { context } : {}),
    });
    if (results.length >= 8) break;
  }

  return results;
}

const CLAIM_RULES: { kind: ClaimKind; pattern: RegExp }[] = [
  { kind: "denial", pattern: /澄清|否认|不实|并无/ },
  { kind: "claim", pattern: /据传|传闻|网传|内部人士|消息人士|知情人士|未获.{0,6}确认|尚未证实|未证实/ },
  { kind: "estimate", pattern: /预计|测算|估计|有望|或达|或将|可能为|预计为/ },
  { kind: "opinion", pattern: /认为|分析师|点评|指出|提示|研报|观点/ },
  { kind: "fact", pattern: /公告|发布|显示|数据显示|统计|宣布|披露/ },
];

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？；])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
}

export function extractClaims(input: ExtractInput, sourceName?: string): ArticleClaim[] {
  const text = [input.title, input.summary, input.content ?? ""].join("。");
  const claims: ArticleClaim[] = [];
  const seen = new Set<string>();

  for (const sentence of splitSentences(text)) {
    const rule = CLAIM_RULES.find((item) => item.pattern.test(sentence));
    if (!rule) continue;
    const clipped = sentence.length > 160 ? `${sentence.slice(0, 160)}…` : sentence;
    if (seen.has(clipped)) continue;
    seen.add(clipped);
    claims.push({
      text: clipped,
      kind: rule.kind,
      ...(sourceName ? { sourceName } : {}),
    });
    if (claims.length >= 6) break;
  }

  return claims;
}

/** 文章级抽取入口：规则模式与 LLM 降级共用 */
export function extractArticle(input: ExtractInput): ArticleExtraction {
  const text = `${input.title}。${input.summary}。${input.content ?? ""}`;
  const currency = inferCurrency(text);
  // 事件类型优先看标题：正文里的“备案/公告”等词很容易把增资、财报误判成政策
  const titleType = classifyEventType(input.title);
  const eventType =
    titleType !== "other"
      ? titleType
      : classifyEventType(input.summary) !== "other"
        ? classifyEventType(input.summary)
        : classifyEventType(text);
  return {
    entities: extractEntities(text),
    eventType,
    keyNumbers: extractKeyNumbers(text),
    claims: extractClaims(input, input.sourceName),
    regions: [inferRegion(text)],
    currencies: currency ? [currency] : [],
  };
}
