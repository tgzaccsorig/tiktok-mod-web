import type { FeedMode, VideoItem } from "./types";

export type Ctx = {
  likes: string[];
  favs: string[];
  history: { id: string; ts: number }[];
};

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    return cat + aut + novelty + rng() * 1.5;
  };

  return pool
    .map((v) => ({ v, s: score(v) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
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
  } else if (mode === "random") {
    list = shuffle(pool, rng);
  } else if (mode === "foryou") {
    list = rank(pool, ctx, rng);
  } else {
    list = rank(
      pool.filter((v) => v.categories.includes(mode)),
      ctx,
      rng,
    );
  }

  if (priorityIds.length) {
    const first = priorityIds.map((id) => list.find((v) => v.id === id)).filter((v): v is VideoItem => !!v);
    const firstIds = new Set(first.map((v) => v.id));
    list = [...first, ...list.filter((v) => !firstIds.has(v.id))];
  }

  // Recommendations should prefer videos the viewer has not watched yet.
  // Favorites and History are explicit library views, so keep their normal behavior.
  if (mode !== "favorites" && mode !== "history" && ctx.history.length > 0) {
    const watchedIds = new Set(ctx.history.map((entry) => entry.id));
    const unseen = list.filter((video) => !watchedIds.has(video.id));
    // If every available video has already been watched, allow a fresh cycle
    // instead of leaving the feed empty. The current pass itself stays deduplicated.
    if (unseen.length > 0) list = unseen;
  }

  return list;
}
