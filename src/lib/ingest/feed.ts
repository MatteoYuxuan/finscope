/**
 * 信息源抓取：支持 RSS 2.0、Atom 1.0 与常见 JSON 结构。
 * 只做“取回并规范化”，不做任何投资相关判断；失败时抛出带原因的错误，由上层记录到 Source.lastError。
 */

export type FeedFormat = "rss" | "atom" | "json";

export interface FeedItem {
  title: string;
  summary: string;
  content: string | null;
  url: string | null;
  publishedAt: Date;
}

export interface FeedFetchResult {
  format: FeedFormat;
  items: FeedItem[];
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => ENTITY_MAP[name] ?? match);
}

function stripHtml(input: string): string {
  return decodeEntities(
    input
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(block: string, tags: string[]): string | null {
  for (const tag of tags) {
    const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
    if (match?.[1]) return match[1];
  }
  return null;
}

function pickLink(block: string): string | null {
  const plain = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (plain?.[1] && !plain[1].includes("<")) {
    const value = stripHtml(plain[1]);
    if (/^https?:\/\//i.test(value)) return value;
  }
  const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (href?.[1]) return decodeEntities(href[1]);
  const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
  if (guid?.[1] && /^https?:\/\//i.test(stripHtml(guid[1]))) return stripHtml(guid[1]);
  return null;
}

function parseDate(raw: string | null): Date {
  if (!raw) return new Date();
  const value = stripHtml(raw);
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) return new Date(timestamp);
  return new Date();
}

function textOf(block: string, tags: string[]): string {
  const raw = pickTag(block, tags);
  return raw ? stripHtml(raw) : "";
}

export function parseFeedXml(xml: string): FeedFetchResult {
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const format: FeedFormat = isAtom ? "atom" : "rss";
  const blocks = isAtom
    ? xml.split(/<entry[\s>]/i).slice(1).map((part) => `<entry ${part}`)
    : xml.split(/<item[\s>]/i).slice(1).map((part) => `<item ${part}`);

  const items: FeedItem[] = [];
  for (const block of blocks.slice(0, 40)) {
    const title = textOf(block, ["title"]);
    if (!title) continue;
    const summary = textOf(block, ["description", "summary", "content"]);
    const content = textOf(block, ["content:encoded", "content"]) || summary;
    const url = pickLink(block);
    const publishedAt = parseDate(pickTag(block, ["pubDate", "published", "updated", "dc:date"]));
    items.push({
      title,
      summary: summary.slice(0, 500) || title,
      content: content ? content.slice(0, 4000) : null,
      url,
      publishedAt,
    });
  }
  return { format, items };
}

interface JsonRecord {
  title?: unknown;
  name?: unknown;
  headline?: unknown;
  summary?: unknown;
  description?: unknown;
  abstract?: unknown;
  content?: unknown;
  body?: unknown;
  url?: unknown;
  link?: unknown;
  publishedAt?: unknown;
  pubDate?: unknown;
  date?: unknown;
  time?: unknown;
}

function pickString(record: JsonRecord, keys: (keyof JsonRecord)[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function parseFeedJson(payload: unknown): FeedFetchResult {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { items?: unknown })?.items)
      ? ((payload as { items: unknown[] }).items)
      : Array.isArray((payload as { data?: unknown })?.data)
        ? ((payload as { data: unknown[] }).data)
        : Array.isArray((payload as { articles?: unknown })?.articles)
          ? ((payload as { articles: unknown[] }).articles)
          : [];

  const items: FeedItem[] = [];
  for (const entry of list.slice(0, 40)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as JsonRecord;
    const title = pickString(record, ["title", "name", "headline"]);
    if (!title) continue;
    const summary = pickString(record, ["summary", "description", "abstract", "content", "body"]);
    const url = pickString(record, ["url", "link"]);
    const rawDate = pickString(record, ["publishedAt", "pubDate", "date", "time"]);
    items.push({
      title,
      summary: summary.slice(0, 500) || title,
      content: summary ? summary.slice(0, 4000) : null,
      url: url && /^https?:\/\//i.test(url) ? url : null,
      publishedAt: parseDate(rawDate || null),
    });
  }
  return { format: "json", items };
}

export class FeedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "FeedError";
    this.reason = reason;
  }
}

/** 抓取并解析单个信息源；超时、非 2xx、空内容都会抛出 FeedError */
export async function fetchFeed(
  source: { name: string; kind: string; url: string | null },
  timeoutMs = 10_000,
): Promise<FeedFetchResult> {
  if (!source.url) throw new FeedError("该信息源没有配置 URL");
  if (!/^https?:\/\//i.test(source.url)) throw new FeedError("信息源 URL 必须以 http(s):// 开头");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(source.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "FinScope/1.0 (+local research workspace)",
        accept: "application/rss+xml, application/atom+xml, application/json, application/xml, text/xml, */*",
      },
      cache: "no-store",
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new FeedError(aborted ? `请求超时（${timeoutMs}ms）` : `网络请求失败：${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new FeedError(`信息源返回 HTTP ${response.status}`);

  const body = await response.text();
  if (!body.trim()) throw new FeedError("信息源返回了空内容");
  if (body.length > 5_000_000) throw new FeedError("信息源内容超过 5MB，已跳过");

  const contentType = response.headers.get("content-type") ?? "";
  const looksJson = contentType.includes("json") || /^\s*[[{]/.test(body);
  const parsed = looksJson ? parseFeedJson(safeJson(body)) : parseFeedXml(body);
  if (parsed.items.length === 0) throw new FeedError("没有解析到任何条目，请确认地址是 RSS / Atom / JSON");
  return parsed;
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new FeedError("返回内容不是合法 JSON");
  }
}
