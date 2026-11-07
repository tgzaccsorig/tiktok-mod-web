"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/hooks/useStore";

export default function WinterFestAdminPage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [store] = useStore();
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [quests, setQuests] = useState<any[]>([]);
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [rewards, setRewards] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [winner, setWinner] = useState<Record<string,string>>({});
  const [item, setItem] = useState({slug:"",name:"",description:"",icon:"❄️",rarity:"common",slot:"frame",price:"50"});
  const [quest, setQuest] = useState({slug:"",title:"",description:"",action_key:"like",cadence:"daily",goal:"1",reward_coins:"10",starts_on:"2026-12-20"});
  const [competition, setCompetition] = useState({slug:"",title:"",description:"",starts_at:"2026-12-20T00:00",status:"draft"});

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase не настроен."); setLoading(false); return; }
    const {data: auth} = await supabase.auth.getUser();
    const allowed = auth.user?.app_metadata?.role === "admin";
    setAdmin(allowed);
    if (!allowed) { setLoading(false); return; }
    const results = await Promise.all([
      supabase.from("winter_shop_items").select("*").order("created_at",{ascending:false}),
      supabase.from("winter_quests").select("*").order("slug"),
      supabase.from("winter_competitions").select("*").order("starts_at"),
      supabase.from("winter_advent_rewards").select("*").order("day"),
      supabase.from("winter_competition_entries").select("id,competition_slug,user_id,video_url,profile:profiles!winter_competition_entries_user_id_fkey(username)").order("created_at",{ascending:false})
    ]);
    const failed = results.find((result)=>result.error)?.error;
    if (failed) setError(failed.message);
    else {
      setItems(results[0].data ?? []);
      setQuests(results[1].data ?? []);
      setCompetitions(results[2].data ?? []);
      setRewards(results[3].data ?? []);
      setEntries(results[4].data ?? []);
    }
    setLoading(false);
  },[supabase]);

  useEffect(()=>{void load();},[load]);

  const save = async (action:()=>PromiseLike<{error:any}>,success:string) => {
    setSaving(true);setError("");setMessage("");
    try { const result=await action(); if(result.error) throw result.error; setMessage(success); await load(); }
    catch(e) { setError(e instanceof Error ? e.message : "Не удалось сохранить."); }
    finally { setSaving(false); }
  };

  const createItem=()=>save(()=>supabase!.from("winter_shop_items").insert({...item,price:Number(item.price),active:true}),"Предмет добавлен.");
  const createQuest=()=>save(()=>supabase!.from("winter_quests").insert({...quest,goal:Number(quest.goal),reward_coins:Number(quest.reward_coins),active:true}),"Задание добавлено.");
  const createCompetition=()=>save(()=>supabase!.from("winter_competitions").insert({...competition,starts_at:new Date(competition.starts_at).toISOString()}),"Конкурс создан.");
  const updateReward=(day:string,value:number)=>save(()=>supabase!.from("winter_advent_rewards").update({reward_coins:value}).eq("day",day),"Награда календаря обновлена.");
  const selectWinner=(slug:string)=> {
    if(!winner[slug]) {setError("Выбери победителя.");return;}
    void save(()=>supabase!.from("winter_competitions").update({winner_user_id:winner[slug],status:"finished"}).eq("slug",slug),"Победитель сохранён.");
  };

  return (
    <main data-theme={store.settings.theme} className="winter-admin-page min-h-dvh overflow-y-auto bg-[#080d17] px-4 py-7 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex justify-between gap-3"><Link href="/winter-fest" className="rounded-full border border-white/15 px-4 py-2 text-sm">← Winter Fest</Link><Link href="/" className="text-sm text-cyan-200 underline">На главную</Link></div>
        <header className="mt-7"><p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/60">Winter Fest 2027</p><h1 className="mt-2 text-3xl font-black">Управление событием</h1><p className="mt-2 text-sm text-white/45">Доступ только для аккаунтов с серверной ролью app_metadata.role = admin.</p></header>
        {error && <p role="alert" className="mt-5 rounded-xl border border-red-300/20 bg-red-300/5 p-3 text-sm text-red-100">{error}</p>}
        {message && <p role="status" className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-3 text-sm text-emerald-100">{message}</p>}
        {loading ? <p className="mt-6 text-sm text-white/50">Проверяю права доступа…</p> : !admin ? <section className="mt-6 rounded-2xl border border-amber-200/20 bg-amber-200/5 p-5"><h2 className="font-bold">Нет доступа</h2><p className="mt-2 text-sm text-white/60">Обычные данные профиля не дают административных прав. Нужна роль admin в app_metadata.</p></section> : <>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="text-xl font-bold">Магазин: новый предмет</h2><div className="mt-4 grid gap-3">
              <input placeholder="Уникальный slug" value={item.slug} onChange={e=>setItem({...item,slug:e.target.value})} className="admin-input"/>
              <input placeholder="Название" value={item.name} onChange={e=>setItem({...item,name:e.target.value})} className="admin-input"/>
              <input placeholder="Описание" value={item.description} onChange={e=>setItem({...item,description:e.target.value})} className="admin-input"/>
              <div className="grid grid-cols-2 gap-2"><input placeholder="Иконка" value={item.icon} onChange={e=>setItem({...item,icon:e.target.value})} className="admin-input"/><input type="number" min="0" value={item.price} onChange={e=>setItem({...item,price:e.target.value})} className="admin-input"/></div>
              <div className="grid grid-cols-2 gap-2"><select value={item.rarity} onChange={e=>setItem({...item,rarity:e.target.value})} className="admin-input"><option value="common">Обычный</option><option value="rare">Редкий</option><option value="epic">Эпический</option><option value="legendary">Легендарный</option></select><select value={item.slot} onChange={e=>setItem({...item,slot:e.target.value})} className="admin-input"><option value="frame">Рамка</option><option value="background">Фон</option><option value="badge">Значок</option><option value="title">Титул</option></select></div>
              <button disabled={saving||!item.slug||!item.name} onClick={()=>void createItem()} className="rounded-xl bg-cyan-200 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-40">Добавить предмет</button>
            </div></section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="text-xl font-bold">Новое задание</h2><div className="mt-4 grid gap-3">
              <input placeholder="Уникальный slug" value={quest.slug} onChange={e=>setQuest({...quest,slug:e.target.value})} className="admin-input"/>
              <input placeholder="Название" value={quest.title} onChange={e=>setQuest({...quest,title:e.target.value})} className="admin-input"/>
              <input placeholder="Описание" value={quest.description} onChange={e=>setQuest({...quest,description:e.target.value})} className="admin-input"/>
              <div className="grid grid-cols-2 gap-2"><select value={quest.action_key} onChange={e=>setQuest({...quest,action_key:e.target.value})} className="admin-input"><option value="like">Лайки</option><option value="follow">Подписки</option></select><select value={quest.cadence} onChange={e=>setQuest({...quest,cadence:e.target.value})} className="admin-input"><option value="daily">Ежедневное</option><option value="weekly">Еженедельное</option><option value="special">Специальное</option><option value="event">На событие</option></select></div>
              <div className="grid grid-cols-2 gap-2"><input type="number" min="1" value={quest.goal} onChange={e=>setQuest({...quest,goal:e.target.value})} className="admin-input"/><input type="number" min="1" value={quest.reward_coins} onChange={e=>setQuest({...quest,reward_coins:e.target.value})} className="admin-input"/></div>
              <button disabled={saving||!quest.slug||!quest.title} onClick={()=>void createQuest()} className="rounded-xl bg-cyan-200 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-40">Добавить задание</button>
            </div></section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="text-xl font-bold">Новый конкурс</h2><div className="mt-4 grid gap-3">
              <input placeholder="Уникальный slug" value={competition.slug} onChange={e=>setCompetition({...competition,slug:e.target.value})} className="admin-input"/>
              <input placeholder="Название" value={competition.title} onChange={e=>setCompetition({...competition,title:e.target.value})} className="admin-input"/>
              <input placeholder="Описание" value={competition.description} onChange={e=>setCompetition({...competition,description:e.target.value})} className="admin-input"/>
              <label className="text-xs text-white/50">Начало<input type="datetime-local" value={competition.starts_at} onChange={e=>setCompetition({...competition,starts_at:e.target.value})} className="admin-input mt-1"/></label>
              <select value={competition.status} onChange={e=>setCompetition({...competition,status:e.target.value})} className="admin-input"><option value="draft">Черновик</option><option value="open">Открыт</option><option value="closed">Закрыт</option></select>
              <button disabled={saving||!competition.slug||!competition.title} onClick={()=>void createCompetition()} className="rounded-xl bg-cyan-200 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-40">Создать конкурс</button>
            </div></section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="text-xl font-bold">Награды адвента</h2><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{rewards.map(r=><label key={r.day} className="rounded-xl bg-white/[0.04] p-2 text-xs"><span className="block text-white/50">{r.day}</span><input type="number" min="0" defaultValue={r.reward_coins} onBlur={e=>{const value=Number(e.target.value);if(value>=0&&value!==r.reward_coins)void updateReward(r.day,value);}} className="admin-input mt-1"/></label>)}</div></section>
          </div>
          <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="text-xl font-bold">Участники и победители</h2><div className="mt-4 space-y-4">{competitions.map(comp=>{const list=entries.filter(entry=>entry.competition_slug===comp.slug);return <article key={comp.slug} className="rounded-xl border border-white/10 p-4"><div className="flex flex-wrap justify-between gap-2"><b>{comp.title}</b><span className="text-xs text-white/45">{comp.status} · {list.length} участников</span></div>{list.map(entry=><p key={entry.id} className="mt-2 text-xs text-white/55">@{entry.profile?.username??entry.user_id} · <a href={entry.video_url} target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline">Видео</a></p>)}{list.length>0&&<div className="mt-3 flex flex-wrap gap-2"><select value={winner[comp.slug]??""} onChange={e=>setWinner({...winner,[comp.slug]:e.target.value})} className="admin-input min-w-0 flex-1"><option value="">Выбрать победителя</option>{list.map(entry=><option key={entry.user_id} value={entry.user_id}>@{entry.profile?.username??entry.user_id}</option>)}</select><button disabled={saving||!winner[comp.slug]} onClick={()=>selectWinner(comp.slug)} className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">Назначить победителя</button></div>}</article>})}{!competitions.length&&<p className="text-sm text-white/45">Конкурсы ещё не созданы.</p>}</div></section>
        </>}
      </div>
    </main>
  );
}
