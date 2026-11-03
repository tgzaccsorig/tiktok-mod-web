import { extractVideoUrls, intervalMinutes, queryForSlot, slotOf } from "./discoverCore";
import { fetchOembed } from "./tiktok";
import type { VideoItem } from "./types";

/**
 * Автопополнение: ссылки на ролики берутся из выдачи поискового API (Brave или Serper),
 * а каждый ролик затем проверяется официальным oEmbed TikTok.
 * С самим TikTok никакого парсинга и обхода защиты нет.
 */

type Provider = { name: "brave" | "serper"; key: string };

export function activeProvider(): Provider | null {
  const brave = process.env.BRAVE_API_KEY?.trim();
  if (brave) return { name: "brave", key: brave };
  const serper = process.env.SERPER_API_KEY?.trim();
  if (serper) return { name: "serper", key: serper };
  return null;
}

async function searchBrave(key: string, q: string, page: number): Promise<string[]> {
  const params = new URLSearchParams({ q, count: "20", offset: String(page), safesearch: "moderate" });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const json = (await res.json()) as { web?: { results?: { url?: string }[] } };
  return (json.web?.results ?? []).map((r) => r.url ?? "").filter(Boolean);
}

async function searchSerper(key: string, q: string, page: number): Promise<string[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: 20, page: page + 1 }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`serper ${res.status}`);
  const json = (await res.json()) as { organic?: { link?: string }[] };
  return (json.organic ?? []).map((r) => r.link ?? "").filter(Boolean);
}

export type DiscoverResult = {
  configured: boolean;
  intervalMin: number;
  provider: string | null;
  topic: string | null;
  found: number;
  items: VideoItem[];
  error: "search_failed" | null;
};

export async function discover(now: number = Date.now()): Promise<DiscoverResult> {
  const intervalMin = intervalMinutes(process.env.DISCOVER_INTERVAL_MIN);
  const provider = activeProvider();
  const base = { configured: !!provider, intervalMin, provider: provider?.name ?? null, topic: null, found: 0, items: [] };
  if (!provider) return { ...base, error: null };

  const { q, page, topic } = queryForSlot(slotOf(now, intervalMin));
  let links: string[];
  try {
    links = provider.name === "brave" ? await searchBrave(provider.key, q, page) : await searchSerper(provider.key, q, page);
  } catch {
    return { ...base, topic, error: "search_failed" };
  }

  const urls = extractVideoUrls(links);
  const items: VideoItem[] = [];
  const seen = new Set<string>();
  let next = 0;
  const workers = Array.from({ length: Math.min(6, urls.length) }, async () => {
    while (next < urls.length) {
      const r = await fetchOembed(urls[next++]);
      if (r.ok && !seen.has(r.item.id)) {
        seen.add(r.item.id);
        items.push(r.item);
      }
    }
  });
  await Promise.all(workers);
  return { ...base, topic, found: urls.length, items, error: null };
}
