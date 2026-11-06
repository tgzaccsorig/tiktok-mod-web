/** Чистая логика автопополнения ленты (без сети) — покрыта тестами. */

/** Темы поиска: каждая «ячейка времени» берёт следующую тему и страницу результатов. */
export const TOPICS: string[] = [
  "#русскийтикток #рекомендации",
  "#мемы #юмор #рек",
  "#майнкрафт #приколы",
  "#роблокс #приколы",
  "#смешныевидео #рек",
  "#котики #животные #приколы",
  "#собаки #смешно",
  "#игры #геймер #рек",
  "#русскиемемы #приколы",
  "#майнкрафт #выживание",
  "#роблокс #мемы",
  "#животные #смешныевидео",
  "#приколы #смешно",
  "#гейминг #русский",
  "#мемы #жиза",
  "#летсплей #майнкрафт",
  "#кот #котики #рекомендации",
  "#смешныеживотные #рек",
  "#minecraft #russian #memes",
  "#roblox #russian #funny",
  "#memes #русскийтикток",
  "#gaming #russian #funny",
  "#dogsoftiktok #русский",
  "#catsoftiktok #русский"
];

/** Сколько страниц выдачи перебираем, прежде чем начать темы заново. */
export const PAGES = 5;

export function intervalMinutes(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(Math.round(n), 1440);
}

export function slotOf(nowMs: number, minutes: number): number {
  return Math.floor(nowMs / (minutes * 60_000));
}

/** Один и тот же слот → один и тот же запрос; следующий слот → другая тема / другая страница. */
export function queryForSlot(slot: number): { q: string; topic: string; page: number } {
  const topic = TOPICS[((slot % TOPICS.length) + TOPICS.length) % TOPICS.length];
  const page = Math.floor(slot / TOPICS.length) % PAGES;
  return { q: `site:tiktok.com ${topic} video`, topic, page };
}

const VIDEO_RE = /^https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]+)\/video\/(\d{15,20})(?:[/?#]|$)/i;

/** Из выдачи поисковика оставляет только ссылки на ролики; страницы тегов, профилей и фото отбрасываются. */
export function extractVideoUrls(links: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of links) {
    const m = link.trim().match(VIDEO_RE);
    if (!m) continue;
    const [, user, id] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(`https://www.tiktok.com/@${user}/video/${id}`);
  }
  return out;
}
