import { THRESHOLDS } from "@/lib/constants";
import type {
  ArticleCluster,
  ArticleEventType,
  ArticleLike,
  ClaimKind,
  ClusterExplain,
  EntityType,
  Sentiment,
  TopicKind,
} from "@/lib/types/domain";
import {
  applyIdf,
  buildIdf,
  cosineSimilarity,
  hashString,
  jaccard,
  normalizeTitle,
  overlap,
  overlapCoefficient,
  termFrequency,
  tokenize,
  topKeywords,
} from "./text";
import { analyzeSentiment } from "./sentiment";

export interface ClusterInput extends ArticleLike {
  sourceId?: string;
  sourceName?: string;
  sourceCredibility?: number;
  sentiment?: Sentiment;
  region?: string | null;
  currency?: string | null;
  topics?: { slug: string; name: string; score: number; kind?: TopicKind }[];
  /** 文章级抽取结果：实体用于识别“同一主体”的不同报道 */
  entities?: { name: string; type: EntityType }[];
  eventType?: ArticleEventType;
  claims?: { kind: ClaimKind; text?: string }[];
}

interface Prepared {
  item: ClusterInput;
  index: number;
  tokens: string[];
  tokenSet: Set<string>;
  titleSet: Set<string>;
  entitySet: Set<string>;
  entityNames: Map<string, string>;
  eventType: ArticleEventType;
  hasDenial: boolean;
  weighted: Map<string, number>;
  publishedMs: number;
}

/** 只有强实体参与“同一事件”判断；地区、人物噪声较大 */
const STRONG_ENTITY_TYPES: EntityType[] = ["ORG", "POLICY", "INDICATOR", "PRODUCT"];

function strongEntityMap(item: ClusterInput): Map<string, string> {
  const map = new Map<string, string>();
  for (const entity of item.entities ?? []) {
    if (!STRONG_ENTITY_TYPES.includes(entity.type)) continue;
    const key = entity.name.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, entity.name.trim());
  }
  return map;
}

export interface ClusterOptions {
  jaccardThreshold?: number;
  cosineThreshold?: number;
  windowHours?: number;
}

/** 文章去重键：来源 + 归一化标题 + 日期（同源同日同标题视为重复） */
export function contentHashOf(input: {
  sourceId?: string;
  title: string;
  publishedAt: Date | string;
}): string {
  const date = new Date(input.publishedAt);
  const day = Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
  return hashString(`${input.sourceId ?? "unknown"}|${normalizeTitle(input.title)}|${day}`);
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 事件聚类（代表元 + 收敛合并）：
 * 1) 标题/正文归一化后取中文 bigram 与英文词；
 * 2) 相似度 = 标题重合系数 ≥ 0.42，或正文 Jaccard ≥ 0.42，或余弦(TF-IDF) ≥ 0.55；
 * 3) 实体规则：共享强实体且重合系数 ≥ 0.7，并且事件类型相同（或“传闻 ↔ 公司澄清/否认”）；
 * 4) 时间窗 ≤ 72 小时，且主题有交集（双方都有主题时）；
 * 5) 贪心分配后再做收敛合并：同一事件的不同措辞可能先各自成簇，只要两簇间存在
 *    一对成员满足上述条件就合并，避免“先到的短标题与后到的长标题永远见不到面”。
 */
export function clusterArticles(
  items: ClusterInput[],
  options: ClusterOptions = {},
): ArticleCluster[] {
  if (items.length === 0) return [];

  const jaccardThreshold = options.jaccardThreshold ?? THRESHOLDS.cluster.jaccard;
  const cosineThreshold = options.cosineThreshold ?? THRESHOLDS.cluster.cosine;
  const windowHours = options.windowHours ?? THRESHOLDS.cluster.windowHours;
  const windowMs = windowHours * 36e5;

  const prepared: Prepared[] = items.map((item, index) => {
    const tokens = tokenize(`${item.title} ${item.summary ?? ""}`);
    const entityNames = strongEntityMap(item);
    return {
      item,
      index,
      tokens,
      tokenSet: new Set(tokens),
      titleSet: new Set(tokenize(item.title)),
      entitySet: new Set(entityNames.keys()),
      entityNames,
      eventType: item.eventType ?? "other",
      hasDenial: (item.claims ?? []).some((claim) => claim.kind === "denial"),
      weighted: new Map(),
      publishedMs: new Date(item.publishedAt).getTime(),
    };
  });

  const idf = buildIdf(prepared.map((p) => p.tokens));
  for (const p of prepared) p.weighted = applyIdf(termFrequency(p.tokens), idf);

  interface PairSignal {
    similarity: number;
    rule: ClusterExplain["rule"];
    sharedEntities: string[];
  }

  const signalOf = (a: Prepared, b: Prepared): PairSignal | null => {
    const titleOverlap = overlapCoefficient(a.titleSet, b.titleSet);
    const jac = jaccard(a.tokenSet, b.tokenSet);
    const cos = cosineSimilarity(a.weighted, b.weighted);

    const sharedKeys = overlap([...a.entitySet], [...b.entitySet]);
    const entityOverlap = overlapCoefficient(a.entitySet, b.entitySet);
    const sameEventType = a.eventType === b.eventType && a.eventType !== "other";
    const rumorDenial =
      (a.eventType === "rumor" && b.eventType === "company_event" && b.hasDenial) ||
      (b.eventType === "rumor" && a.eventType === "company_event" && a.hasDenial);
    const byEntity =
      sharedKeys.length > 0 &&
      entityOverlap >= THRESHOLDS.cluster.entityOverlap &&
      (sameEventType || rumorDenial);

    const byTitle = titleOverlap >= jaccardThreshold;
    const byJaccard = jac >= jaccardThreshold;
    const byCosine = cos >= cosineThreshold;
    if (!byTitle && !byJaccard && !byCosine && !byEntity) return null;

    let similarity = 0;
    let rule: ClusterExplain["rule"] = "JACCARD";
    if (byTitle) {
      similarity = titleOverlap;
      rule = "TITLE";
    }
    if (byJaccard && jac > similarity) {
      similarity = jac;
      rule = "JACCARD";
    }
    if (byCosine && cos > similarity) {
      similarity = cos;
      rule = "COSINE";
    }
    if (byEntity && entityOverlap > similarity) {
      similarity = entityOverlap;
      rule = "ENTITY";
    }

    return {
      similarity,
      rule,
      sharedEntities: sharedKeys.map((key) => a.entityNames.get(key) ?? key),
    };
  };

  // 新文章优先，保证“代表元”是最新的完整报道
  prepared.sort((a, b) => b.publishedMs - a.publishedMs);

  interface Cluster {
    rep: Prepared;
    members: { prepared: Prepared; explain: ClusterExplain }[];
  }

  const clusters: Cluster[] = [];

  for (const candidate of prepared) {
    let best: { cluster: Cluster; explain: ClusterExplain } | null = null;

    for (const cluster of clusters) {
      // 与簇内任一成员比较：同一事件的不同角度报道，标题用词未必与“代表元”最接近。
      // 阈值保持较高，且受时间窗与主题交集约束，避免链式误并。
      for (const member of cluster.members) {
        const rep = member.prepared;
        const timeGapHours = Math.abs(candidate.publishedMs - rep.publishedMs) / 36e5;
        if (timeGapHours > windowHours) continue;

        const repTopics = rep.item.topics ?? [];
        const candTopics = candidate.item.topics ?? [];
        if (repTopics.length > 0 && candTopics.length > 0) {
          const shared = overlap(
            repTopics.map((t) => t.slug),
            candTopics.map((t) => t.slug),
          );
          if (shared.length === 0) continue;
        }

        const signal = signalOf(candidate, rep);
        if (!signal) continue;

        const explain: ClusterExplain = {
          sharedKeywords: overlap(candidate.tokens, rep.tokens).slice(0, 6),
          sharedEntities: signal.sharedEntities.slice(0, 6),
          similarity: Math.round(signal.similarity * 100) / 100,
          timeGapHours: Math.round(timeGapHours * 10) / 10,
          rule: signal.rule,
        };

        if (!best || explain.similarity > best.explain.similarity) {
          best = { cluster, explain };
        }
      }
    }

    if (best) {
      best.cluster.members.push({ prepared: candidate, explain: best.explain });
      // 代表元原先只有“单篇占位”解释，首次合并后用真实依据替换，
      // 否则事件详情展示的规则与相似度会永远是 1 / JACCARD。
      if (best.cluster.members.length === 2) {
        best.cluster.members[0].explain = best.explain;
      }
    } else {
      clusters.push({
        rep: candidate,
        members: [
          {
            prepared: candidate,
            explain: {
              sharedKeywords: topKeywords(candidate.tokens, 5),
              sharedEntities: [...candidate.entityNames.values()].slice(0, 5),
              similarity: 1,
              timeGapHours: 0,
              rule: "JACCARD",
            },
          },
        ],
      });
    }
  }

  // 同一事件的不同措辞可能先各自成簇，这里做收敛式合并。
  const pairSimilar = (a: Prepared, b: Prepared): boolean => {
    const gapHours = Math.abs(a.publishedMs - b.publishedMs) / 36e5;
    if (gapHours > windowHours) return false;
    const topicsA = a.item.topics ?? [];
    const topicsB = b.item.topics ?? [];
    if (topicsA.length > 0 && topicsB.length > 0) {
      if (overlap(topicsA.map((t) => t.slug), topicsB.map((t) => t.slug)).length === 0) return false;
    }
    return signalOf(a, b) !== null;
  };

  const clustersCanMerge = (left: Cluster, right: Cluster): boolean =>
    left.members.some((m) => right.members.some((n) => pairSimilar(m.prepared, n.prepared)));

  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    outer: for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        if (!clustersCanMerge(clusters[i], clusters[j])) continue;
        // 保留代表元更新的那一簇，标题展示以最新报道为准
        const keepFirst = clusters[i].rep.publishedMs >= clusters[j].rep.publishedMs;
        const keep = keepFirst ? clusters[i] : clusters[j];
        const drop = keepFirst ? clusters[j] : clusters[i];
        keep.members.push(...drop.members);
        clusters.splice(clusters.indexOf(drop), 1);
        didMerge = true;
        break outer;
      }
    }
  }

  return clusters.map((cluster) => buildCluster(cluster.rep, cluster.members));
}

function buildCluster(
  rep: Prepared,
  members: { prepared: Prepared; explain: ClusterExplain }[],
): ArticleCluster {
  const all = members.map((m) => m.prepared.item);
  const times = members.map((m) => m.prepared.publishedMs).filter((ms) => !Number.isNaN(ms));
  const firstSeenAt = new Date(Math.min(...times)).toISOString();
  const lastSeenAt = new Date(Math.max(...times)).toISOString();

  const sourceIds = new Set(all.map((item) => item.sourceId ?? item.sourceName ?? item.title));
  const avgCredibility =
    all.reduce((acc, item) => acc + (item.sourceCredibility ?? 3), 0) / all.length;
  const avgQuality =
    all.reduce((acc, item) => acc + (item.qualityScore ?? 60), 0) / all.length;

  const credibility = clampInt(
    40 * (avgCredibility / 5) + 30 * Math.min(1, (sourceIds.size - 1) / 3) + 30 * (avgQuality / 100),
  );

  const themes = unique(all.flatMap((item) => (item.topics ?? []).map((t) => t.name)));
  const industries = unique(
    all.flatMap((item) => (item.topics ?? []).filter((t) => t.kind === "industry").map((t) => t.name)),
  );
  const regions = unique(all.map((item) => item.region).filter(Boolean) as string[]);
  const currencies = unique(all.map((item) => item.currency).filter(Boolean) as string[]);

  const sentiment = dominantSentiment(
    all.map((item) => item.sentiment ?? analyzeSentiment(`${item.title}${item.summary}`).sentiment),
  );
  const eventType = dominantEventType(all);
  const entities = aggregateEntities(all);

  const completeness = computeCompleteness(all);
  const tokens = topKeywords(members[0].prepared.tokens, 5);
  const signature = hashString(tokens.join("|") || rep.item.title);

  const summarySource = all
    .slice()
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))[0];

  return {
    signature,
    title: rep.item.title,
    summary: buildClusterSummary(rep.item, all.length, sourceIds.size, summarySource.summary),
    members: members.map((m) => ({
      index: m.prepared.index,
      title: m.prepared.item.title,
      publishedAt: new Date(m.prepared.publishedMs).toISOString(),
    })),
    memberIndexes: members.map((m) => m.prepared.index),
    articleCount: all.length,
    sourceCount: sourceIds.size,
    credibility,
    completeness,
    firstSeenAt,
    lastSeenAt,
    themes,
    industries,
    regions,
    currencies,
    sentiment,
    eventType,
    entities,
    explain: members[0].explain,
  };
}

function dominantEventType(items: ClusterInput[]): ArticleEventType {
  const values = items.map((item) => item.eventType ?? "other");
  const counts = new Map<ArticleEventType, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
  // 传闻被公司澄清后，事件性质应展示为“公司事件”，而不是继续标成“传闻”
  const hasDenial = items.some((item) =>
    (item.claims ?? []).some((claim) => claim.kind === "denial"),
  );
  if (hasDenial && values.includes("company_event")) return "company_event";
  return top;
}

function aggregateEntities(items: ClusterInput[]): { name: string; type: EntityType }[] {
  const map = new Map<string, { name: string; type: EntityType }>();
  for (const item of items) {
    for (const entity of item.entities ?? []) {
      const key = entity.name.trim().toLowerCase();
      if (!key || map.has(key)) continue;
      map.set(key, { name: entity.name.trim(), type: entity.type });
    }
  }
  return [...map.values()].slice(0, 12);
}

function buildClusterSummary(
  rep: ClusterInput,
  articleCount: number,
  sourceCount: number,
  detail: string,
): string {
  const scope =
    articleCount > 1
      ? `共 ${articleCount} 条报道、${sourceCount} 个来源，时间跨度 ${Math.max(
          1,
          Math.round(
            (Date.now() - new Date(rep.publishedAt).getTime()) / 36e5,
          ),
        )} 小时内。`
      : "单条来源，尚待更多独立报道交叉印证。";
  return `${scope}${detail}`;
}

function computeCompleteness(items: ClusterInput[]): number {
  const checks = [
    (i: ClusterInput) => Boolean(i.url),
    (i: ClusterInput) => (i.content ?? "").length > 60,
    (i: ClusterInput) => Boolean(i.publishedAt),
    (i: ClusterInput) => Boolean(i.currency),
    (i: ClusterInput) => Boolean(i.region),
    (i: ClusterInput) => (i.topics ?? []).length > 0,
  ];
  let passed = 0;
  let total = 0;
  for (const item of items) {
    for (const check of checks) {
      total += 1;
      if (check(item)) passed += 1;
    }
  }
  return total === 0 ? 0 : Math.round((passed / total) * 100);
}

function dominantSentiment(values: Sentiment[]): Sentiment {
  const counts = new Map<Sentiment, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clampInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export { dayKey };
