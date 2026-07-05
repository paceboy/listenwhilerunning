import type { AppConfig, Episode } from "./types.js";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildFeedXml(
  config: AppConfig,
  episodes: Episode[],
  audioUrl: (path: string) => string,
  feedUrl: string,
  imageUrl?: string,
): string {
  const items = episodes
    .map((ep) => {
      const url = audioUrl(ep.audioPath);
      // 96kbps mono ≈ 12000 B/s
      const durationSec = Math.round(ep.audioBytes / 12000);
      return `    <item>
      <title>${esc(ep.title)}</title>
      <guid isPermaLink="false">${esc(ep.id)}</guid>
      <link>${esc(ep.link || url)}</link>
      <description>${esc(ep.description)}</description>
      <pubDate>${new Date(ep.pubDate).toUTCString()}</pubDate>
      <enclosure url="${esc(url)}" length="${ep.audioBytes}" type="audio/mpeg"/>
      <itunes:author>${esc(ep.sourceName)}</itunes:author>
      <itunes:duration>${durationSec}</itunes:duration>${ep.group ? `\n      <category>${esc(ep.group)}</category>` : ""}
    </item>`;
    })
    .join("\n");

  const imageBlock = imageUrl
    ? `    <itunes:image href="${esc(imageUrl)}"/>
    <image><url>${esc(imageUrl)}</url><title>${esc(config.feed.title)}</title><link>${esc(feedUrl)}</link></image>
`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(config.feed.title)}</title>
    <description>${esc(config.feed.description)}</description>
    <language>${esc(config.feed.language)}</language>
    <link>${esc(feedUrl)}</link>
    <atom:link href="${esc(feedUrl)}" rel="self" type="application/rss+xml"/>
    <itunes:author>${esc(config.feed.author)}</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <itunes:category text="Technology"/>
${imageBlock}    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
