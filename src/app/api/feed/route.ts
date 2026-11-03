import { NextResponse } from "next/server";
import catalog from "@data/videos.json";
import { fetchOembed } from "@/lib/tiktok";
import type { VideoItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * GET /api/feed — каталог из data/videos.json.
 * Каждая ссылка проверяется официальным oEmbed TikTok; недоступные ролики отбрасываются.
 * Ответ кэшируется на CDN (s-maxage) — повторные открытия сайта не ждут TikTok.
 */
export async function GET() {
  const urls = (catalog.videos as string[]).filter((u) => typeof u === "string" && u.trim());
  const results = await mapLimit(urls, 10, async (url) => ({ url, r: await fetchOembed(url) }));

  const seen = new Set<string>();
  const items: VideoItem[] = [];
  const skipped: { url: string; reason: string }[] = [];
  for (const { url, r } of results) {
    if (!r.ok) skipped.push({ url, reason: r.reason });
    else if (!seen.has(r.item.id)) {
      seen.add(r.item.id);
      items.push(r.item);
    }
  }
  return NextResponse.json(
    { source: "tiktok-oembed", items, skipped },
    {
      headers: {
        // пустой ответ (например, TikTok временно недоступен) не кэшируем
        "Cache-Control": items.length ? "public, s-maxage=600, stale-while-revalidate=86400" : "no-store",
      },
    },
  );
}
