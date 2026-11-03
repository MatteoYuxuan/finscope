/**
 * 文本相似度与归一化：聚类、去重、检索共用。
 * 纯函数、无 Node 依赖，可在浏览器与测试环境中直接运行。
 */

const STOP_WORDS = [
  "据悉",
  "记者",
  "今日",
  "昨日",
  "重磅",
  "快讯",
  "消息",
  "报道",
  "表示",
  "认为",
  "显示",
  "发布",
  "宣布",
  "相关",
  "进行",
  "以及",
  "已经",
  "目前",
  "可以",
  "我们",
  "公司",
];

const PUNCTUATION = /[\s，。、；：！？""''（）《》【】〈〉…—\-·,.!?;:'"()\[\]{}<>|/\\@#$%^&*_+=~`]/g;

/** 全角 → 半角（数字、字母、常见标点） */
export function toHalfWidth(input: string): string {
  return input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, " ");
}

/** 标题归一化：去标点、去停用词、去纯数字、转小写 */
export function normalizeTitle(input: string): string {
  let text = toHalfWidth(input).toLowerCase();
  text = text.replace(PUNCTUATION, "");
  for (const word of STOP_WORDS) {
    text = text.split(word).join("");
  }
  // 去掉孤立的数字串（保留“5%”这类带单位的信息由 sentiment/quality 处理）
  text = text.replace(/\d{2,}/g, "");
  return text.trim();
}

const CJK = /[\u4e00-\u9fa5]/;

/**
 * 分词：中文按 2-gram，英文/数字按词切分。
 * 例："人民币汇率走强" → ["人民","民币","币汇","汇率","率走","走强"]
 */
export function tokenize(input: string): string[] {
  const text = normalizeTitle(input);
  const tokens: string[] = [];
  let latinBuffer = "";

  const flushLatin = () => {
    if (latinBuffer.length >= 2) tokens.push(latinBuffer);
    latinBuffer = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (CJK.test(ch)) {
      flushLatin();
      const next = text[i + 1];
      if (next && CJK.test(next)) tokens.push(ch + next);
    } else if (/[a-z0-9]/.test(ch)) {
      latinBuffer += ch;
    } else {
      flushLatin();
    }
  }
  flushLatin();
  return tokens;
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const setA = a instanceof Set ? a : new Set(a);
  const setB = b instanceof Set ? b : new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 重合系数（containment / overlap coefficient）：|A∩B| / min(|A|,|B|)。
 * 标题长短不一时，Jaccard 会被长标题稀释；新闻标题去重更关心“短标题是否被长标题覆盖”。
 */
export function overlapCoefficient(a: Iterable<string>, b: Iterable<string>): number {
  const setA = a instanceof Set ? a : new Set(a);
  const setB = b instanceof Set ? b : new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  return intersection / Math.min(setA.size, setB.size);
}

export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

/** 余弦相似度（按词频向量，调用方可先做 IDF 加权） */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, value] of a) normA += value * value;
  for (const [key, value] of b) {
    normB += value * value;
    const left = a.get(key);
    if (left) dot += left * value;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 计算 IDF（log(N/df)），用于降低高频词权重 */
export function buildIdf(documents: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const total = documents.length || 1;
  const idf = new Map<string, number>();
  for (const [token, count] of df) idf.set(token, Math.log((total + 1) / (count + 0.5)));
  return idf;
}

export function applyIdf(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const weighted = new Map<string, number>();
  for (const [token, value] of tf) {
    weighted.set(token, value * (idf.get(token) ?? 1));
  }
  return weighted;
}

export function overlap<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter((item) => setB.has(item));
}

/** 稳定哈希（FNV-1a 32bit + 二次混洗），用于 contentHash / event signature */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ code, 0x85ebca6b) + i) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16);
}

export function topKeywords(tokens: string[], size = 5): string[] {
  const tf = termFrequency(tokens);
  return [...tf.entries()]
    .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
    .slice(0, size)
    .map(([token]) => token);
}

/** 中文摘要截断：按句号/分号切，保留完整句子 */
export function truncateSentences(text: string, maxLength = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const parts = clean.split(/(?<=[。！？；])/);
  let result = "";
  for (const part of parts) {
    if ((result + part).length > maxLength) break;
    result += part;
  }
  return result.length > 0 ? result : `${clean.slice(0, maxLength)}…`;
}

export function countMatches(text: string, keywords: string[]): { hits: string[]; count: number } {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (lower.includes(keyword.toLowerCase())) hits.push(keyword);
  }
  return { hits, count: hits.length };
}
