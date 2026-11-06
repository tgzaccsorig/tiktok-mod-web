import type { FeedMode, VideoItem } from "./types";

export type Ctx = {
  likes: string[];
  favs: string[];
  history: { id: string; ts: number }[];
  notInterested?: string[];
};

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Russian-language filter for the For You and Random feeds. */
export function isRussianVideo(v: VideoItem): boolean {
  const text = (v.title + " " + v.hashtags.join(" ")).toLocaleLowerCase("ru");
  const letters = text.match(/[a-zа-яё]/gi) ?? [];
  const cyrillic = text.match(/[а-яё]/gi) ?? [];
  return cyrillic.length >= 3 && letters.length > 0 && cyrillic.length / letters.length >= 0.35;
}

/** Собственный алгоритм подбора: учитывает лайки, избранное и просмотры по категориям и авторам. */
export function rank(pool: VideoItem[], ctx: Ctx, rng: () => number = Math.random): VideoItem[] {
  const byId = new Map(pool.map((v) => [v.id, v]));
  const catAff: Record<string, number> = {};
  const authorAff: Record<string, number> = {};
  const seen: Record<string, number> = {};

  const bump = (id: string, w: number) => {
    const v = byId.get(id);
    if (!v) return;
    v.categories.forEach((c) => (catAff[c] = (catAff[c] ?? 0) + w));
    authorAff[v.author] = (authorAff[v.author] ?? 0) + w;
  };
  ctx.likes.forEach((id) => bump(id, 3));
  ctx.favs.forEach((id) => bump(id, 4));
  ctx.history.forEach((h) => {
    seen[h.id] = (seen[h.id] ?? 0) + 1;
    bump(h.id, 0.5);
  });

  const score = (v: VideoItem) => {
    const cat = v.categories.reduce((s, c) => s + (catAff[c] ?? 0), 0);
    const aut = (authorAff[v.author] ?? 0) * 1.5;
    const novelty = seen[v.id] ? -Math.min(seen[v.id], 6) * 0.5 : 2;
    const russianBoost = isRussianVideo(v) ? 8 : 0;
    const notInterestedPenalty = ctx.notInterested?.includes(v.id) ? -20 : 0;
    return cat + aut + novelty + russianBoost + notInterestedPenalty + rng() * 1.5;
  };

  const remaining = pool
    .map((v) => ({ v, s: score(v) }))
    .sort((a, b) => b.s - a.s);
  const diversified: VideoItem[] = [];
  while (remaining.length) {
    const previousAuthor = diversified[diversified.length - 1]?.author;
    const nextIndex = remaining.findIndex((item) => item.v.author !== previousAuthor);
    const chosen = remaining.splice(nextIndex >= 0 ? nextIndex : 0, 1)[0];
    diversified.push(chosen.v);
  }
  return diversified;
}

/** Один проход ленты для выбранного режима. */
export function buildPass(
  mode: FeedMode,
  pool: VideoItem[],
  ctx: Ctx,
  rng: () => number = Math.random,
  priorityIds: string[] = [],
): VideoItem[] {
  const byId = new Map(pool.map((v) => [v.id, v]));
  let list: VideoItem[];
  const recentIds = new Set(ctx.history.slice(-50).map((item) => item.id));
  const freshPool = pool.filter((video) => !recentIds.has(video.id));
  // Не повторяем недавно просмотренное, пока есть другие ролики. Если каталог исчерпан — лента остаётся бесконечной.
  const discoveryPool = freshPool.length ? freshPool : pool;

  if (mode === "favorites") {
    list = ctx.favs
      .slice()
      .reverse()
      .map((id) => byId.get(id))
      .filter((v): v is VideoItem => !!v);
  } else if (mode === "history") {
    const seen = new Set<string>();
    list = ctx.history
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
      .map((h) => byId.get(h.id))
      .filter((v): v is VideoItem => !!v);
  } else if (mode === "subscriptions") {
    list = pool
      .filter((v) => !!v.publishedAt)
      .sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
  } else if (mode === "random") {
    const hidden = new Set(ctx.notInterested ?? []);
    const preferredPool = discoveryPool.filter((v) => !hidden.has(v.id));
    const hiddenPool = discoveryPool.filter((v) => hidden.has(v.id));
    const russian = preferredPool.filter(isRussianVideo);
    const other = preferredPool.filter((v) => !isRussianVideo(v));
    list = [...shuffle(russian, rng), ...shuffle(other, rng), ...shuffle(hiddenPool, rng)];
  } else if (mode === "foryou") {
    list = rank(discoveryPool, ctx, rng);
  } else {
    list = rank(
      discoveryPool.filter((v) => v.categories.includes(mode)),
      ctx,
      rng,
    );
  }

  if (priorityIds.length) {
    const first = priorityIds.map((id) => list.find((v) => v.id === id)).filter((v): v is VideoItem => !!v);
    const firstIds = new Set(first.map((v) => v.id));
    list = [...first, ...list.filter((v) => !firstIds.has(v.id))];
  }
  return list;
}
