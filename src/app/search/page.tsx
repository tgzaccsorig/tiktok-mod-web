"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/hooks/useStore";
import { CATEGORIES, type VideoItem } from "@/lib/types";

type ProfileResult = { id: string; username: string; display_name: string | null; avatar_url: string | null };
type PublishedResult = {
  video_id: string; video_url: string; title: string; author: string; hashtags: string[] | null;
  categories: string[] | null; user_id: string; created_at: string;
  profile?: { username: string; display_name: string | null } | null;
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<ProfileResult[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [catalog, setCatalog] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const supabase = useMemo(() => getSupabase(), []);
  const [store] = useStore();

  useEffect(() => {
    let active = true;
    fetch("/api/feed", { signal: AbortSignal.timeout(15000) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить каталог видео");
        const data = await response.json() as { items?: VideoItem[] };
        if (active) setCatalog(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => { if (active) setError("Каталог видео временно недоступен. Поиск пользователей и публикаций всё ещё работает."); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, []);

  const runSearch = useCallback(async (raw: string) => {
    const term = raw.trim().replace(/[%_]/g, "").slice(0, 80);
    if (!term) {
      setProfiles([]);
      setVideos([]);
      setError("");
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setSearched(true);

    const normalized = term.toLocaleLowerCase("ru");
    const category = CATEGORIES.find((item) =>
      item.label.toLocaleLowerCase("ru") === normalized || item.id === normalized
    );
    const catalogMatches = catalog.filter((item) =>
      [item.title, item.author, item.music ?? "", ...item.hashtags, ...item.categories]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized))
      || (category ? item.categories.includes(category.id) : false)
    ).slice(0, 30);

    try {
      if (!supabase) throw new Error("Подключение к базе данных не настроено.");
      const pattern = `%${term}%`;
      const profileResults = await Promise.all([
        supabase.from("profiles").select("id,username,display_name,avatar_url").ilike("username", pattern).limit(12),
        supabase.from("profiles").select("id,username,display_name,avatar_url").ilike("display_name", pattern).limit(12),
      ]);
      const profileError = profileResults.find((result) => result.error)?.error;
      if (profileError) throw profileError;
      const profileMap = new Map<string, ProfileResult>();
      for (const result of profileResults) for (const row of result.data ?? []) profileMap.set(row.id, row as ProfileResult);
      setProfiles(Array.from(profileMap.values()).slice(0, 20));

      const videoResults = await Promise.all([
        supabase.from("user_videos")
          .select("video_id,video_url,title,author,hashtags,categories,user_id,created_at,profile:profiles!user_videos_user_id_fkey(username,display_name)")
          .ilike("title", pattern).order("created_at", { ascending: false }).limit(20),
        supabase.from("user_videos")
          .select("video_id,video_url,title,author,hashtags,categories,user_id,created_at,profile:profiles!user_videos_user_id_fkey(username,display_name)")
          .ilike("author", pattern).order("created_at", { ascending: false }).limit(20),
      ]);
      const videoError = videoResults.find((result) => result.error)?.error;
      if (videoError) throw videoError;
      const published = new Map<string, VideoItem>();
      for (const result of videoResults) for (const row of result.data ?? []) {
        const item = row as unknown as PublishedResult;
        published.set(item.video_id, {
          id: item.video_id, url: item.video_url, author: item.author, authorUrl: item.profile?.username ? `/user/${encodeURIComponent(item.profile.username)}` : item.video_url,
          title: item.title ?? "", hashtags: item.hashtags ?? [], music: null, thumbnail: null,
          categories: (item.categories ?? []) as VideoItem["categories"], publishedAt: item.created_at, ownerId: item.user_id,
        });
      }
      const merged = new Map<string, VideoItem>();
      for (const item of [...published.values(), ...catalogMatches]) merged.set(item.id, item);
      setVideos(Array.from(merged.values()).slice(0, 40));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить поиск.");
      setVideos(catalogMatches);
    } finally {
      setLoading(false);
    }
  }, [catalog, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(query), 350);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  return (
    <main data-theme={store.settings.theme} className="search-page min-h-dvh overflow-y-auto bg-[#090b12] px-4 pb-12 pt-6 text-white sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 hover:bg-white/10">← Назад в ленту</Link>
        <header className="mb-6 mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">TikTok Mod Web</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Поиск</h1>
          <p className="mt-2 text-sm text-white/55">Ищи ролики, авторов, темы и категории.</p>
        </header>
        <label className="block">
          <span className="sr-only">Поиск видео и пользователей</span>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Видео, автор или тема…" className="w-full rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-4 text-base outline-none transition placeholder:text-white/35 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10" />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {CATEGORIES.slice(0, 8).map((item) => <button key={item.id} onClick={() => setQuery(item.label)} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 hover:border-cyan-300/40 hover:text-white">{item.label}</button>)}
        </div>
        {(loading || catalogLoading) && <p className="mt-5 text-sm text-cyan-200/80">{loading ? "Ищу…" : "Загружаю каталог видео…"}</p>}
        {error && <p role="alert" className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100/80">{error}</p>}

        {searched && !loading && (
          <div className="mt-7 space-y-8">
            <section>
              <h2 className="mb-3 text-lg font-bold">Пользователи <span className="text-sm font-normal text-white/40">{profiles.length}</span></h2>
              {profiles.length ? <div className="grid gap-2 sm:grid-cols-2">
                {profiles.map((profile) => <Link key={profile.id} href={`/user/${encodeURIComponent(profile.username)}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition hover:border-cyan-300/30 hover:bg-white/[0.07]">
                  {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" /> : <span className="grid h-11 w-11 place-items-center rounded-full bg-cyan-300/15 text-lg">♙</span>}
                  <span className="min-w-0"><b className="block truncate">{profile.display_name || profile.username}</b><span className="text-sm text-white/45">@{profile.username}</span></span>
                </Link>)}
              </div> : <p className="text-sm text-white/40">Пользователи не найдены.</p>}
            </section>
            <section>
              <h2 className="mb-3 text-lg font-bold">Видео <span className="text-sm font-normal text-white/40">{videos.length}</span></h2>
              {videos.length ? <div className="grid gap-3 sm:grid-cols-2">
                {videos.map((video) => <article key={video.id} className="flex min-w-0 gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  {video.thumbnail ? <img src={video.thumbnail} alt="" className="h-24 w-16 shrink-0 rounded-xl bg-black object-cover" /> : <div className="grid h-24 w-16 shrink-0 place-items-center rounded-xl bg-white/5 text-2xl">▶</div>}
                  <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-semibold">{video.title || "Видео без описания"}</p><p className="mt-1 truncate text-xs text-white/45">{video.author}</p><p className="mt-1 line-clamp-1 text-[11px] text-cyan-200/60">{video.categories.join(" · ")}</p><a href={video.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-cyan-200 underline">Открыть видео ↗</a></div>
                </article>)}
              </div> : <p className="text-sm text-white/40">Видео не найдены.</p>}
            </section>
          </div>
        )}
        {!query.trim() && <p className="mt-8 text-center text-sm text-white/35">Начни вводить запрос — результаты появятся автоматически.</p>}
        {searched && !loading && !profiles.length && !videos.length && <p className="mt-8 text-center text-sm text-white/45">По запросу «{query}» ничего не найдено.</p>}
      </div>
    </main>
  );
}
