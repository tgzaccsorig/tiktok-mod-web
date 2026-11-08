"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { useStore } from "@/hooks/useStore";
import { clampContribution, worldGoalProgress, WINTER_WEATHER, WINTER_WORLD_EVENTS, type WinterEventKey, type WinterWeatherKey } from "@/lib/winter-world";

type WorldState = {
  date: string; weather_key: WinterWeatherKey; weather_slot: number;
  event_key: WinterEventKey; event_slot: string; event_claimed: boolean; event_reward: number;
  goal: { cycle_key: string; title: string; description: string; target: number; total: number;
    my_contribution: number; reward_coins: number; reward_claimed: boolean };
};

function messageFor(error: unknown): string {
  const value = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "") : String(error ?? "");
  if (value.includes("event_not_started")) return "Winter Fest ещё не начался.";
  if (value.includes("authentication_required")) return "Войди в аккаунт, чтобы участвовать.";
  if (value.includes("insufficient_balance")) return "Не хватает SnowCoins для такого вклада.";
  if (value.includes("weekly_contribution_limit")) return "На этой неделе ты уже внёс максимальные 500 SC.";
  if (value.includes("world_event_already_claimed")) return "Подарок этого события уже получен.";
  if (value.includes("world_goal_not_complete")) return "Общая цель ещё не достигнута.";
  if (value.includes("world_goal_reward_unavailable")) return "Награда недоступна: сначала внеси вклад или проверь, не забрал ли её раньше.";
  if (value.includes("invalid_contribution")) return "Вклад должен быть от 1 до 500 SC.";
  return "Не удалось выполнить действие. Обнови страницу и попробуй ещё раз.";
}

export default function WinterWorldPage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [store] = useStore();
  const [user, setUser] = useState<User | null>(null);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [amount, setAmount] = useState("10");
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testPreview, setTestPreview] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase не настроен."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const currentUser = auth.user ?? null;
      setUser(currentUser);
      let preview = false;
      if (currentUser?.app_metadata?.role === "admin") {
        const { data: settings, error: settingsError } = await supabase
          .from("winter_event_settings").select("test_mode,test_date").eq("id", true).maybeSingle();
        if (settingsError) throw settingsError;
        preview = !!settings?.test_mode && String(settings?.test_date ?? "") >= "2026-12-20";
      }
      setTestPreview(preview);
      const { data, error: stateError } = await supabase.rpc("winter_world_state");
      if (stateError) throw stateError;
      setWorld(data as WorldState);
    } catch (e) { setError(messageFor(e)); }
    finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const active = !!world && world.date >= "2026-12-20" && (testPreview || new Date().toISOString() >= "2026-12-19T22:00:00.000Z");
  const weather = world ? WINTER_WEATHER[world.weather_key] : null;
  const event = world ? WINTER_WORLD_EVENTS[world.event_key] : null;
  const progress = world ? worldGoalProgress(world.goal.total, world.goal.target) : 0;

  const run = async (key: string, rpc: string, args?: Record<string, unknown>) => {
    if (!supabase || !user || busy) { if (!user) setError("Войди в аккаунт, чтобы участвовать в активностях."); return; }
    setBusy(key); setError(""); setNotice("");
    try {
      const { data, error: rpcError } = await supabase.rpc(rpc, args ?? {});
      if (rpcError) throw rpcError;
      if (data && typeof data === "object" && "balance" in data) setBalance(Number((data as { balance: number }).balance));
      setNotice(key === "event" ? "Подарок события добавлен на баланс!" : key === "contribute" ? "Твой вклад добавлен в общую цель!" : "Награда за общую цель получена!");
      await load();
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(null); }
  };

  const contribute = () => {
    const safeAmount = clampContribution(Number(amount));
    setAmount(String(safeAmount));
    void run("contribute", "winter_contribute_world_goal", { p_amount: safeAmount });
  };

  return (
    <main data-theme={store.settings.theme} className="winter-page relative h-dvh max-h-dvh min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y bg-[#07101b] px-4 py-7 text-white sm:px-6">
      <div aria-hidden className="winter-snow-decor"><span>❄</span><span>✦</span><span>❄</span><span>✧</span><span>❄</span></div>
      <div className="relative z-10 mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/winter-fest" className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 hover:bg-white/10">← Winter Fest</Link>
          <Link href="/" className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/75">На главную</Link>
        </div>
        <header className="mt-7 overflow-hidden rounded-[2rem] border border-cyan-100/20 bg-gradient-to-br from-[#102b40] via-[#123c4a] to-[#261e45] p-6 shadow-2xl sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-200">Winter Fest 2027 · World</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Живой зимний мир</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">Погода меняется в течение дня, праздничные события сменяют друг друга, а общую цель выполняют все игроки вместе.</p>
          {testPreview && <span className="mt-4 inline-flex rounded-full border border-amber-200/30 bg-amber-200/10 px-3 py-1 text-[10px] font-black tracking-widest text-amber-100">TEST MODE · ТОЛЬКО ДЛЯ АДМИНА</span>}
        </header>

        {error && <p role="alert" className="mt-5 rounded-xl border border-red-300/20 bg-red-300/5 p-3 text-sm text-red-100">{error}</p>}
        {notice && <p role="status" className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-3 text-sm text-emerald-100">{notice}</p>}
        {loading && <p className="mt-5 text-sm text-cyan-100/70">Загружаю состояние мира…</p>}

        {!loading && !active && <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-xl font-bold">Мир скоро откроется</h2>
          <p className="mt-2 text-sm leading-6 text-white/60">Погода, события и общая цель станут доступны 20 декабря 2026 года. Администратор может проверить их заранее в приватном тестовом режиме.</p>
        </section>}

        {active && world && weather && event && <>
          <section className="mt-6 grid gap-4 md:grid-cols-2">
            <article className="rounded-[1.7rem] border border-sky-200/20 bg-gradient-to-br from-[#153b52] to-[#20274a] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-200/65">Погода · обновление каждые 6 часов</p>
              <div className="mt-5 flex items-center gap-4"><span className="text-6xl">{weather.icon}</span><div><h2 className="text-2xl font-black">{weather.title}</h2><p className="mt-1 text-sm text-white/55">{weather.description}</p></div></div>
              <p className="mt-5 text-xs text-white/40">Время мира: Хельсинки · слот {world.weather_slot + 1}/4</p>
            </article>
            <article className="rounded-[1.7rem] border border-violet-200/20 bg-gradient-to-br from-[#2a2148] to-[#18364a] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-200/65">Случайное событие · обновление каждые 12 часов</p>
              <div className="mt-5 flex items-center gap-4"><span className="text-6xl">🎉</span><div><h2 className="text-2xl font-black">{event.title}</h2><p className="mt-1 text-sm text-white/55">{event.description}</p></div></div>
              <button type="button" disabled={!user || busy !== null || world.event_claimed} onClick={() => void run("event", "winter_claim_world_event")} className="mt-5 w-full rounded-xl bg-violet-200 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-40">
                {world.event_claimed ? "Подарок этого события получен ✓" : busy === "event" ? "Получаем…" : "Забрать подарок · +" + world.event_reward + " SC"}
              </button>
            </article>
          </section>

          <section className="mt-5 rounded-[1.7rem] border border-emerald-200/20 bg-gradient-to-br from-[#123d3b] via-[#173d42] to-[#1b2944] p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200/70">Общая цель игроков · неделя {world.goal.cycle_key}</p>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">{world.goal.title}</h2>
            <p className="mt-2 max-w-2xl text-sm text-white/60">{world.goal.description}</p>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-3xl font-black tabular-nums">{world.goal.total.toLocaleString("ru-RU")} <span className="text-base text-emerald-100/70">/ {world.goal.target.toLocaleString("ru-RU")} SC</span></p><p className="mt-1 text-xs text-white/45">Твой вклад: {world.goal.my_contribution} SC · награда: +{world.goal.reward_coins} SC</p></div><p className="text-2xl font-black text-emerald-100">{Math.floor(progress)}%</p></div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/25"><div className="h-full rounded-full bg-emerald-200 transition-all" style={{ width: progress + "%" }} /></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="text-xs text-white/55">Твой вклад (1–500 SC за неделю)
                <input type="number" min="1" max="500" step="1" value={amount} onChange={e => setAmount(e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-base text-white outline-none focus:border-emerald-200/50" />
              </label>
              <button type="button" disabled={!user || busy !== null || world.goal.my_contribution >= 500 || !Number.isFinite(Number(amount)) || Number(amount) < 1 || Number(amount) > 500 || (balance !== null && balance < Number(amount))} onClick={contribute} className="self-end rounded-xl bg-emerald-200 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-40">
                {busy === "contribute" ? "Вносим…" : "Внести SnowCoins"}
              </button>
            </div>
            {world.goal.total >= world.goal.target && <div className="mt-5 rounded-xl border border-amber-200/25 bg-amber-200/10 p-4">
              <p className="font-bold text-amber-100">Общая цель выполнена! 🎄</p>
              <p className="mt-1 text-xs text-white/60">Каждый участник, внёсший вклад, может получить награду один раз.</p>
              <button type="button" disabled={!user || busy !== null || world.goal.my_contribution <= 0 || world.goal.reward_claimed} onClick={() => void run("goal-reward", "winter_claim_world_goal_reward")} className="mt-3 rounded-lg bg-amber-200 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-40">
                {world.goal.reward_claimed ? "Награда получена ✓" : busy === "goal-reward" ? "Получаем…" : "Забрать +" + world.goal.reward_coins + " SC"}
              </button>
            </div>}
          </section>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs text-white/50">{user ? "Ты вошёл как " + (user.user_metadata?.username ? "@" + user.user_metadata.username : user.email ?? "игрок") + "." : "Войди в аккаунт, чтобы получать подарки и вносить вклад в общую цель."}</p>
            <button type="button" onClick={() => void load()} disabled={loading || busy !== null} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/75 disabled:opacity-40">Обновить мир</button>
          </div>
        </>}
      </div>
    </main>
  );
}
