import { handleRoute, ok } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { fetchFeed } from "@/lib/ingest/feed";
import { analyzeSentiment } from "@/lib/rules/sentiment";
import { scoreQuality } from "@/lib/rules/quality";
import { hashString, normalizeTitle } from "@/lib/rules/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pull a small, public RSS set for real-world information collection.
 * It is intentionally narrow and best-effort: failures are reported per source
 * and never break the demo. These are public institutional feeds, not scraped
 * paywalled content.
 */
const FEEDS = [
  { name: "美联储新闻稿", url: "https://www.federalreserve.gov/feeds/press_all.xml", credibility: 5, region: "US" },
  { name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", credibility: 3, region: "US" },
];

export async function POST() {
  return handleRoute(async () => {
    const results: { source: string; added: number; skipped: number; error?: string }[] = [];
    for (const feed of FEEDS) {
      let source = await prisma.source.findFirst({ where: { name: feed.name } });
      if (!source) {
        source = await prisma.source.create({
          data: {
            name: feed.name,
            kind: "RSS",
            url: feed.url,
            isSample: false,
            enabled: true,
            credibility: feed.credibility,
          },
        });
      }
      try {
        const parsed = await fetchFeed({ name: feed.name, kind: "RSS", url: feed.url }, 12_000);
        let added = 0;
        let skipped = 0;
        for (const item of parsed.items.slice(0, 12)) {
          const contentHash = hashString(`${source.id}|${normalizeTitle(item.title)}`);
          const exists = await prisma.article.findUnique({ where: { contentHash }, select: { id: true } });
          if (exists) {
            skipped += 1;
            continue;
          }
          const sentiment = analyzeSentiment(`${item.title} ${item.summary}`).sentiment;
          const quality = scoreQuality({
            title: item.title,
            summary: item.summary,
            content: item.content,
            url: item.url,
            publishedAt: item.publishedAt,
            sourceCredibility: feed.credibility,
          });
          await prisma.article.create({
            data: {
              sourceId: source.id,
              title: item.title.slice(0, 300),
              summary: item.summary.slice(0, 800) || item.title.slice(0, 300),
              content: item.content ? item.content.slice(0, 8000) : null,
              url: item.url,
              publishedAt: item.publishedAt,
              region: feed.region,
              currency: feed.region === "US" ? "USD" : null,
              sentiment,
              impactDims: "[]",
              qualityScore: quality.score,
              qualityFlags: JSON.stringify(quality.flags),
              entities: "[]",
              eventType: "other",
              keyNumbers: "[]",
              claims: "[]",
              extractionMode: "rule",
              contentHash,
              isDemo: false,
            },
          });
          added += 1;
        }
        await prisma.source.update({
          where: { id: source.id },
          data: { lastFetchedAt: new Date(), lastStatus: "ok", lastError: null },
        });
        results.push({ source: feed.name, added, skipped });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.source.update({
          where: { id: source.id },
          data: { lastFetchedAt: new Date(), lastStatus: "error", lastError: message.slice(0, 300) },
        });
        results.push({ source: feed.name, added: 0, skipped: 0, error: message.slice(0, 200) });
      }
    }
    return ok({ results }, { mode: "mock" });
  });
}
