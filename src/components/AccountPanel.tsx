"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase, type AccountIdentity } from "@/lib/supabase";
import { normalizeUrl } from "@/lib/tiktok";
import type { VideoItem } from "@/lib/types";
import AvatarCustomizer from "@/components/AvatarCustomizer";

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at?: string;
};

type PublishedVideo = { id: string; video_id: string; video_url: string; title: string; author: string; created_at: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onUserChange: (user: AccountIdentity | null) => void;
};

const inputClass = "w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm outline-none focus:border-cyan-400";
const buttonClass = "rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15 disabled:opacity-40";

export default function AccountPanel({ open, onClose, onUserChange }: Props) {
  const supabase = useMemo(() => getSupabase(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [viewed, setViewed] = useState<Profile | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [publishUrl, setPublishUrl] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedVideos, setPublishedVideos] = useState<PublishedVideo[]>([]);
  const [loadingPublications, setLoadingPublications] = useState(false);
  const [notifications, setNotifications] = useState<{
    id: string; type: "follow" | "like" | "comment"; video_id: string | null;
    created_at: string; read_at: string | null;
    actor: { username: string; display_name: string | null } | null;
  }[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [following, setFollowing] = useState(false);
  const [counts, setCounts] = useState({ followers: 0, following: 0, likes: 0, favorites: 0, history: 0 });
  const [lists, setLists] = useState({ likes: [] as string[], favorites: [] as string[], history: [] as string[] });
  const [tab, setTab] = useState<"likes" | "favorites" | "history">("likes");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadProfile = useCallback(async (id: string) => {
    if (!supabase) return null;
    const { data, error: fetchError } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
    if (fetchError) throw fetchError;
    return data as Profile | null;
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const next = data.session?.user ?? null;
      setUser(next);
      onUserChange(next ? { id: next.id, email: next.email } : null);
      if (next) {
        try { setProfile(await loadProfile(next.id)); } catch { /* profile can be created by DB trigger */ }
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      setUser(next);
      onUserChange(next ? { id: next.id, email: next.email } : null);
      if (!next) { setProfile(null); setViewed(null); }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [supabase, onUserChange, loadProfile]);

  useEffect(() => {
    if (!user || !open) return;
    let active = true;
    (async () => {
      try {
        const p = await loadProfile(user.id);
        if (!active) return;
        setProfile(p);
        if (p) {
          setDisplayName(p.display_name ?? "");
          setUsername(p.username ?? "");
          setBio(p.bio ?? "");
        }
        await loadStats(user.id, active);
        await loadPublishedVideos(user.id);
        await loadNotifications(user.id);
      } catch (e) { if (active) setError(errorText(e)); }
    })();
    return () => { active = false; };
  }, [user?.id, open, loadProfile]);

  async function loadStats(id: string, active = true) {
    if (!supabase) return;
    const tables = ["follows", "likes", "favorites", "watch_history"] as const;
    const [followers, followingCount, likesCount, favoritesCount, historyCount] = await Promise.all([
      supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", id),
      supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", id),
      supabase.from("likes").select("video_id", { count: "exact", head: true }).eq("user_id", id),
      supabase.from("favorites").select("video_id", { count: "exact", head: true }).eq("user_id", id),
      supabase.from("watch_history").select("video_id", { count: "exact", head: true }).eq("user_id", id),
    ]);
    if (active) setCounts({
      followers: followers.count ?? 0, following: followingCount.count ?? 0,
      likes: likesCount.count ?? 0, favorites: favoritesCount.count ?? 0, history: historyCount.count ?? 0,
    });
    const [likes, favorites, history] = await Promise.all([
      supabase.from("likes").select("video_id").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("favorites").select("video_id").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("watch_history").select("video_id").eq("user_id", id).order("watched_at", { ascending: false }).limit(50),
    ]);
    if (active) setLists({
      likes: (likes.data ?? []).map((x: {video_id:string}) => x.video_id),
      favorites: (favorites.data ?? []).map((x: {video_id:string}) => x.video_id),
      history: (history.data ?? []).map((x: {video_id:string}) => x.video_id),
    });
    void tables;
  }

  useEffect(() => {
    if (!supabase || !viewed || !user || viewed.id === user.id) { setFollowing(false); return; }
    let active = true;
    supabase.from("follows").select("follower_id").eq("follower_id", user.id).eq("following_id", viewed.id).maybeSingle()
      .then(({ data }) => { if (active) setFollowing(!!data); });
    return () => { active = false; };
  }, [supabase, viewed?.id, user?.id]);

  const loadPublishedVideos = async (id: string) => {
    if (!supabase) return;
    setLoadingPublications(true);
    try {
      const { data, error: videosError } = await supabase
        .from("user_videos")
        .select("id,video_id,video_url,title,author,created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (videosError) throw videosError;
      setPublishedVideos((data ?? []) as PublishedVideo[]);
    } catch (e) {
      setError("Не удалось загрузить публикации: " + errorText(e));
    } finally {
      setLoadingPublications(false);
    }
  };

  const ensureOwnProfile = async () => {
    if (!supabase || !user) throw new Error("Сначала войди в аккаунт.");
    const existing = await loadProfile(user.id);
    if (existing) return existing;
    const fallbackUsername = `user_${user.id.slice(0, 8)}`;
    const { data, error: createError } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        username: fallbackUsername,
        display_name: user.email?.split("@")[0] || fallbackUsername,
        bio: "",
      }, { onConflict: "id" })
      .select("*")
      .single();
    if (createError) throw new Error("Не удалось создать профиль: " + createError.message);
    const created = data as Profile;
    setProfile(created);
    setUsername(created.username);
    setDisplayName(created.display_name ?? created.username);
    return created;
  };


  const loadNotifications = async (id: string) => {
    if (!supabase) return;
    const { data, error: notificationError } = await supabase
      .from("notifications")
      .select("id,type,video_id,created_at,read_at,actor:profiles!notifications_actor_id_fkey(username,display_name)")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(40);
    if (notificationError) {
      setError("Не удалось загрузить уведомления.");
      return;
    }
    const rows = (data ?? []) as unknown as typeof notifications;
    setNotifications(rows);
    setUnreadCount(rows.filter((item) => !item.read_at).length);
  };

  const markNotificationRead = async (id: string) => {
    if (!supabase || !user) return;
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("id", id)
      .eq("user_id", user.id);
    if (updateError) {
      setError("Не удалось отметить уведомление прочитанным.");
      return;
    }
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, read_at: readAt } : item));
    setUnreadCount((count) => Math.max(0, count - 1));
  };

  const publishVideo = async () => {
    if (!supabase || !user || publishing || !publishUrl.trim()) return;
    setPublishing(true);
    setError("");
    setMessage("");
    try {
      await ensureOwnProfile();
      const url = normalizeUrl(publishUrl);
      const response = await fetch(`/api/oembed?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(9000),
      });
      const result = await response.json() as { ok: boolean; item?: VideoItem; reason?: string };
      if (!response.ok || !result.ok || !result.item) {
        const reason = result.reason;
        const message = reason === "not_allowed"
          ? "Подойдёт только HTTPS-ссылка на tiktok.com."
          : reason === "not_video"
            ? "Это ссылка не на отдельный ролик TikTok."
            : reason === "unavailable"
              ? "Ролик недоступен или удалён. Проверь ссылку и доступность видео."
              : "TikTok не ответил вовремя. Попробуй ещё раз через минуту.";
        throw new Error(message);
      }
      const item = result.item;
      const { error: insertError } = await supabase.from("user_videos").insert({
        user_id: user.id,
        video_id: item.id,
        video_url: item.url,
        author: item.author,
        author_url: item.authorUrl,
        title: item.title,
        hashtags: item.hashtags,
        music: item.music,
        thumbnail: item.thumbnail,
        categories: item.categories,
      });
      if (insertError) {
        if (insertError.code === "23505") throw new Error("Этот ролик уже опубликован в твоём профиле.");
        throw insertError;
      }
      setPublishUrl("");
      setMessage("Видео опубликовано в твоём профиле.");
      await loadPublishedVideos(user.id);
    } catch (e) { setError(errorText(e)); }
    finally { setPublishing(false); }
  };

  const removePublishedVideo = async (id: string) => {
    if (!supabase || !user) return;
    const { error: deleteError } = await supabase.from("user_videos").delete().eq("id", id).eq("user_id", user.id);
    if (deleteError) setError(errorText(deleteError));
    else setPublishedVideos((items) => items.filter((item) => item.id !== id));
  };

  const submitAuth = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "signup") {
        const clean = username.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(clean)) throw new Error("Никнейм: 3–24 символа, латиница, цифры или _.");
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: {
            data: { username: clean, display_name: displayName.trim() || clean },
            // Supabase must return to the current deployment, not the default localhost URL.
            emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
          },
        });
        if (authError) throw authError;
        if (data.session?.user) {
          setUser(data.session.user);
          onUserChange({ id: data.session.user.id, email: data.session.user.email });
          setMessage("Аккаунт создан. Добро пожаловать!");
        } else setMessage("Проверь почту и подтверди регистрацию, затем войди в аккаунт.");
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        setUser(data.user);
        onUserChange({ id: data.user.id, email: data.user.email });
        setMessage("Вход выполнен.");
      }
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const saveProfile = async () => {
    if (!supabase || !user || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const clean = username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(clean)) throw new Error("Никнейм: 3–24 символа, латиница, цифры или _.");
      const payload = { id: user.id, username: clean, display_name: displayName.trim() || clean, bio: bio.trim().slice(0, 160), updated_at: new Date().toISOString() };
      const { data, error: saveError } = await supabase.from("profiles").upsert(payload, { onConflict: "id" }).select("*").single();
      if (saveError) throw saveError;
      setProfile(data as Profile); setViewed(null); setMessage("Профиль сохранён.");
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const searchUsers = async () => {
    if (!supabase || !query.trim()) { setResults([]); return; }
    setError("");
    const { data, error: searchError } = await supabase.from("profiles").select("id,username,display_name,bio,avatar_url").ilike("username", `%${query.trim().replace(/[%_]/g, "")}%`).limit(12);
    if (searchError) setError(errorText(searchError));
    else setResults((data ?? []) as Profile[]);
  };

  const openUser = async (p: Profile) => {
    setViewed(p); setError(""); setMessage("");
    try { await loadStats(p.id); await loadPublishedVideos(p.id); } catch (e) { setError(errorText(e)); }
  };

  const toggleFollow = async () => {
    if (!supabase || !user || !viewed || viewed.id === user.id) return;
    setBusy(true); setError("");
    try {
      const result = following
        ? await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", viewed.id)
        : await supabase.from("follows").insert({ follower_id: user.id, following_id: viewed.id });
      if (result.error) throw result.error;
      setFollowing(!following);
      if (!following) {
        await supabase.from("notifications").insert({
          user_id: viewed.id,
          actor_id: user.id,
          type: "follow",
        });
      }
      await loadStats(viewed.id);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setViewed(null);
    onUserChange(null); setMessage("Вы вышли из аккаунта.");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-hidden py-3 bg-black/75 sm:items-center" onClick={onClose}>
      <section className="account-panel h-[92dvh] min-h-0 max-h-[92dvh] w-full max-w-5xl flex-none overflow-x-hidden overflow-y-auto overscroll-y-contain touch-pan-y rounded-t-2xl border border-white/10 bg-neutral-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="mb-4 flex items-center justify-between">
          <div><p className="text-xs uppercase tracking-widest text-cyan-300">TikTok Mod Web</p><h2 className="text-xl font-bold">Аккаунт и сообщество</h2></div>
          <button onClick={onClose} className={buttonClass}>Закрыть</button>
        </header>

        {!supabase ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm">
            <b className="text-amber-200">Supabase ещё не подключён.</b>
            <p className="mt-2 text-neutral-300">Добавь NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY в Vercel → Settings → Environment Variables, затем выполни SQL из supabase/schema.sql в Supabase → SQL Editor и сделай Redeploy.</p>
          </div>
        ) : !user ? (
          <div className="space-y-3">
            <div className="flex gap-2"><button className={mode === "login" ? "rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black" : buttonClass} onClick={() => setMode("login")}>Войти</button><button className={mode === "signup" ? "rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black" : buttonClass} onClick={() => setMode("signup")}>Регистрация</button></div>
            {mode === "signup" && <><input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Никнейм (латиница, 3–24)" /><input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Отображаемое имя (необязательно)" /></>}
            <input className={inputClass} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Электронная почта" />
            <input className={inputClass} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль (минимум 6 символов)" />
            <button className="w-full rounded-lg bg-cyan-400 py-3 font-bold text-black disabled:opacity-40" disabled={busy || !email.trim() || password.length < 6 || (mode === "signup" && !username.trim())} onClick={submitAuth}>{busy ? "Подожди…" : mode === "login" ? "Войти" : "Создать аккаунт"}</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
            {!viewed ? (
              <div className="min-w-0 space-y-4">
                <div className="rounded-xl bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{profile?.display_name || user.email}</p><p className="text-sm text-neutral-400">@{profile?.username || "профиль ещё создаётся"}</p></div><button className={buttonClass} onClick={signOut}>Выйти</button></div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><Stat label="Подписчики" value={counts.followers}/><Stat label="Подписки" value={counts.following}/><Stat label="Лайки" value={counts.likes}/></div>
                  {user.app_metadata?.role === "admin" && <a href="/winter-fest/admin" className="mt-3 flex w-full items-center justify-center rounded-lg border border-amber-200/25 bg-amber-200/10 px-3 py-3 text-sm font-bold text-amber-100">⚙ Открыть админ-панель Winter Fest</a>}
                </div>
                <div className="space-y-2"><h3 className="font-semibold">Мой профиль</h3><input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Уникальный никнейм"/><input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Имя"/><textarea className={inputClass} rows={3} maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="О себе (до 160 символов)"/><button className="w-full rounded-lg bg-cyan-400 py-2 font-semibold text-black disabled:opacity-40" disabled={busy || !username.trim()} onClick={saveProfile}>Сохранить профиль</button></div>
                <div className="space-y-2 border-t border-white/10 pt-3">
                  <h3 className="font-semibold">Мои публикации</h3>
                  <p className="text-xs text-neutral-400">Добавь ссылку на публичный ролик TikTok — он появится в твоём профиле и ленте подписок.</p>
                  <div className="account-inline-row grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <input className={inputClass} value={publishUrl} onChange={(e) => setPublishUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void publishVideo()} placeholder="https://www.tiktok.com/@.../video/..." />
                    <button className={buttonClass} disabled={publishing || !publishUrl.trim()} onClick={() => void publishVideo()}>{publishing ? "…" : "Опубликовать"}</button>
                  </div>
                  <div className="space-y-2">
                    {publishedVideos.map((video) => <div key={video.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 p-3">
                      <a href={video.video_url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-sm hover:text-cyan-200">
                        <span className="block truncate font-medium">{video.title || video.author}</span>
                        <span className="text-xs text-neutral-500">{video.author} · {new Date(video.created_at).toLocaleDateString("ru-RU")}</span>
                      </a>
                      <button className="text-xs text-red-300" onClick={() => void removePublishedVideo(video.id)}>Удалить</button>
                    </div>)}
                    {loadingPublications && <p className="text-xs text-neutral-400">Загружаю публикации…</p>}
                    {!loadingPublications && !publishedVideos.length && <p className="text-xs text-neutral-500">Пока нет публикаций.</p>}
                  </div>
                </div>
                <div className="space-y-2 border-t border-white/10 pt-3"><h3 className="font-semibold">Поиск пользователей</h3><div className="account-inline-row grid grid-cols-[minmax(0,1fr)_auto] gap-2"><input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchUsers()} placeholder="Найти по никнейму"/><button className={buttonClass} onClick={searchUsers}>Найти</button></div>{results.map((p) => <button key={p.id} onClick={() => openUser(p)} className="flex w-full items-center justify-between rounded-lg bg-white/5 p-3 text-left"><span><b>{p.display_name || p.username}</b><span className="ml-2 text-sm text-neutral-400">@{p.username}</span></span><span>Открыть →</span></button>)}</div>

                <div className="border-t border-white/10 pt-3">
                  <button className={buttonClass} onClick={() => { setShowNotifications((value) => !value); if (!showNotifications) void loadNotifications(user.id); }}>
                    🔔 Уведомления {unreadCount > 0 ? "· " + unreadCount + " новых" : ""}
                  </button>
                  {showNotifications ? (
                    <div className="mt-2 space-y-2">
                      {notifications.map((item) => (
                        <div key={item.id} className={"rounded-lg p-3 text-sm " + (item.read_at ? "bg-white/5" : "bg-cyan-400/10")}>
                          <p>
                            <b>{item.actor?.display_name || item.actor?.username || "Пользователь"}</b>{" "}
                            {item.type === "follow" ? "подписался на вас" : item.type === "like" ? "поставил лайк вашему видео" : "оставил комментарий к вашему видео"}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <time className="text-xs text-neutral-500">{new Date(item.created_at).toLocaleString("ru-RU")}</time>
                            {!item.read_at && <button className="text-xs text-cyan-200" onClick={() => void markNotificationRead(item.id)}>Прочитано</button>}
                          </div>
                        </div>
                      ))}
                      {!notifications.length && <p className="text-xs text-neutral-500">Пока нет уведомлений.</p>}
                    </div>
                  ) : (
                    <>
                      <div className="mt-3 flex flex-wrap gap-2">{(["likes","favorites","history"] as const).map((t) => <button key={t} className={tab === t ? "rounded-full bg-white px-3 py-1 text-sm text-black" : buttonClass} onClick={() => setTab(t)}>{t === "likes" ? "Лайки" : t === "favorites" ? "Избранное" : "История"}</button>)}</div>
                      <div className="mt-2 space-y-1 text-sm text-neutral-300">{lists[tab].length ? lists[tab].map((id, i) => <p key={id + i} className="rounded bg-white/5 px-2 py-1">Видео ID: {id}</p>) : <p className="text-neutral-500">Здесь пока пусто. Список сохраняется в аккаунте.</p>}</div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="min-w-0 space-y-3">
                <button className={buttonClass} onClick={() => { setViewed(null); void loadStats(user.id); void loadPublishedVideos(user.id); }}>← Мой аккаунт</button>
                <div className="rounded-xl bg-white/5 p-4"><h3 className="text-lg font-bold">{viewed.display_name || viewed.username}</h3><p className="text-sm text-cyan-300">@{viewed.username}</p><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{viewed.bio || "Пользователь пока ничего не рассказал о себе."}</p><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><Stat label="Подписчики" value={counts.followers}/><Stat label="Подписки" value={counts.following}/><Stat label="Лайки" value={counts.likes}/></div>{viewed.id !== user.id && <button className="mt-3 w-full rounded-lg bg-cyan-400 py-2 font-semibold text-black disabled:opacity-40" disabled={busy} onClick={toggleFollow}>{following ? "Отписаться" : "Подписаться"}</button>}</div>
                <div className="space-y-2 border-t border-white/10 pt-3">
                  <h4 className="font-semibold">Публикации</h4>
                  {publishedVideos.map((video) => <a key={video.id} href={video.video_url} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-white/5 p-3 text-sm hover:bg-white/10">{video.title || video.author}<span className="ml-2 text-xs text-neutral-500">Открыть ролик ↗</span></a>)}
                  {!publishedVideos.length && <p className="text-xs text-neutral-500">Пока нет публикаций.</p>}
                </div>
                <div className="flex gap-2">{(["likes","favorites","history"] as const).map((t) => <button key={t} className={tab === t ? "rounded-full bg-white px-3 py-1 text-sm text-black" : buttonClass} onClick={() => setTab(t)}>{t === "likes" ? "Лайки" : t === "favorites" ? "Избранное" : "История"}</button>)}</div>
                <div className="space-y-1 text-sm text-neutral-300">{lists[tab].map((id, i) => <p key={id + i} className="rounded bg-white/5 px-2 py-1">Видео ID: {id}</p>)}</div>
              </div>
            )}
            {!viewed && <AvatarCustomizer user={user} profile={profile} onProfileChange={setProfile} />}
          </div>
        )}
        {message && <p className="mt-3 rounded-lg bg-cyan-400/10 p-2 text-sm text-cyan-200">{message}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-400/10 p-2 text-sm text-red-300">{error}</p>}
        <p className="mt-4 text-center text-xs text-neutral-500">Пароль обрабатывается Supabase Auth и не сохраняется сайтом.</p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-black/30 p-2"><b className="block text-base">{value}</b><span className="text-neutral-400">{label}</span></div>;
}

function errorText(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String((error as {message: unknown}).message);
  return "Не удалось выполнить действие. Проверь подключение и настройки Supabase.";
}
