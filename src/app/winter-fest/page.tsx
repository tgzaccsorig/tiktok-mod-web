"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/hooks/useStore";

const EVENT_START = new Date("2026-12-20T00:00:00+02:00");
type Reward = { day: string; reward_coins: number; reward_title: string; icon: string; active: boolean };
type ShopItem = { slug: string; name: string; description: string; icon: string; rarity: "common" | "rare" | "epic" | "legendary"; slot: string; price: number };
type Quest = { slug: string; title: string; description: string; cadence: string; goal: number; reward_coins: number };
type Progress = { quest_slug: string; cycle_key: string; progress: number; completed_at: string | null; claimed_at: string | null };
type Competition = { slug: string; title: string; description: string; status: string; starts_at: string; ends_at: string | null; winner_user_id: string | null };
type Entry = { id: string; competition_slug: string; user_id: string; video_url: string; created_at: string; profile?: { username: string; display_name: string | null } | null };

function helsinkiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function questCycle(cadence: string) {
  const now = new Date();
  if (cadence === "daily") return helsinkiDate(now);
  if (cadence === "weekly") {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Helsinki", weekday: "short" }).format(now);
    const offset = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[parts] ?? 0;
    const date = new Date(now.getTime() - offset * 86400000);
    return helsinkiDate(date);
  }
  return "event";
}
function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("event_not_started")) return "Событие ещё не началось.";
  if (message.includes("already_claimed")) return "Эта награда уже получена.";
  if (message.includes("advent_day_locked")) return "Этот день пока закрыт.";
  if (message.includes("insufficient_balance")) return "Не хватает SnowCoins.";
  if (message.includes("already_owned")) return "Этот предмет уже есть в инвентаре.";
  if (message.includes("quest_not_ready")) return "Задание ещё не выполнено или награда уже получена.";
  return "Не удалось выполнить действие. Попробуй ещё раз.";
}

export default function WinterFestPage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [store] = useStore();
  const [now, setNow] = useState(() => new Date());
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState(0);
  const [eventSettings, setEventSettings] = useState({test_mode:false,test_date:"2026-12-20"});
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [claims, setClaims] = useState<string[]>([]);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [equipped, setEquipped] = useState<Record<string, string>>({});
  const [quests, setQuests] = useState<Quest[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [ledger, setLedger] = useState<{ amount: number; reason: string; created_at: string }[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryUrls, setEntryUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isAdmin = user?.app_metadata?.role === "admin";
  const testPreview = isAdmin && eventSettings.test_mode && eventSettings.test_date >= "2026-12-20";
  const active = now.getTime() >= EVENT_START.getTime() || testPreview;
  const remaining = Math.max(0, EVENT_START.getTime() - now.getTime());
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const today = isAdmin && eventSettings.test_mode ? eventSettings.test_date : helsinkiDate(now);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      const currentUser = auth.user ?? null;
      setUser(currentUser);
      let settings = {test_mode:false,test_date:"2026-12-20"};
      if (currentUser?.app_metadata?.role === "admin") {
        const {data: eventData, error: settingsError} = await supabase.from("winter_event_settings").select("test_mode,test_date").eq("id",true).single();
        if (settingsError) throw settingsError;
        settings = {test_mode:eventData.test_mode,test_date:eventData.test_date};
        setEventSettings(settings);
      } else setEventSettings({test_mode:false,test_date:"2026-12-20"});
      const preview = currentUser?.app_metadata?.role === "admin" && settings.test_mode && settings.test_date >= "2026-12-20";
      if (new Date().getTime() < EVENT_START.getTime() && !preview) { setLoading(false); return; }
      const publicResults = await Promise.all([
        supabase.from("winter_advent_rewards").select("day,reward_coins,reward_title,icon,active").order("day"),
        supabase.from("winter_shop_items").select("slug,name,description,icon,rarity,slot,price").eq("active", true).order("price"),
        supabase.from("winter_quests").select("slug,title,description,cadence,goal,reward_coins").eq("active", true),
        supabase.from("winter_competitions").select("slug,title,description,status,starts_at,ends_at,winner_user_id").order("starts_at"),
        supabase.from("winter_competition_entries").select("id,competition_slug,user_id,video_url,created_at,profile:profiles!winter_competition_entries_user_id_fkey(username,display_name)").order("created_at", { ascending: false }).limit(100),
      ]);
      const publicError = publicResults.find((result) => result.error)?.error;
      if (publicError) throw publicError;
      setRewards((publicResults[0].data ?? []) as Reward[]);
      setItems((publicResults[1].data ?? []) as ShopItem[]);
      setQuests((publicResults[2].data ?? []) as Quest[]);
      setCompetitions((publicResults[3].data ?? []) as Competition[]);
      setEntries((publicResults[4].data ?? []) as unknown as Entry[]);
      if (!currentUser) {
        setBalance(0); setClaims([]); setOwned([]); setEquipped({}); setProgress([]); setLedger([]);
        return;
      }
      const [wallet, userClaims, inventory, worn, questProgress, history] = await Promise.all([
        supabase.from("winter_wallets").select("balance").eq("user_id", currentUser.id).maybeSingle(),
        supabase.from("winter_advent_claims").select("day").eq("user_id", currentUser.id),
        supabase.from("winter_inventory").select("item_slug").eq("user_id", currentUser.id),
        supabase.from("winter_equipped_items").select("slot,item_slug").eq("user_id", currentUser.id),
        supabase.from("winter_quest_progress").select("quest_slug,cycle_key,progress,completed_at,claimed_at").eq("user_id", currentUser.id),
        supabase.from("winter_coin_ledger").select("amount,reason,created_at").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(12),
      ]);
      const privateError = [wallet,userClaims,inventory,worn,questProgress,history].find((result) => result.error)?.error;
      if (privateError) throw privateError;
      setBalance(wallet.data?.balance ?? 0);
      setClaims((userClaims.data ?? []).map((row) => row.day));
      setOwned((inventory.data ?? []).map((row) => row.item_slug));
      setEquipped(Object.fromEntries((worn.data ?? []).map((row) => [row.slot, row.item_slug])));
      setProgress((questProgress.data ?? []) as Progress[]);
      setLedger((history.data ?? []) as typeof ledger);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { void loadData(); }, [loadData]);

  const runAction = async (key: string, action: () => Promise<unknown>, success: string) => {
    if (!supabase || !user || busy) {
      if (!user) setError("Войди в аккаунт, чтобы получать награды.");
      return;
    }
    setBusy(key); setError(""); setMessage("");
    try {
      await action();
      setMessage(success);
      await loadData();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const claimDay = (day: string) => runAction(`day:${day}`, async () => {
    const { error: rpcError } = await supabase!.rpc("winter_claim_advent_day", { p_day: day });
    if (rpcError) throw rpcError;
  }, "Награда добавлена на баланс!");
  const buyItem = (slug: string) => runAction(`buy:${slug}`, async () => {
    const { error: rpcError } = await supabase!.rpc("winter_purchase_item", { p_slug: slug });
    if (rpcError) throw rpcError;
  }, "Покупка прошла успешно!");
  const equipItem = (slug: string) => runAction(`equip:${slug}`, async () => {
    const { error: rpcError } = await supabase!.rpc("winter_equip_item", { p_slug: slug });
    if (rpcError) throw rpcError;
  }, "Украшение профиля обновлено!");
  const claimQuest = (slug: string) => runAction(`quest:${slug}`, async () => {
    const { error: rpcError } = await supabase!.rpc("winter_claim_quest", { p_slug: slug });
    if (rpcError) throw rpcError;
  }, "Награда за задание получена!");

  const submitEntry = async (slug: string) => {
    if (!supabase || !user) { setError("Войди в аккаунт, чтобы участвовать."); return; }
    const url = (entryUrls[slug] ?? "").trim();
    if (!/^https:\/\/(www\.)?tiktok\.com\//i.test(url)) { setError("Вставь публичную HTTPS-ссылку на ролик TikTok."); return; }
    setBusy(`entry:${slug}`); setError(""); setMessage("");
    const { error: insertError } = await supabase.from("winter_competition_entries").insert({ competition_slug: slug, user_id: user.id, video_url: url });
    if (insertError) setError(insertError.code === "23505" ? "Ты уже участвуешь в этом конкурсе." : "Не удалось отправить заявку.");
    else { setMessage("Заявка отправлена!"); setEntryUrls((values) => ({ ...values, [slug]: "" })); }
    setBusy(null);
  };

  const progressFor = (quest: Quest) => progress.find((item) => item.quest_slug === quest.slug && item.cycle_key === questCycle(quest.cadence));
  const rarityLabel: Record<string, string> = { common: "Обычный", rare: "Редкий", epic: "Эпический", legendary: "Легендарный" };

  return (
    <main data-theme={store.settings.theme} className="winter-page min-h-dvh overflow-y-auto bg-[#07101b] px-4 py-7 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 hover:bg-white/10">← Назад в TikTok Mod Web</Link>
        {isAdmin && <div className="mt-4 flex justify-end"><Link href="/winter-fest/admin" className="rounded-full border border-amber-200/30 bg-amber-200/10 px-4 py-2 text-xs font-bold text-amber-100">⚙ Админ-панель</Link></div>}
        <header className="relative mt-7 overflow-hidden rounded-[2rem] border border-cyan-100/15 bg-gradient-to-br from-[#102b40] via-[#123c4a] to-[#261e45] p-6 shadow-2xl sm:p-10">
          <div className="pointer-events-none absolute -right-8 -top-12 text-[10rem] opacity-10">❄️</div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-200">TikTok Mod Web presents</p>
          {testPreview && <span className="mt-3 inline-flex rounded-full border border-amber-200/30 bg-amber-200/10 px-3 py-1 text-[10px] font-black tracking-widest text-amber-100">TEST MODE · ТОЛЬКО ДЛЯ АДМИНА</span>}
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">Winter Fest <span className="text-cyan-200">2027</span></h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">Зимнее событие, SnowCoins, адвент-календарь и праздничные украшения профиля.</p>
          {!active ? <div className="mt-7">
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-100/65">До начала события</p>
            <div className="mt-3 grid max-w-xl grid-cols-4 gap-2 sm:gap-3">
              {[[days,"дней"],[hours,"часов"],[minutes,"минут"],[seconds,"секунд"]].map(([value,label]) => <div key={label} className="rounded-2xl border border-white/15 bg-black/20 p-3 text-center sm:p-4"><span className="block text-3xl font-black tabular-nums sm:text-4xl">{String(value).padStart(2,"0")}</span><span className="mt-1 block text-[10px] uppercase tracking-wider text-white/55 sm:text-xs">{label}</span></div>)}
            </div>
            <p className="mt-4 text-xs text-white/50">Старт: 20 декабря 2026 года, 00:00 по времени Финляндии. До этой даты активности закрыты.</p>
          </div> : <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-emerald-200/20 bg-emerald-200/10 px-4 py-2 text-sm font-bold text-emerald-100">❄️ Winter Fest открыт</div>}
        </header>

        {!active ? <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm leading-6 text-white/65">Мы готовим праздничные активности заранее. Страница события, календарь, задания и магазин станут доступны после официального старта. Администратор может включить приватный тестовый режим.</section> : <>
          <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-100/15 bg-white/[0.05] p-5">
            <div><p className="text-xs uppercase tracking-widest text-cyan-200/65">Твой баланс</p><p className="mt-1 text-3xl font-black tabular-nums">{balance} <span className="text-lg text-cyan-200">SC</span></p></div>
            <div className="text-right text-xs text-white/45">{user ? `Аккаунт: @${user.user_metadata?.username ?? user.email ?? "пользователь"}` : "Войди в аккаунт, чтобы получать SnowCoins"}</div>
            {user?.app_metadata?.role === "admin" && <Link href="/winter-fest/admin" className="rounded-full border border-cyan-100/20 px-3 py-2 text-xs font-bold text-cyan-100">Управление событием</Link>}
          </section>

          {error && <p role="alert" className="mt-4 rounded-xl border border-red-300/20 bg-red-300/5 p-3 text-sm text-red-100">{error}</p>}
          {message && <p role="status" className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-3 text-sm text-emerald-100">{message}</p>}
          {loading && <p className="mt-4 text-sm text-cyan-100/70">Загружаю Winter Fest…</p>}

          <section className="mt-8">
            <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/65">01 · Advent</p><h2 className="mt-1 text-2xl font-extrabold">Адвент-календарь</h2><p className="mt-1 text-sm text-white/45">Один подарок на каждый день. Будущие даты закрыты, повторно забрать награду нельзя.</p></div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {rewards.map((reward) => {
                const claimed = claims.includes(reward.day);
                const locked = reward.day > today;
                const day = Number(reward.day.slice(-2));
                return <div key={reward.day} className={`rounded-2xl border p-3 text-center ${claimed ? "border-emerald-200/25 bg-emerald-200/10" : locked ? "border-white/5 bg-white/[0.02] opacity-45" : "border-cyan-100/20 bg-cyan-100/[0.06]"}`}>
                  <span className="block text-2xl">{claimed ? "✓" : locked ? "🔒" : reward.icon}</span>
                  <span className="mt-1 block text-lg font-black">{day}</span>
                  <span className="block text-[10px] text-white/45">{claimed ? "Получено" : locked ? "Закрыто" : `+${reward.reward_coins} SC`}</span>
                  {!claimed && !locked && <button disabled={!user || busy !== null} onClick={() => void claimDay(reward.day)} className="mt-2 w-full rounded-lg bg-cyan-200 px-2 py-1.5 text-[10px] font-bold text-slate-950 disabled:opacity-40">{busy === `day:${reward.day}` ? "…" : "Открыть"}</button>}
                </div>;
              })}
            </div>
          </section>

          <section className="mt-9">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/65">02 · Quests</p><h2 className="mt-1 text-2xl font-extrabold">Праздничные задания</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {quests.map((quest) => {
                const row = progressFor(quest);
                const count = row?.progress ?? 0;
                const claimed = !!row?.claimed_at;
                const done = count >= quest.goal;
                return <article key={quest.slug} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{quest.title}</h3><p className="mt-1 text-sm text-white/50">{quest.description}</p></div><span className="shrink-0 rounded-full bg-cyan-200/10 px-3 py-1 text-xs font-bold text-cyan-100">+{quest.reward_coins} SC</span></div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-200" style={{width:`${Math.min(100,count/quest.goal*100)}%`}} /></div>
                  <div className="mt-2 flex items-center justify-between text-xs text-white/45"><span>{count}/{quest.goal}</span><span>{quest.cadence === "daily" ? "Ежедневное" : quest.cadence === "weekly" ? "Еженедельное" : "Специальное"}</span></div>
                  {done && !claimed && <button disabled={!user || busy !== null} onClick={() => void claimQuest(quest.slug)} className="mt-3 rounded-lg bg-cyan-200 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">{busy === `quest:${quest.slug}` ? "…" : "Забрать награду"}</button>}
                  {claimed && <p className="mt-3 text-xs font-semibold text-emerald-200">Награда получена ✓</p>}
                </article>;
              })}
            </div>
          </section>

          <section className="mt-9">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/65">03 · Shop</p><h2 className="mt-1 text-2xl font-extrabold">Магазин украшений</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {items.map((item) => {
                const isOwned = owned.includes(item.slug);
                const isEquipped = equipped[item.slot] === item.slug;
                return <article key={item.slug} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="grid h-20 place-items-center rounded-xl bg-white/[0.04] text-4xl">{item.icon}</div>
                  <h3 className="mt-3 font-bold">{item.name}</h3><p className="mt-1 min-h-10 text-xs leading-5 text-white/45">{item.description}</p>
                  <p className="mt-2 text-[10px] uppercase tracking-widest text-cyan-100/55">{rarityLabel[item.rarity]} · {item.slot}</p>
                  <p className="mt-3 font-black">{item.price} SC</p>
                  {isOwned ? <button disabled={busy !== null || isEquipped} onClick={() => void equipItem(item.slug)} className="mt-3 w-full rounded-xl border border-cyan-200/20 px-3 py-2 text-xs font-bold text-cyan-100 disabled:opacity-40">{isEquipped ? "Установлено ✓" : "Установить"}</button> : <button disabled={!user || busy !== null || balance < item.price} onClick={() => void buyItem(item.slug)} className="mt-3 w-full rounded-xl bg-cyan-200 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">{busy === `buy:${item.slug}` ? "…" : "Купить"}</button>}
                </article>;
              })}
            </div>
          </section>

          <section className="mt-9">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/65">04 · Competitions</p><h2 className="mt-1 text-2xl font-extrabold">Новогодние конкурсы</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {competitions.length ? competitions.map((competition) => <article key={competition.slug} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><h3 className="font-bold">{competition.title}</h3><p className="mt-2 text-sm text-white/50">{competition.description}</p><p className="mt-3 text-xs text-cyan-100/60">Статус: {competition.status}</p>{competition.winner_user_id && <p className="mt-2 text-xs text-emerald-200">Победитель определён организатором.</p>}<div className="mt-3 border-t border-white/10 pt-3"><p className="text-xs font-semibold text-white/60">Участники: {entries.filter((entry) => entry.competition_slug === competition.slug).length}</p>{entries.filter((entry) => entry.competition_slug === competition.slug).slice(0,8).map((entry) => <div key={entry.id} className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="truncate text-white/55">@{entry.profile?.username ?? "участник"}</span><a href={entry.video_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-cyan-200 underline">Видео ↗</a></div>)}</div>{competition.status === "open" && <div className="mt-3 space-y-2"><input value={entryUrls[competition.slug] ?? ""} onChange={(event) => setEntryUrls((values) => ({...values,[competition.slug]:event.target.value}))} placeholder="HTTPS-ссылка на TikTok" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-cyan-200/50" /><button disabled={!user || busy !== null} onClick={() => void submitEntry(competition.slug)} className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">Отправить заявку</button></div>}</article>) : <p className="text-sm text-white/45">Конкурсы пока не опубликованы организатором.</p>}
            </div>
          </section>

          <section className="mt-9 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <h2 className="font-bold">История SnowCoins</h2>
            {ledger.length ? <ul className="mt-3 space-y-2">{ledger.map((row,index) => <li key={`${row.created_at}:${index}`} className="flex items-center justify-between gap-3 text-sm"><span className="text-white/55">{row.reason === "advent" ? "Адвент-календарь" : row.reason === "purchase" ? "Покупка" : "Задание"} · {new Date(row.created_at).toLocaleDateString("ru-RU")}</span><b className={row.amount > 0 ? "text-emerald-200" : "text-rose-200"}>{row.amount > 0 ? "+" : ""}{row.amount} SC</b></li>)}</ul> : <p className="mt-2 text-sm text-white/40">Операций пока нет.</p>}
          </section>
          {!user && <p className="mt-6 rounded-xl border border-cyan-100/15 bg-cyan-100/5 p-4 text-sm text-cyan-50/75">Чтобы получать SnowCoins, покупать украшения и открывать награды, войди в аккаунт на главной странице.</p>}
        </>}
      </div>
    </main>
  );
}
