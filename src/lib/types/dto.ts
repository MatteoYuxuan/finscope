import type {
  Advice,
  ArticleClaim,
  ArticleEventType,
  ChartSpec,
  Citation,
  EventAnalysis,
  ExtractedEntity,
  KeyNumber,
  Sentiment,
  TopicKind,
} from "./domain";

/**
 * 前端共享的 API 返回类型。
 *
 * 这些结构由服务层序列化器（serializeArticle / serializeEvent 等）产出，
 * 与规则引擎内部使用的 *Like 类型不同：`id` 必定存在、日期已转成 ISO 字符串、
 * 关联对象已展开。页面只依赖这里的类型，避免把服务端模块（含 Prisma）打进客户端包。
 */

export interface ArticleDTO {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  url: string | null;
  publishedAt: string;
  source: { id: string; name: string; credibility: number; kind: string };
  region: string;
  currency: string | null;
  sentiment: Sentiment | string;
  impactDims: string[];
  qualityScore: number;
  qualityFlags: string[];
  eventId: string | null;
  entities: ExtractedEntity[];
  eventType: ArticleEventType;
  keyNumbers: KeyNumber[];
  claims: ArticleClaim[];
  extractionMode: string;
  topics: { slug: string; name: string; kind: TopicKind; score: number; hits: string[] }[];
}

export interface EventDTO {
  id: string;
  signature: string;
  title: string;
  summary: string;
  themes: string[];
  industries: string[];
  regions: string[];
  currencies: string[];
  sentiment: string;
  articleCount: number;
  sourceCount: number;
  credibility: number;
  completeness: number;
  eventType: ArticleEventType;
  entities: ExtractedEntity[];
  analysisMode: string;
  analysisAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SourceDTO {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  enabled: boolean;
  isSample: boolean;
  credibility: number;
  topicHint: string | null;
  lastFetchedAt: string | null;
  lastStatus: string;
  lastError: string | null;
  articleCount: number;
}

export interface TopicDTO {
  id: string;
  slug: string;
  name: string;
  kind: TopicKind;
  kindLabel: string;
  keywords: string[];
  followed: boolean;
  color: string;
  articleCount: number;
  lastArticleAt: string | null;
}

export interface TimelineDTO {
  topic: { id: string; slug: string; name: string; kind: TopicKind; followed: boolean; color: string };
  days: { date: string; items: ArticleDTO[] }[];
  events: { id: string; title: string; articleCount: number; credibility: number; lastSeenAt: string }[];
  stats: { articleCount: number; eventCount: number; windowDays: number };
}

export interface EventDetailDTO {
  event: EventDTO;
  articles: ArticleDTO[];
  /** 事件级结论：共识、分歧、时间线、信息缺口；规则模式也会返回 */
  analysis: EventAnalysis | null;
  analysisMeta: {
    mode: string;
    cached: boolean;
    fallbackReason: string | null;
  } | null;
  credibilityNote: string;
}

export interface ChatHistoryItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  mode: string;
  createdAt: string;
  /** 结构化建议：动作、配置比例、步骤、风险 */
  advice: Advice | null;
  /** 结构化回答：可执行的信息核对动作 */
  todos: string[];
  /** 结构化回答：该轮选择的可视化（chart spec） */
  visuals: ChartSpec[];
}

/** GET /api/visuals 的返回结构 */
export interface VisualsPayload {
  scope: string;
  visuals: ChartSpec[];
  note: string;
  candidateCount: number;
}
