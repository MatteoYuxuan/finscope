import type { Citation } from "@/lib/types/domain";
import { tokenize } from "@/lib/rules/text";

export interface Passage {
  id: string;
  type: Citation["type"];
  label: string;
  text: string;
  /** 用于前端展示的补充信息，如来源、时间 */
  meta?: Record<string, string>;
}

export interface RankedPassage {
  passage: Passage;
  score: number;
  matchedTerms: string[];
}

const K1 = 1.5;
const B = 0.75;

/**
 * BM25 检索（RAG-lite）：
 * 中文用 bigram、英文用词，无需向量库；评分可解释，答辩时能说清“为什么引用这条”。
 */
export function rankPassages(query: string, passages: Passage[], topK = 5): RankedPassage[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || passages.length === 0) return [];

  const docs = passages.map((passage) => {
    const tokens = tokenize(`${passage.label} ${passage.text}`);
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    return { passage, tf, length: tokens.length };
  });

  const avgLength = docs.reduce((acc, doc) => acc + doc.length, 0) / docs.length || 1;
  const docFreq = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const doc of docs) if (doc.tf.has(term)) count += 1;
    docFreq.set(term, count);
  }

  const ranked: RankedPassage[] = [];
  for (const doc of docs) {
    let score = 0;
    const matchedTerms: string[] = [];
    for (const term of queryTerms) {
      const freq = doc.tf.get(term) ?? 0;
      if (freq === 0) continue;
      matchedTerms.push(term);
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      const denom = freq + K1 * (1 - B + (B * doc.length) / avgLength);
      score += idf * ((freq * (K1 + 1)) / denom);
    }
    if (score > 0) ranked.push({ passage: doc.passage, score, matchedTerms });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** 把命中的段落转成统一引用结构（前端展示 [1][2] 用同一顺序） */
export function toCitations(ranked: RankedPassage[]): Citation[] {
  return ranked.map((item, index) => ({
    type: item.passage.type,
    id: item.passage.id,
    label: `${index + 1}. ${item.passage.label}`,
    snippet: item.passage.text.slice(0, 140),
  }));
}
