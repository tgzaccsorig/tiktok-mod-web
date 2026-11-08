"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/hooks/useStore";

type Controls = { announcement: string; announcement_active: boolean; maintenance_mode: boolean; maintenance_message: string };
type Profile = { id: string; username: string; display_name: string | null; created_at: string };
type CommentRow = { id: string; user_id: string; video_id: string; content: string; created_at: string };
type VideoRow = { id: string; user_id: string; title: string | null; author: string | null; video_url: string; created_at: string };

export default function AdminPage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [store] = useStore();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<Record<string, number>>({});
  const [controls, setControls] = useState<Controls>({announcement:"",announcement_active:false,maintenance_mode:false,maintenance_message:"Проводим небольшое обновление. Скоро вернёмся!"});
  const [users, setUsers] = useState<Profile[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase не настроен."); setLoading(false); return; }
    setLoading(true); setError("");
    const {data:auth} = await supabase.auth.getUser();
    const allowed = auth.user?.app_metadata?.role === "admin";
    setAuthorized(allowed);
    if (!allowed) { setLoading(false); return; }
    const [statResult, controlResult, userResult, commentResult, videoResult, auditResult] = await Promise.all([
      supabase.rpc("site_admin_stats"),
      supabase.from("site_control_settings").select("announcement,announcement_active,maintenance_mode,maintenance_message").eq("id",true).single(),
      supabase.from("profiles").select("id,username,display_name,created_at").order("created_at",{ascending:false}).limit(100),
      supabase.from("comments").select("id,user_id,video_id,content,created_at").order("created_at",{ascending:false}).limit(50),
      supabase.from("user_videos").select("id,user_id,title,author,video_url,created_at").order("created_at",{ascending:false}).limit(50),
      supabase.rpc("site_admin_audit")
    ]);
    const failed = [statResult,controlResult,userResult,commentResult,videoResult,auditResult].find(x=>x.error)?.error;
    if (failed) setError(failed.message);
    else {
      setStats(statResult.data ?? {});
      setControls(controlResult.data as Controls);
      setUsers(userResult.data ?? []);
      setComments(commentResult.data ?? []);
      setVideos(videoResult.data ?? []);
      setAudit(Array.isArray(auditResult.data) ? auditResult.data : []);
    }
    setLoading(false);
  },[supabase]);

  useEffect(()=>{ void load(); },[load]);

  const saveControls = async () => {
    if (!supabase || busy) return;
    setBusy("controls"); setError(""); setMessage("");
    const {error:e} = await supabase.rpc("site_admin_update_controls",{
      p_announcement:controls.announcement,
      p_announcement_active:controls.announcement_active,
      p_maintenance_mode:controls.maintenance_mode,
      p_maintenance_message:controls.maintenance_message
    });
    if (e) setError(e.message); else { setMessage("Настройки сайта сохранены."); await load(); }
    setBusy("");
  };

  const moderate = async (kind:"comment"|"video",id:string) => {
    if (!supabase || busy || !window.confirm(kind==="comment"?"Удалить этот комментарий?":"Удалить это пользовательское видео?")) return;
    setBusy(id); setError(""); setMessage("");
    const {error:e} = await supabase.rpc(kind==="comment"?"site_admin_delete_comment":"site_admin_delete_user_video",kind==="comment"?{p_comment_id:id}:{p_video_id:id});
    if (e) setError(e.message); else { setMessage("Материал удалён, действие записано в журнал."); await load(); }
    setBusy("");
  };

  const filteredUsers = users.filter(u => (u.username+" "+(u.display_name??"")).toLowerCase().includes(query.toLowerCase()));

  return <main data-theme={store.settings.theme} className="winter-admin-page h-dvh max-h-dvh min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y bg-[#080d17] px-4 py-7 text-white sm:px-6">
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/" className="rounded-full border border-white/15 px-4 py-2 text-sm">← На главную</Link><Link href="/winter-fest/admin" className="rounded-full border border-cyan-200/20 px-4 py-2 text-sm text-cyan-100">Админка Winter Fest →</Link></div>
      <header className="mt-7 rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-slate-900 via-cyan-950 to-indigo-950 p-6 sm:p-8"><p className="text-xs font-bold uppercase tracking-[.25em] text-cyan-200/70">TikTok Mod Web · Control Center</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Общая админ-панель</h1><p className="mt-2 max-w-2xl text-sm text-white/60">Управление сайтом, объявлениями, пользователями и пользовательским контентом. Доступ проверяется сервером через app_metadata.role.</p></header>
      {error&&<p role="alert" className="mt-4 rounded-xl border border-red-300/20 bg-red-300/5 p-3 text-sm text-red-100">{error}</p>}
      {message&&<p role="status" className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-3 text-sm text-emerald-100">{message}</p>}
      {loading?<p className="mt-6 text-sm text-white/50">Загружаю панель…</p>:!authorized?<section className="mt-6 rounded-2xl border border-amber-200/20 bg-amber-200/5 p-5"><h2 className="font-bold">Нет доступа</h2><p className="mt-2 text-sm text-white/60">Нужна серверная роль администратора.</p></section>:<>
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[["Пользователи","users"],["Видео пользователей","videos"],["Комментарии","comments"],["Лайки","likes"],["Подписки","follows"],["Кошельки Winter","winter_wallets"]].map(([label,key])=><article key={key} className="rounded-2xl border border-white/10 bg-white/[.045] p-4"><p className="text-xs text-white/45">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{(stats[key]??0).toLocaleString("ru-RU")}</p></article>)}</section>

        <section className="mt-6 rounded-2xl border border-cyan-200/20 bg-cyan-200/[.045] p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-cyan-200">Управление сайтом</p><h2 className="mt-1 text-xl font-bold">Объявления и режим обслуживания</h2>
          <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" checked={controls.announcement_active} onChange={e=>setControls({...controls,announcement_active:e.target.checked})}/> Показывать объявление в ленте</label>
          <textarea maxLength={240} value={controls.announcement} onChange={e=>setControls({...controls,announcement:e.target.value})} placeholder="Например: сегодня вышло обновление 2.1!" className="admin-input mt-3 min-h-20"/>
          <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" checked={controls.maintenance_mode} onChange={e=>setControls({...controls,maintenance_mode:e.target.checked})}/> Включить уведомление о технических работах</label>
          <input maxLength={240} value={controls.maintenance_message} onChange={e=>setControls({...controls,maintenance_message:e.target.value})} className="admin-input mt-3"/>
          <button disabled={busy!==""} onClick={()=>void saveControls()} className="mt-4 rounded-xl bg-cyan-200 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-40">{busy==="controls"?"Сохраняю…":"Сохранить настройки"}</button>
          <p className="mt-2 text-xs text-white/40">Объявление и уведомление показываются посетителям сайта. Сам режим обслуживания не отключает доступ и не блокирует вход.</p>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-5"><h2 className="text-xl font-bold">Поиск пользователей</h2><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти по нику или имени…" className="admin-input mt-3"/><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{filteredUsers.map(u=><article key={u.id} className="rounded-xl border border-white/10 p-3"><b>@{u.username}</b><p className="text-xs text-white/45">{u.display_name||"Без отображаемого имени"} · {new Date(u.created_at).toLocaleDateString("ru-RU")}</p><Link href={`/user/${encodeURIComponent(u.username)}`} className="mt-1 inline-block text-xs text-cyan-200 underline">Открыть профиль</Link></article>)}{!filteredUsers.length&&<p className="text-sm text-white/40">Ничего не найдено в последних 100 профилях.</p>}</div></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-5"><h2 className="text-xl font-bold">Журнал действий</h2><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{audit.map(row=><article key={row.id} className="rounded-xl border border-white/10 p-3"><b className="text-sm">{row.action}</b><p className="mt-1 text-xs text-white/45">{row.target_type??"сайт"} · {new Date(row.created_at).toLocaleString("ru-RU")}</p></article>)}{!audit.length&&<p className="text-sm text-white/40">Пока нет записей.</p>}</div></div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-5"><h2 className="text-xl font-bold">Модерация комментариев ({comments.length})</h2><div className="mt-3 max-h-[30rem] space-y-2 overflow-y-auto">{comments.map(row=><article key={row.id} className="rounded-xl border border-white/10 p-3"><p className="text-sm">{row.content}</p><p className="mt-1 text-[11px] text-white/40">Пользователь: {row.user_id.slice(0,8)} · Видео: {row.video_id.slice(0,24)}</p><button disabled={busy!==""} onClick={()=>void moderate("comment",row.id)} className="mt-2 rounded-lg border border-red-300/20 px-3 py-2 text-xs text-red-200 disabled:opacity-40">{busy===row.id?"Удаляю…":"Удалить комментарий"}</button></article>)}{!comments.length&&<p className="text-sm text-white/40">Новых комментариев нет.</p>}</div></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-5"><h2 className="text-xl font-bold">Модерация пользовательских видео ({videos.length})</h2><div className="mt-3 max-h-[30rem] space-y-2 overflow-y-auto">{videos.map(row=><article key={row.id} className="rounded-xl border border-white/10 p-3"><b className="text-sm">{row.title||row.author||"Видео без названия"}</b><p className="mt-1 text-[11px] text-white/40">Автор ID: {row.user_id.slice(0,8)}</p><a href={row.video_url} target="_blank" rel="noreferrer" className="text-xs text-cyan-200 underline">Открыть видео</a><div><button disabled={busy!==""} onClick={()=>void moderate("video",row.id)} className="mt-2 rounded-lg border border-red-300/20 px-3 py-2 text-xs text-red-200 disabled:opacity-40">{busy===row.id?"Удаляю…":"Удалить видео"}</button></div></article>)}{!videos.length&&<p className="text-sm text-white/40">Пользовательских видео пока нет.</p>}</div></div>
        </section>
      </>}
      <footer className="mt-8 pb-8 text-center text-xs text-white/30">TikTok Mod Web · Admin Control Center</footer>
    </div>
  </main>;
}
