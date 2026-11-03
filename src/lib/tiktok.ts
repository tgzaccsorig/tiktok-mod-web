import { CATEGORIES, type CategoryId, type VideoItem } from "./types";

/** Разрешаем только https-ссылки на домены tiktok.com. */
export function isAllowedTikTokUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "tiktok.com" || h.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

/** Приводит ввод пользователя к полному https-URL (если протокол не указан). */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s.replace(/^http:\/\//i, "https://") : `https://${s}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function extractHashtags(text: string): string[] {
  const m = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return Array.from(new Set(m.map((t) => t.slice(1))));
}

export function categorize(text: string): CategoryId[] {
  const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
  return CATEGORIES.filter((c) => c.keywords.some((k) => words.has(k))).map((c) => c.id);
}

type OembedJson = {
  type?: string;
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  html?: string;
};

/**
 * Превращает ответ официального oEmbed TikTok в VideoItem.
 * Возвращает null, если ответ — не ролик (например, профиль) или в нём нет ID видео.
 */
export function parseOembed(requestUrl: string, json: OembedJson): VideoItem | null {
  const html = json.html ?? "";
  const id = html.match(/data-video-id="(\d+)"/)?.[1] ?? requestUrl.match(/\/video\/(\d+)/)?.[1];
  if (!id || (json.type && json.type !== "video")) return null;

  const authorUrl = json.author_url ?? "";
  const handle = authorUrl.match(/@([^/?#]+)/)?.[1] ?? json.author_name ?? "tiktok";
  const title = decodeEntities(json.title ?? "").trim();
  const music = html.match(/title="♬\s*([^"]+)"/)?.[1];
  const hashtags = extractHashtags(title);

  return {
    id,
    url: `https://www.tiktok.com/@${handle}/video/${id}`,
    author: `@${handle}`,
    authorUrl,
    title,
    hashtags,
    music: music ? decodeEntities(music) : null,
    thumbnail: json.thumbnail_url ?? null,
    categories: categorize(`${title} ${hashtags.join(" ")} ${music ?? ""}`),
  };
}

export type OembedResult =
  | { ok: true; item: VideoItem }
  | { ok: false; reason: "not_allowed" | "unavailable" | "not_video" | "network" };

async function oembedOnce(url: string): Promise<OembedResult> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 400 || res.status === 404) return { ok: false, reason: "unavailable" };
    if (!res.ok) return { ok: false, reason: "network" };
    const json = (await res.json()) as OembedJson;
    const item = parseOembed(url, json);
    return item ? { ok: true, item } : { ok: false, reason: "not_video" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Серверная проверка ссылки через официальный oEmbed TikTok (один повтор при временной ошибке сети/лимита). */
export async function fetchOembed(url: string): Promise<OembedResult> {
  if (!isAllowedTikTokUrl(url)) return { ok: false, reason: "not_allowed" };
  const first = await oembedOnce(url);
  if (first.ok || first.reason !== "network") return first;
  await new Promise((r) => setTimeout(r, 500));
  return oembedOnce(url);
}
