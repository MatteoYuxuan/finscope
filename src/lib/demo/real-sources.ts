/**
 * 真实公开信息源（默认不启用）。
 * 这些地址由各机构公开发布，抓取前请自行确认可访问性与使用条款；
 * 默认关闭，避免首次启动时因网络问题阻塞演示。
 */
export interface RealSource {
  name: string;
  kind: "RSS" | "JSON";
  url: string;
  credibility: number;
  topicHint: string | null;
}

export const REAL_SOURCES: RealSource[] = [
  {
    name: "美联储新闻稿",
    kind: "RSS",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    credibility: 4,
    topicHint: "macro-rate",
  },
  {
    name: "BBC Business",
    kind: "RSS",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml",
    credibility: 3,
    topicHint: null,
  },
  {
    name: "WSJ Markets",
    kind: "RSS",
    url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
    credibility: 3,
    topicHint: "fx-usdcny",
  },
];
