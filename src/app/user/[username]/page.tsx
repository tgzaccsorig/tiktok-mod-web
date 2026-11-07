"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/hooks/useStore";

type Profile = { id: string; username: string; display_name: string | null; bio: string | null; avatar_url: string | null; created_at: string };
type Video = { video_id: string; video_url: string; title: string; author: string; created_at: string; thumbnail: string | null };
type Decoration = { slot: string; item_slug: string; name: string; icon: string };

export default function PublicUserPage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? "").toLowerCase();
  const supabase = useMemo(() => getSupabase(), []);
  const [store] = useStore();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [decorations, setDecorations] = useState<Decoration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase || !username) { setError("Профиль временно недоступен."); setLoading(false); return; }
    let active = true;
    (async () => {
      try {
        const { data: person, error: profileError } = await supabase.from("profiles")
          .select("id,username,display_name,bio,avatar_url,created_at").eq("username", username).maybeSingle();
        if (profileError) throw profileError;
        if (!person) { setError("Пользователь не найден."); return; }
        const { data: worn, error: wornError } = await supabase.from("winter_equipped_items").select("slot,item_slug").eq("user_id", person.id);
        if (wornError) throw wornError;
        const slugs = (worn ?? []).map((item) => item.item_slug);
        const { data: catalogItems, error: itemError } = slugs.length
          ? await supabase.from("winter_shop_items").select("slug,name,icon").in("slug", slugs)
          : { data: [], error: null };
        if (itemError) throw itemError;
        const decorationBySlug = new Map((catalogItems ?? []).map((item) => [item.slug, item]));
        if (!active) return;
        setDecorations((worn ?? []).flatMap((item) => {
          const decoration = decorationBySlug.get(item.item_slug);
          return decoration ? [{ slot: item.slot, item_slug: item.item_slug, name: decoration.name, icon: decoration.icon }] : [];
        }));
        const { data: posts, error: postsError } = await supabase.from("user_videos")
          .select("video_id,video_url,title,author,created_at,thumbnail")
          .eq("user_id", person.id).order("created_at", { ascending: false }).limit(100);
        if (postsError) throw postsError;
        if (!active) return;
        setProfile(person as Profile);
        setVideos((posts ?? []) as Video[]);
      } catch {
        if (active) setError("Не удалось загрузить профиль. Попробуй обновить страницу.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [supabase, username]);

  return (
    <main data-theme={store.settings.theme} className="public-user-page h-dvh min-h-0 overflow-y-scroll overscroll-y-contain touch-pan-y bg-[#090b12] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/search" className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 hover:bg-white/10">← К поиску</Link>
        {loading && <p className="mt-8 text-sm text-white/55">Загружаю профиль…</p>}
        {error && !loading && <p role="alert" className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">{error}</p>}
        {profile && <>
          <header className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-center gap-4">
              <div className={"relative grid h-20 w-20 shrink-0 place-items-center overflow-visible rounded-full " + (decorations.some((item) => item.slot === "frame") ? "ring-4 ring-amber-300 ring-offset-4 ring-offset-[#101827]" : "ring-2 ring-white/15") + (decorations.some((item) => item.slot === "background") ? " bg-gradient-to-br from-cyan-400/30 to-indigo-700/50" : " bg-cyan-300/15")}>
                {profile.avatar_url?.startsWith("preset:") ? <span className="text-4xl">{profile.avatar_url.slice(7)}</span> : profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-20 w-20 rounded-full object-cover" /> : <span className="text-3xl">👤</span>}
                {decorations.filter((item) => item.slot === "badge").map((item) => <span key={item.item_slug} title={item.name} className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-[#101827] bg-cyan-200 text-lg text-slate-950">{item.icon}</span>)}
              </div>
              <div className="min-w-0"><h1 className="truncate text-2xl font-extrabold">{profile.display_name || profile.username}</h1><p className="text-sm text-white/45">@{profile.username}</p></div>
            </div>
            {decorations.some((item) => item.slot === "title") && <p className="mt-3 text-sm font-bold text-amber-200">{decorations.filter((item) => item.slot === "title").map((item) => item.icon + " " + item.name).join(" · ")}</p>}
            {profile.bio && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-white/75">{profile.bio}</p>}
            {decorations.some((item) => item.slot === "background") && <p className="mt-3 text-xs text-cyan-100/70">{decorations.find((item) => item.slot === "background")?.icon} {decorations.find((item) => item.slot === "background")?.name}</p>}
            <p className="mt-4 text-xs text-white/35">Публикации: {videos.length}</p>
          </header>
          <section className="mt-7">
            <h2 className="mb-3 text-lg font-bold">Видео пользователя</h2>
            {videos.length ? <div className="grid gap-3 sm:grid-cols-2">
              {videos.map((video) => <article key={video.video_id} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                {video.thumbnail ? <img src={video.thumbnail} alt="" className="h-24 w-16 shrink-0 rounded-xl object-cover" /> : <div className="grid h-24 w-16 shrink-0 place-items-center rounded-xl bg-white/5 text-2xl">▶</div>}
                <div className="min-w-0 flex-1"><p className="line-clamp-3 text-sm font-semibold">{video.title || "Видео без описания"}</p><p className="mt-1 text-xs text-white/40">{new Date(video.created_at).toLocaleDateString("ru-RU")}</p><a href={video.video_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-cyan-200 underline">Открыть видео ↗</a></div>
              </article>)}
            </div> : <p className="text-sm text-white/40">Пока нет опубликованных видео.</p>}
          </section>
        </>}
      </div>
    </main>
  );
}
