import { prisma } from "@/lib/db";
import { ASSET_CATEGORY_META, LIABILITY_CATEGORY_META } from "@/lib/constants";
import { sanitizeAdvice } from "@/lib/llm/advice-scope";
import { mockChat, mockVisualSelect, type VisualSelectOutput } from "@/lib/llm/mock";
import { CHAT_SCHEMA, llmMetaToApi, runTask } from "@/lib/llm/provider";
import { rankPassages, toCitations, type Passage, type RankedPassage } from "@/lib/llm/retrieve";
import { buildRuleAdvice } from "@/lib/rules/advice";
import { formatCny, formatCompactYuan, formatPercent } from "@/lib/rules/money";
import type {
  Advice,
  AssetCategory,
  ChartSpec,
  Citation,
  ExposureItem,
  LiabilityCategory,
  LLMMode,
  RiskBand,
} from "@/lib/types/domain";
import { describeCandidates } from "@/lib/visuals/catalog";
import { loadPortfolio, loadCheckup, getLatestRiskProfile } from "./portfolio";
import { loadExposure } from "./report";
import { getChatCandidates } from "./visuals";
import { getLLMMode } from "./settings";

export interface ChatAnswer {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  /** 可执行的结构建议（配置方向、步骤、风险） */
  advice: Advice;
  /** 执行后的核对动作（不是交易指令） */
  todos: string[];
  /** 与问题相关的图表，由问答结果里的 candidateId 回填数据 */
  visuals: ChartSpec[];
  mode: LLMMode;
  degraded: boolean;
  degradeReason?: string;
  matchedPassages: number;
}

async function buildPassages(): Promise<{ passages: Passage[]; portfolio: Awaited<ReturnType<typeof loadPortfolio>> }> {
  const portfolio = await loadPortfolio();
  const [articles, events] = await Promise.all([
    prisma.article.findMany({
      include: { source: { select: { name: true, credibility: true } } },
      orderBy: { publishedAt: "desc" },
      take: 60,
    }),
    prisma.event.findMany({ orderBy: { lastSeenAt: "desc" }, take: 10 }),
  ]);

  const passages: Passage[] = [];

  for (const article of articles) {
    passages.push({
      id: `article:${article.id}`,
      type: "article",
      label: article.title,
      text: `${article.summary}${article.content ? ` ${article.content.slice(0, 260)}` : ""}`,
      meta: {
        sourceName: article.source.name,
        publishedAt: article.publishedAt.toISOString().slice(0, 10),
        region: article.region,
      },
    });
  }

  for (const event of events) {
    passages.push({
      id: `event:${event.id}`,
      type: "event",
      label: event.title,
      text: `${event.summary}（${event.articleCount} 条报道 / ${event.sourceCount} 个来源，可信度 ${event.credibility}/100）`,
      meta: { sourceCount: String(event.sourceCount) },
    });
  }

  for (const asset of portfolio.assets) {
    const meta = ASSET_CATEGORY_META[asset.category as AssetCategory] ?? ASSET_CATEGORY_META.OTHER;
    passages.push({
      id: `asset:${asset.id}`,
      type: "asset",
      label: `${asset.name}（${meta.label}）`,
      text: `金额 ${formatCompactYuan(asset.amount)} ${asset.currency}，流动性 ${asset.liquidity ?? meta.liquidity}${
        asset.industry ? `，行业标签 ${asset.industry}` : ""
      }${asset.maturityMonths ? `，剩余期限 ${asset.maturityMonths} 个月` : ""}${asset.note ? `，备注：${asset.note}` : ""}`,
      meta: { currency: asset.currency, category: meta.label },
    });
  }

  for (const liability of portfolio.liabilities) {
    const meta = LIABILITY_CATEGORY_META[liability.category as LiabilityCategory] ?? LIABILITY_CATEGORY_META.OTHER;
    passages.push({
      id: `liability:${liability.id}`,
      type: "liability",
      label: `${liability.name}（${meta.label}）`,
      text: `余额 ${formatCompactYuan(liability.amount)} ${liability.currency}${
        typeof liability.interestRate === "number" ? `，年化利率 ${liability.interestRate}%` : ""
      }${typeof liability.monthlyPayment === "number" ? `，月供 ${formatCompactYuan(liability.monthlyPayment)}` : ""}${
        typeof liability.remainingMonths === "number" ? `，剩余 ${liability.remainingMonths} 个月` : ""
      }`,
      meta: { currency: liability.currency, category: meta.label },
    });
  }

  const metrics = portfolio.metrics;
  passages.push({
    id: "metric:overview",
    type: "metric",
    label: "我的资产结构指标",
    text: [
      `总资产 ${formatCny(metrics.totalAssetsCny)}，总负债 ${formatCny(metrics.totalLiabilitiesCny)}，净资产 ${formatCny(metrics.netWorthCny)}。`,
      `负债率 ${formatPercent(metrics.debtRatio)}，最大类别占比 ${formatPercent(metrics.topCategoryShare)}，HHI ${metrics.hhi.toFixed(3)}。`,
      `外币资产占比 ${formatPercent(metrics.foreignShare)}，权益类占比 ${formatPercent(metrics.equityShare)}，长期资产占比 ${formatPercent(metrics.longTermShare)}。`,
      `应急金 ${metrics.emergencyMonths === null ? "未设置月必要支出，无法计算" : `${metrics.emergencyMonths} 个月`}，信息完整度 ${metrics.completeness}%。`,
    ].join(""),
    meta: {},
  });

  return { passages, portfolio };
}

function citationOf(item: RankedPassage): Citation {
  return {
    type: item.passage.type,
    id: item.passage.id,
    label: item.passage.label,
    snippet: item.passage.text.slice(0, 140),
    ...(item.passage.meta ? { meta: item.passage.meta } : {}),
  };
}

function defaultAdvice(question: string): Advice {
  return {
    action: "HOLD",
    summary: "先补充资产与负债记录，再根据结构指标给出调整方向。",
    allocations: [],
    steps: [
      { step: "到「资产录入」补全类别、币种与期限", priority: "high", rationale: "结构建议依赖完整的数据" },
      { step: "完成一次结构体检与风险问卷", priority: "medium", rationale: "用于校准目标比例" },
    ],
    risks: ["数据不完整时，建议可能偏离你的实际情况。"],
    confidence: "low",
    horizon: "medium",
    ...(/\b(?:60|68|00|30|43|83|87)\d{4}\b|目标价|止损位/.test(question)
      ? { scopeNote: "具体标的、目标价与点位不在本工具的建议范围；以上为配置与结构层面的建议。" }
      : {}),
  };
}

/**
 * 问答主流程：BM25 检索 → 规则建议 → LLM/模板 → 范围收敛 → 引用回填 → 落库。
 * 建议以配置与结构为主，不点名个股、不给目标价；引用只来自本地已导入的数据。
 */
export async function askQuestion(question: string): Promise<ChatAnswer> {
  const mode = await getLLMMode();
  const { passages, portfolio } = await buildPassages();
  const ranked = rankPassages(question, passages, 8);
  const chatCandidates = await getChatCandidates();

  const [checkupState, riskProfile, exposureState] = await Promise.all([
    loadCheckup(),
    getLatestRiskProfile(),
    loadExposure().catch(() => ({ exposure: [] as ExposureItem[], topics: [] })),
  ]);
  const findings = checkupState.checkup.findings;
  const riskBand: RiskBand = riskProfile?.band ?? "BALANCED";
  const exposure = exposureState.exposure;
  const ruleAdvice = buildRuleAdvice({
    question,
    metrics: portfolio.metrics,
    findings,
    riskBand,
    riskScore: riskProfile?.score,
    exposure,
    monthlySpend: portfolio.metrics.monthlySpend,
  });

  // 连续追问需要上下文：取最近 8 条消息（不含本条），按时间正序传给模型。
  const recent = await prisma.chatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { role: true, content: true },
  });
  const history: { role: "user" | "assistant"; content: string }[] = recent
    .reverse()
    .map((row) => ({
      role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: row.content.slice(0, 320),
    }));

  const result = await runTask({
    task: "chat",
    mode,
    payload: {
      question,
      today: new Date().toISOString().slice(0, 10),
      passages: ranked.map((item, index) => ({
        index: index + 1,
        id: item.passage.id,
        type: item.passage.type,
        label: item.passage.label,
        text: item.passage.text.slice(0, 420),
        sourceName: item.passage.meta?.sourceName ?? null,
        publishedAt: item.passage.meta?.publishedAt ?? null,
      })),
      metrics: {
        assetCount: portfolio.metrics.assetCount,
        totalAssetsCny: portfolio.metrics.totalAssetsCny,
        totalLiabilitiesCny: portfolio.metrics.totalLiabilitiesCny,
        netWorthCny: portfolio.metrics.netWorthCny,
        debtRatio: portfolio.metrics.debtRatio,
        foreignShare: portfolio.metrics.foreignShare,
        topCategoryShare: portfolio.metrics.topCategoryShare,
        equityShare: portfolio.metrics.equityShare,
        longTermShare: portfolio.metrics.longTermShare,
        hhi: portfolio.metrics.hhi,
        emergencyMonths: portfolio.metrics.emergencyMonths,
        completeness: portfolio.metrics.completeness,
      },
      liabilityCount: portfolio.liabilities.length,
      liabilityMonthlyPayment: portfolio.liabilities.reduce((sum, item) => sum + (item.monthlyPayment ?? 0), 0),
      riskProfile: riskProfile ? { score: riskProfile.score, band: riskProfile.band } : null,
      findings: findings.slice(0, 6).map((item) => ({
        level: item.level,
        title: item.title,
        detail: item.detail,
        evidence: item.evidence,
      })),
      exposure: exposure.slice(0, 5).map((item) => ({
        topic: item.topic.name,
        share: Number(item.exposureShare.toFixed(4)),
        note: item.note,
      })),
      ruleAdvice,
      visualCandidates: describeCandidates(chatCandidates.candidates),
    },
    schema: CHAT_SCHEMA,
    history,
    fallback: () =>
      mockChat({
        question,
        passages: ranked,
        metrics: portfolio.metrics,
        findings,
        riskBand,
        exposure,
        monthlySpend: portfolio.metrics.monthlySpend,
      }),
  });

  const byId = new Map(ranked.map((item) => [item.passage.id, item]));
  const citations: Citation[] =
    result.data.citedIds.length > 0
      ? result.data.citedIds
          .map((id) => byId.get(id))
          .filter((item): item is RankedPassage => Boolean(item))
          .map(citationOf)
      : toCitations(ranked).slice(0, 3).map((citation, index) => ({
          ...citation,
          label: `${index + 1}. ${citation.label.replace(/^\d+\.\s*/, "")}`,
        }));

  const chosenAdvice = result.data.advice ?? ruleAdvice ?? defaultAdvice(question);
  const { advice } = sanitizeAdvice(chosenAdvice);

  const todos =
    result.data.todos && result.data.todos.length > 0
      ? result.data.todos.slice(0, 4)
      : [
          citations[0] ? `核对「${citations[0].label}」的原文与发布时间` : "核对引用资讯的原文与发布时间",
          portfolio.metrics.completeness < 80
            ? "到「资产录入」补全缺失的类别或期限字段"
            : "到「结构分析」查看调整后的结构指标变化",
        ];

  const candidateById = new Map(chatCandidates.candidates.map((candidate) => [candidate.id, candidate]));
  const pickedIds = (result.data.visualCandidateIds ?? []).filter((id) => candidateById.has(id)).slice(0, 3);
  let chosen: VisualSelectOutput["selected"] = pickedIds.map((id) => ({
    candidateId: id,
    reason: candidateById.get(id)?.rationale ?? "",
  }));
  if (chosen.length === 0) {
    chosen = mockVisualSelect({
      candidates: describeCandidates(chatCandidates.candidates),
      context: `用户问题：${question}`,
      max: 2,
    }).selected;
  }
  const seen = new Set<string>();
  const visuals: ChartSpec[] = [];
  for (const item of chosen) {
    if (seen.has(item.candidateId)) continue;
    const candidate = candidateById.get(item.candidateId);
    if (!candidate) continue;
    seen.add(item.candidateId);
    visuals.push({ ...candidate.spec, rationale: item.reason || candidate.spec.rationale });
    if (visuals.length >= 3) break;
  }

  await prisma.chatMessage.create({ data: { role: "user", content: question, mode: result.meta.mode } });
  const row = await prisma.chatMessage.create({
    data: {
      role: "assistant",
      content: result.data.answer,
      citations: JSON.stringify(citations),
      payload: JSON.stringify({ todos, visuals, advice }),
      mode: result.meta.mode,
    },
  });

  return {
    id: row.id,
    question,
    answer: result.data.answer,
    citations,
    advice,
    todos,
    visuals,
    mode: result.meta.mode,
    degraded: result.meta.degraded,
    ...(result.meta.reason ? { degradeReason: result.meta.reason } : {}),
    matchedPassages: ranked.length,
  };
}

export interface ChatHistoryItem {
  id: string;
  role: string;
  content: string;
  citations: Citation[];
  mode: string;
  createdAt: string;
  advice: Advice | null;
  todos: string[];
  visuals: ChartSpec[];
}

function parsePayload(raw: string | null): { todos: string[]; visuals: ChartSpec[]; advice: Advice | null } {
  if (!raw) return { todos: [], visuals: [], advice: null };
  try {
    const parsed = JSON.parse(raw) as { todos?: unknown; visuals?: unknown; advice?: unknown };
    return {
      todos: Array.isArray(parsed.todos) ? parsed.todos.filter((item): item is string => typeof item === "string") : [],
      visuals: Array.isArray(parsed.visuals) ? (parsed.visuals as ChartSpec[]) : [],
      advice:
        parsed.advice && typeof parsed.advice === "object" && "action" in (parsed.advice as Record<string, unknown>)
          ? (parsed.advice as Advice)
          : null,
    };
  } catch {
    return { todos: [], visuals: [], advice: null };
  }
}

export async function listChatHistory(limit = 40): Promise<ChatHistoryItem[]> {
  const rows = await prisma.chatMessage.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 100) });
  return rows.reverse().map((row) => {
    let citations: Citation[] = [];
    try {
      const parsed = JSON.parse(row.citations);
      if (Array.isArray(parsed)) citations = parsed as Citation[];
    } catch {
      citations = [];
    }
    const payload = parsePayload(row.payload);
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      citations,
      mode: row.mode,
      createdAt: row.createdAt.toISOString(),
      advice: payload.advice,
      todos: payload.todos,
      visuals: payload.visuals,
    };
  });
}

export async function clearChatHistory(): Promise<number> {
  const result = await prisma.chatMessage.deleteMany();
  return result.count;
}

export { llmMetaToApi };
