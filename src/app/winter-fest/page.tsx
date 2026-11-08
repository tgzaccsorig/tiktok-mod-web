"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type ClickerUpgrade = { upgrade_key:string; title:string; description:string; icon:string; base_cost:number; power_per_level:number; level:number; next_cost:number|null };
type ClickerState = { level: number; clicks_total: number; earned_total: number; click_power: number; next_upgrade_cost: number | null; upgrades?: ClickerUpgrade[] };
type Snowman = { snowman_key:string; title:string; description:string; icon:string; base_cost:number; income_per_level:number; level:number; max_level:number; next_cost:number|null; income_per_minute:number };
type AutoClickerState = { snowmen:Snowman[]; income_per_minute:number; collected:number; balance:number };
const DEFAULT_CLICKER_UPGRADES: ClickerUpgrade[] = [
  {upgrade_key:"power",title:"Сила снежинки",description:"Больше SnowCoins за каждое нажатие",icon:"❄️",base_cost:40,power_per_level:3,level:0,next_cost:40},
  {upgrade_key:"gloves",title:"Волшебные перчатки",description:"Усиливают каждый клик",icon:"🧤",base_cost:60,power_per_level:2,level:0,next_cost:60},
  {upgrade_key:"comet",title:"Кометный след",description:"Добавляет бонус к сбору",icon:"☄️",base_cost:90,power_per_level:2,level:0,next_cost:90},
  {upgrade_key:"crystal",title:"Кристальный фокус",description:"Увеличивает отдачу клика",icon:"💎",base_cost:120,power_per_level:3,level:0,next_cost:120},
  {upgrade_key:"streak",title:"Снежная серия",description:"Бонус за активные клики",icon:"🔥",base_cost:160,power_per_level:2,level:0,next_cost:160},
  {upgrade_key:"magnet",title:"Монетный магнит",description:"Притягивает дополнительные монеты",icon:"🧲",base_cost:220,power_per_level:2,level:0,next_cost:220},
  {upgrade_key:"aurora",title:"Сила авроры",description:"Усиливает общий доход",icon:"🌌",base_cost:300,power_per_level:4,level:0,next_cost:300},
  {upgrade_key:"crown",title:"Корона зимы",description:"Редкое мощное улучшение",icon:"👑",base_cost:450,power_per_level:5,level:0,next_cost:450},
];
const DEFAULT_SNOWMEN: Snowman[] = [
  {snowman_key:"helper",title:"Снеговик-помощник",description:"Начинает собирать SnowCoins вместо тебя",icon:"⛄",base_cost:120,income_per_level:1,level:0,max_level:25,next_cost:120,income_per_minute:0},
  {snowman_key:"lantern",title:"Снеговик-фонарщик",description:"Собирает монеты в ночную смену",icon:"🏮",base_cost:450,income_per_level:4,level:0,max_level:25,next_cost:450,income_per_minute:0},
  {snowman_key:"miner",title:"Снежный шахтёр",description:"Добывает ледяные кристаллы и монеты",icon:"⛏️",base_cost:1400,income_per_level:12,level:0,max_level:25,next_cost:1400,income_per_minute:0},
  {snowman_key:"polar",title:"Полярный снеговик",description:"Ускоряет сбор благодаря северному сиянию",icon:"🐻‍❄️",base_cost:4200,income_per_level:35,level:0,max_level:25,next_cost:4200,income_per_minute:0},
  {snowman_key:"captain",title:"Снежный капитан",description:"Командует целой бригадой снеговиков",icon:"🎖️",base_cost:12000,income_per_level:100,level:0,max_level:25,next_cost:12000,income_per_minute:0},
];
const WINTER_QUIZ = [{q:"Как называется северное сияние?",a:["Аврора","Комета","Метель"],correct:0},{q:"Какое дерево украшают на Новый год?",a:["Берёза","Ель","Клён"],correct:1},{q:"Из чего лепят снеговика?",a:["Из песка","Из снега","Из листьев"],correct:1}];

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
  const message = error && typeof error === "object" && "message" in error
    ? String((error as {message?:unknown}).message ?? "")
    : error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("event_not_started")) return "Событие ещё не началось.";
  if (message.includes("already_claimed")) return "Эта награда уже получена.";
  if (message.includes("advent_day_locked")) return "Этот день пока закрыт.";
  if (message.includes("insufficient_balance")) return "Не хватает SnowCoins.";
  if (message.includes("already_owned")) return "Этот предмет уже есть в инвентаре.";
  if (message.includes("quest_not_ready")) return "Задание ещё не выполнено или награда уже получена.";
  if (message.includes("click_too_fast")) return "Не так быстро! Кликни ещё раз через мгновение.";
  if (message.includes("clicker_max_level")) return "Кликер уже прокачан до максимального уровня.";
  if (message.includes("snowman_max_level")) return "Этот снеговик уже достиг максимального уровня.";
  if (message.includes("snowman_not_found")) return "Такого снеговика больше нет в магазине.";
  if (message.includes("23505") || message.includes("duplicate key")) return "Эта операция уже была учтена. Обнови страницу и попробуй ещё раз.";
  return "Не удалось выполнить действие. Попробуй ещё раз.";
}

export default function WinterFestPage() {
  const supabase = useMemo(() => getSupabase(), []);
  const [store] = useStore();
  const [now, setNow] = useState(() => new Date());
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState(0);
  const [clicker, setClicker] = useState<ClickerState>({level:0,clicks_total:0,earned_total:0,click_power:1,next_upgrade_cost:null,upgrades:[]});
  const [autoClicker, setAutoClicker] = useState<AutoClickerState>({snowmen:[],income_per_minute:0,collected:0,balance:0});
  const [memoryDeck,setMemoryDeck]=useState(()=>["❄️","🎄","🎁","⛄","🎄","❄️","🐧","🎁","🐧","⛄"].sort(()=>Math.random()-.5));
  const [memoryPicks,setMemoryPicks]=useState<number[]>([]);
  const [memoryMatches,setMemoryMatches]=useState<number[]>([]);
  const [quizIndex,setQuizIndex]=useState(0);
  const [quizScore,setQuizScore]=useState(0);
  const [quizDone,setQuizDone]=useState(false);
  const [snowFound,setSnowFound]=useState<number[]>([]);
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
  const upgradeLockRef = useRef(false);
  const clickLockRef = useRef(false);
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
        setClicker({level:1,clicks_total:0,earned_total:0,click_power:1,next_upgrade_cost:null,upgrades:[]});
        setAutoClicker({snowmen:[],income_per_minute:0,collected:0,balance:0});
        return;
      }
      const [wallet, userClaims, inventory, worn, questProgress, history, clickerState, autoClickerState] = await Promise.all([
        supabase.from("winter_wallets").select("balance").eq("user_id", currentUser.id).maybeSingle(),
        supabase.from("winter_advent_claims").select("day").eq("user_id", currentUser.id),
        supabase.from("winter_inventory").select("item_slug").eq("user_id", currentUser.id),
        supabase.from("winter_equipped_items").select("slot,item_slug").eq("user_id", currentUser.id),
        supabase.from("winter_quest_progress").select("quest_slug,cycle_key,progress,completed_at,claimed_at").eq("user_id", currentUser.id),
        supabase.from("winter_coin_ledger").select("amount,reason,created_at").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(12),
        supabase.rpc("winter_clicker_state"),
        supabase.rpc("winter_auto_clicker_state"),
      ]);
      const privateError = [wallet,userClaims,inventory,worn,questProgress,history].find((result) => result.error)?.error;
      if (privateError) throw privateError;
      const autoState = autoClickerState.data as AutoClickerState | null;
      const clickerData = clickerState.data as ClickerState | null;
      setBalance(autoState?.balance ?? wallet.data?.balance ?? 0);
      if (clickerState.error) {
        setClicker((previous) => ({...previous,upgrades:previous.upgrades?.length ? previous.upgrades : DEFAULT_CLICKER_UPGRADES}));
        setError("Не удалось получить прогресс улучшений кликера. Сами ветки оставлены на экране — попробуй обновить страницу.");
      } else {
        const state = clickerData ?? {level:0,clicks_total:0,earned_total:0,click_power:1,next_upgrade_cost:null};
        setClicker({...state,upgrades:state.upgrades?.length ? state.upgrades : DEFAULT_CLICKER_UPGRADES});
      }
      if (autoClickerState.error) {
        setAutoClicker((previous) => ({...previous,snowmen:previous.snowmen?.length ? previous.snowmen : DEFAULT_SNOWMEN}));
        if (!clickerState.error) setError("Не удалось загрузить состояние снеговиков. Карточки оставлены на экране; обнови страницу для синхронизации.");
      } else {
        setAutoClicker({
          snowmen: Array.isArray(autoState?.snowmen) && autoState.snowmen.length ? autoState.snowmen : DEFAULT_SNOWMEN,
          income_per_minute: autoState?.income_per_minute ?? 0,
          collected: autoState?.collected ?? 0,
          balance: autoState?.balance ?? wallet.data?.balance ?? 0,
        });
      }
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

  const clickSnowCoin = async () => {
    if (!supabase || !user || busy || clickLockRef.current) { if (!user) setError("Войди в аккаунт, чтобы собирать SnowCoins."); return; }
    clickLockRef.current=true; setBusy("clicker"); setError(""); setMessage("");
    try {
      const {data,error:rpcError} = await supabase.rpc("winter_clicker_click");
      if (rpcError) throw rpcError;
      const result = data as ClickerState & {balance:number;reward:number};
      setBalance(result.balance);
      setClicker((previous)=>({
        ...previous,
        level:result.level ?? previous.level,
        clicks_total:result.clicks_total ?? previous.clicks_total,
        earned_total:result.earned_total ?? previous.earned_total,
        click_power:result.click_power ?? previous.click_power,
        next_upgrade_cost:result.next_upgrade_cost === undefined ? previous.next_upgrade_cost : result.next_upgrade_cost,
        upgrades:previous.upgrades?.length ? previous.upgrades : DEFAULT_CLICKER_UPGRADES,
      }));
    } catch (e) { setError(errorMessage(e)); }
    finally { clickLockRef.current=false; setBusy(null); }
  };

  const upgradeClicker = async (upgradeKey:string) => {
    if (!supabase || !user || upgradeLockRef.current) { if (!user) setError("Войди в аккаунт, чтобы прокачать кликер."); return; }
    upgradeLockRef.current=true; setBusy("clicker-upgrade"); setError(""); setMessage("");
    try {
      const request = supabase.rpc("winter_clicker_upgrade",{p_upgrade_key:upgradeKey});
      const timed = await Promise.race([
        request,
        new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error("timeout")),12000))
      ]);
      if (timed.error) throw timed.error;
      const result = timed.data as {upgrade_key:string;level:number;balance:number};
      setBalance(result.balance);
      setClicker(previous=>{
        const upgrades=(previous.upgrades??[]).map(upgrade=>{
          if(upgrade.upgrade_key!==upgradeKey) return upgrade;
          const level=result.level;
          return {...upgrade,level,next_cost:level>=40?null:Math.ceil(upgrade.base_cost*Math.pow(level+1,1.45))};
        });
        const upgraded=previous.upgrades?.find(upgrade=>upgrade.upgrade_key===upgradeKey);
        return {...previous,level:previous.level+1,click_power:previous.click_power+(upgraded?.power_per_level??0),upgrades};
      });
      setMessage("Улучшение установлено! Сила сбора выросла.");
    } catch (e) { setError(e instanceof Error && e.message==="timeout" ? "Сервер долго отвечает. Обнови страницу и проверь баланс — операция могла завершиться." : errorMessage(e)); }
    finally { upgradeLockRef.current=false; setBusy(null); }
  };

  const upgradeSnowman = async (snowmanKey:string) => {
    if (!supabase || !user || upgradeLockRef.current) { if (!user) setError("Войди в аккаунт, чтобы нанять снеговиков."); return; }
    upgradeLockRef.current=true; setBusy("snowman-upgrade"); setError(""); setMessage("");
    try {
      const request=supabase.rpc("winter_auto_clicker_upgrade",{p_snowman_key:snowmanKey});
      const result=await Promise.race([
        request,
        new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error("timeout")),12000))
      ]);
      if(result.error) throw result.error;
      const upgraded=result.data as {snowman_key:string;level:number;balance:number};
      setBalance(upgraded.balance);
      setAutoClicker(previous=>{
        const snowmen=previous.snowmen.map(snowman=>{
          if(snowman.snowman_key!==snowmanKey) return snowman;
          const level=upgraded.level;
          return {...snowman,level,income_per_minute:level*snowman.income_per_level,
            next_cost:level>=snowman.max_level?null:Math.ceil(snowman.base_cost*Math.pow(level+1,1.6))};
        });
        const income_per_minute=snowmen.reduce((sum,snowman)=>sum+snowman.income_per_minute,0);
        return {...previous,snowmen,income_per_minute,balance:upgraded.balance};
      });
      setMessage("Снеговик улучшен! Его автоматический доход вырос.");
    } catch(e) { setError(e instanceof Error && e.message==="timeout" ? "Сервер долго отвечает. Обнови страницу и проверь баланс — операция могла завершиться." : errorMessage(e)); }
    finally { upgradeLockRef.current=false; setBusy(null); }
  };

  const collectSnowmen = async () => {
    if (!supabase || !user || busy) return;
    setBusy("snowman-collect"); setError(""); setMessage("");
    try {
      const {data,error:stateError}=await supabase.rpc("winter_auto_clicker_state");
      if(stateError) throw stateError;
      const next=data as AutoClickerState;
      setAutoClicker({...next,snowmen:Array.isArray(next?.snowmen) && next.snowmen.length ? next.snowmen : DEFAULT_SNOWMEN}); setBalance(next.balance);
      setMessage(next.collected>0 ? `Снеговики принесли +${next.collected} SnowCoins!` : "Снеговики пока копят монеты. Загляни чуть позже!");
    } catch(e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  };

  const pickMemoryCard=(index:number)=>{if(memoryMatches.includes(index)||memoryPicks.includes(index))return;if(memoryPicks.length>=2){setMemoryPicks([index]);return;}const next=[...memoryPicks,index];setMemoryPicks(next);if(next.length===2&&memoryDeck[next[0]]===memoryDeck[next[1]]){setMemoryMatches(old=>[...old,...next]);setMemoryPicks([]);}};
  const resetMemory=()=>{setMemoryDeck(["❄️","🎄","🎁","⛄","🎄","❄️","🐧","🎁","🐧","⛄"].sort(()=>Math.random()-.5));setMemoryPicks([]);setMemoryMatches([]);};
  const answerQuiz=(answer:number)=>{if(quizDone)return;if(answer===WINTER_QUIZ[quizIndex].correct)setQuizScore(v=>v+1);if(quizIndex===2)setQuizDone(true);else setQuizIndex(v=>v+1);};
  const resetQuiz=()=>{setQuizIndex(0);setQuizScore(0);setQuizDone(false);};

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
    <main data-theme={store.settings.theme} className="winter-page relative h-dvh max-h-dvh min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y bg-[#07101b] px-4 py-7 text-white sm:px-6">\n      <div aria-hidden className="winter-snow-decor"><span>❄</span><span>✦</span><span>❄</span><span>✧</span><span>❄</span></div>
      <div className="relative z-10 mx-auto max-w-5xl">
        <Link href="/" className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 hover:bg-white/10">← Назад в TikTok Mod Web</Link>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><Link href="/winter-fest/world" className="rounded-full border border-cyan-200/25 bg-cyan-200/10 px-4 py-2 text-xs font-bold text-cyan-100">🌨️ Живой мир</Link><Link href="/winter-fest/admin" className="rounded-full border border-amber-200/30 bg-amber-200/10 px-4 py-2 text-xs font-bold text-amber-100">⚙ Админ-панель</Link></div>
        <header className="winter-hero relative mt-7 overflow-hidden rounded-[2rem] border border-cyan-100/20 bg-gradient-to-br from-[#102b40] via-[#123c4a] to-[#261e45] p-6 shadow-2xl sm:p-10">
          <div className="pointer-events-none absolute -right-8 -top-12 text-[10rem] opacity-10">❄️</div><div className="pointer-events-none absolute -bottom-8 -left-5 rotate-12 text-7xl opacity-10">🎄</div><div className="pointer-events-none absolute right-16 top-5 text-3xl opacity-40">✨</div>
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

          <section className="mt-8 overflow-hidden rounded-[2rem] border border-cyan-200/20 bg-gradient-to-br from-[#123b4a] via-[#142c48] to-[#30214b] p-5 shadow-xl sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/75">01 · Snow Clicker</p><h2 className="mt-1 text-2xl font-black sm:text-3xl">Лови SnowCoins!</h2><p className="mt-1 max-w-lg text-sm text-white/60">Нажимай на снежный кристалл, собирай монетки и улучшай силу каждого клика.</p></div><div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right"><p className="text-[10px] uppercase tracking-widest text-white/45">Сила клика</p><p className="text-2xl font-black text-cyan-100">+{clicker.click_power} SC</p></div></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr]">
              <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/15 p-4">
                <button type="button" onClick={() => void clickSnowCoin()} disabled={!user || busy !== null} aria-label="Собрать SnowCoins" className="group grid h-36 w-36 place-items-center rounded-full border-4 border-cyan-100/40 bg-gradient-to-br from-cyan-100/35 via-sky-300/20 to-indigo-300/30 text-6xl shadow-[0_0_55px_rgba(103,232,249,0.22)] transition hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:h-44 sm:w-44 sm:text-7xl">❄️</button>
                <p className="mt-3 text-sm font-bold text-cyan-100">{busy === "clicker" ? "Собираем..." : user ? `+${clicker.click_power} SnowCoins за нажатие` : "Войди, чтобы играть"}</p>
              </div>
              <div className="grid content-center gap-3">
                <div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-black/20 p-3"><p className="text-[10px] text-white/45">Всего кликов</p><p className="mt-1 text-xl font-black tabular-nums">{clicker.clicks_total.toLocaleString("ru-RU")}</p></div><div className="rounded-xl bg-black/20 p-3"><p className="text-[10px] text-white/45">Заработано в кликере</p><p className="mt-1 text-xl font-black tabular-nums">{clicker.earned_total.toLocaleString("ru-RU")} SC</p></div></div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between gap-2"><b>Центр улучшений</b><span className="text-xs text-cyan-100">8 веток · 40 уровней</span></div><p className="mt-2 text-xs leading-5 text-white/55">Прокачивай разные свойства снежного кликера. Каждая ветка имеет 40 уровней и собственную стоимость.</p><div className="mt-3 grid gap-2">{(clicker.upgrades??[]).map((upgrade)=><article key={upgrade.upgrade_key} className="rounded-xl border border-white/10 bg-white/[0.035] p-3"><div className="flex items-start gap-2"><span className="text-2xl">{upgrade.icon}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="text-sm">{upgrade.title}</b><span className="shrink-0 text-xs text-cyan-100">{upgrade.level}/40</span></div><p className="mt-1 text-[11px] text-white/50">{upgrade.description}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-200" style={{width:(upgrade.level/40*100)+"%"}}/></div><button type="button" onClick={()=>void upgradeClicker(upgrade.upgrade_key)} disabled={!user||busy!==null||upgrade.next_cost===null||balance<upgrade.next_cost} className="mt-2 w-full rounded-lg bg-cyan-200 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-40">{upgrade.next_cost===null?"Максимум · 40/40":busy==="clicker-upgrade"?"Покупаем улучшение…":"Улучшить · "+upgrade.next_cost.toLocaleString("ru-RU")+" SC"}</button></div></div></article>)}{!(clicker.upgrades??[]).length&&<div className="rounded-lg bg-black/20 p-3 text-xs text-white/50">{loading?"Загружаем улучшения…":<>Не удалось загрузить список улучшений. <button type="button" onClick={()=>void loadData()} className="font-bold text-cyan-200 underline">Повторить</button></>}</div>}</div></div>
              </div>
            </div>
          </section>

                    {clicker.level>=320&&<div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-200/30 bg-gradient-to-r from-amber-200/15 to-yellow-100/5 p-4"><span className="text-4xl">🏆</span><div><b className="text-amber-100">Трофей: Легенда снежного клика</b><p className="mt-1 text-xs text-white/60">Эксклюзивный легендарный значок автоматически добавлен в коллекцию.</p></div></div>}
          <section className="mt-6 overflow-hidden rounded-[2rem] border border-sky-200/20 bg-gradient-to-br from-[#19364a] via-[#1c3c50] to-[#29314f] p-5 shadow-xl sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-sky-200/75">Snowman Auto Crew</p><h2 className="mt-1 text-2xl font-black">⛄ Бригада снеговиков</h2><p className="mt-1 max-w-xl text-sm text-white/60">Нанимай снеговиков, повышай их уровни и получай монеты автоматически. Доход копится, пока тебя нет на сайте, максимум за 12 часов.</p></div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right"><p className="text-[10px] uppercase tracking-widest text-white/45">Доход в минуту</p><p className="text-2xl font-black text-sky-100">+{autoClicker.income_per_minute} SC</p></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {autoClicker.snowmen.map((snowman)=><article key={snowman.snowman_key} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-3"><span className="grid h-14 w-14 place-items-center rounded-xl bg-sky-100/10 text-3xl">{snowman.icon}</span><div className="min-w-0"><b>{snowman.title}</b><p className="text-xs text-white/45">Уровень {snowman.level}/{snowman.max_level}</p></div></div>
                <p className="mt-3 min-h-9 text-xs leading-5 text-white/55">{snowman.description}</p>
                <p className="mt-2 text-sm font-bold text-sky-100">+{snowman.income_per_minute} SC/мин</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-sky-200" style={{width:(snowman.level/snowman.max_level*100)+"%"}}/></div>
                <button type="button" onClick={()=>void upgradeSnowman(snowman.snowman_key)} disabled={!user||busy!==null||snowman.next_cost===null||balance<snowman.next_cost} className="mt-3 w-full rounded-lg bg-sky-200 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-40">{snowman.next_cost===null?"Максимум достигнут":busy==="snowman-upgrade"?"Улучшаем снеговика…":"Нанять / улучшить · "+snowman.next_cost.toLocaleString("ru-RU")+" SC"}</button>
              </article>)}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/15 p-3">
              <p className="text-xs text-white/55">Снеговики продолжают работать между посещениями. Накопленный доход: до 12 часов.</p>
              <button type="button" onClick={()=>void collectSnowmen()} disabled={!user||busy!==null} className="rounded-lg border border-sky-100/30 bg-sky-100/10 px-4 py-2 text-xs font-bold text-sky-100 disabled:opacity-40">{busy==="snowman-collect"?"Собираем...":"Забрать накопленные монеты"}</button>
            </div>
          </section>

          <section className="mt-8 rounded-[2rem] border border-violet-200/20 bg-gradient-to-br from-[#211a3d] via-[#1b2946] to-[#103b46] p-5 shadow-xl sm:p-7">
            <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[.25em] text-violet-200/70">02 · Snow Arcade</p><h2 className="mt-1 text-2xl font-black">Зимняя игровая зона</h2><p className="mt-1 text-sm text-white/55">Три мини-игры, чтобы отвлечься от сбора монет.</p></div>
            <div className="grid gap-4 lg:grid-cols-3">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between"><b>🧠 Снежная память</b><span className="text-xs text-cyan-100">{memoryMatches.length/2}/5</span></div><p className="mt-2 text-xs text-white/50">Открой одинаковые символы.</p><div className="mt-3 grid grid-cols-5 gap-2">{memoryDeck.map((symbol,index)=><button key={index} onClick={()=>pickMemoryCard(index)} disabled={memoryMatches.includes(index)} className={`aspect-square rounded-xl border text-xl ${memoryMatches.includes(index)||memoryPicks.includes(index)?"border-emerald-200/40 bg-emerald-200/20":"border-white/10 bg-white/10"}`}>{memoryMatches.includes(index)||memoryPicks.includes(index)?symbol:"❔"}</button>)}</div>{memoryMatches.length===10?<p className="mt-3 text-xs font-bold text-emerald-200">Все пары найдены! 🎉</p>:<p className="mt-3 text-xs text-white/45">Совпадений: {memoryMatches.length/2} из 5</p>}<button onClick={resetMemory} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-xs">Перемешать</button></article>
              <article className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between"><b>❄️ Зимняя викторина</b><span className="text-xs text-cyan-100">{quizDone?"Готово":`${quizIndex+1}/3`}</span></div>{quizDone?<div className="mt-5 rounded-xl bg-white/5 p-4 text-center"><p className="text-3xl">🏅</p><b className="mt-2 block text-xl">{quizScore}/3 правильных</b><button onClick={resetQuiz} className="mt-4 rounded-lg bg-violet-200 px-4 py-2 text-xs font-bold text-slate-950">Ещё раз</button></div>:<><p className="mt-5 min-h-14 text-sm font-semibold">{WINTER_QUIZ[quizIndex].q}</p><div className="mt-3 grid gap-2">{WINTER_QUIZ[quizIndex].a.map((answer,index)=><button key={answer} onClick={()=>answerQuiz(index)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-xs hover:bg-white/10">{answer}</button>)}</div></>}</article>
              <article className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between"><b>🔎 Охота за снежинками</b><span className="text-xs text-cyan-100">{snowFound.length}/12</span></div><p className="mt-2 text-xs text-white/50">Найди все двенадцать снежинок на поле.</p><div className="mt-4 grid grid-cols-4 gap-2">{Array.from({length:12},(_,index)=><button key={index} onClick={()=>setSnowFound(old=>old.includes(index)?old:[...old,index])} disabled={snowFound.includes(index)} aria-label={`Снежинка ${index+1}`} className={`aspect-square rounded-xl border text-2xl transition ${snowFound.includes(index)?"border-cyan-100/40 bg-cyan-100/20":"border-white/10 bg-white/5 hover:bg-white/15"}`}>{snowFound.includes(index)?"❄️":"🌨️"}</button>)}</div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-200 transition-all" style={{width:`${snowFound.length/12*100}%`}}/></div>{snowFound.length===12&&<div className="mt-3 rounded-xl bg-emerald-200/10 p-3 text-center"><b className="text-sm text-emerald-100">Коллекция собрана! 🎁</b><button onClick={()=>setSnowFound([])} className="mt-2 block w-full rounded-lg border border-white/15 px-3 py-2 text-xs">Спрятать снежинки снова</button></div>}</article>
            </div>
          </section>

<section className="mt-8">
            <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/65">02 · Advent</p><h2 className="mt-1 text-2xl font-extrabold">Адвент-календарь</h2><p className="mt-1 text-sm text-white/45">Один подарок на каждый день. Будущие даты закрыты, повторно забрать награду нельзя.</p></div>
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
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/65">04 · Quests</p><h2 className="mt-1 text-2xl font-extrabold">Праздничные задания</h2>
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
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/65">05 · Shop</p><h2 className="mt-1 text-2xl font-extrabold">Магазин украшений</h2>
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
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200/65">06 · Competitions</p><h2 className="mt-1 text-2xl font-extrabold">Новогодние конкурсы</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {competitions.length ? competitions.map((competition) => <article key={competition.slug} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><h3 className="font-bold">{competition.title}</h3><p className="mt-2 text-sm text-white/50">{competition.description}</p><p className="mt-3 text-xs text-cyan-100/60">Статус: {competition.status}</p>{competition.winner_user_id && <p className="mt-2 text-xs text-emerald-200">Победитель определён организатором.</p>}<div className="mt-3 border-t border-white/10 pt-3"><p className="text-xs font-semibold text-white/60">Участники: {entries.filter((entry) => entry.competition_slug === competition.slug).length}</p>{entries.filter((entry) => entry.competition_slug === competition.slug).slice(0,8).map((entry) => <div key={entry.id} className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="truncate text-white/55">@{entry.profile?.username ?? "участник"}</span><a href={entry.video_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-cyan-200 underline">Видео ↗</a></div>)}</div>{competition.status === "open" && <div className="mt-3 space-y-2"><input value={entryUrls[competition.slug] ?? ""} onChange={(event) => setEntryUrls((values) => ({...values,[competition.slug]:event.target.value}))} placeholder="HTTPS-ссылка на TikTok" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-cyan-200/50" /><button disabled={!user || busy !== null} onClick={() => void submitEntry(competition.slug)} className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">Отправить заявку</button></div>}</article>) : <p className="text-sm text-white/45">Конкурсы пока не опубликованы организатором.</p>}
            </div>
          </section>

          <section className="mt-9 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <h2 className="font-bold">История SnowCoins</h2>
            {ledger.length ? <ul className="mt-3 space-y-2">{ledger.map((row,index) => <li key={`${row.created_at}:${index}`} className="flex items-center justify-between gap-3 text-sm"><span className="text-white/55">{row.reason === "advent" ? "Адвент-календарь" : row.reason === "purchase" ? "Покупка" : row.reason === "clicker" ? "Кликер SnowCoins" : row.reason === "clicker_upgrade" ? "Улучшение кликера" : row.reason === "admin_grant" ? "Начисление администратора" : "Задание"} · {new Date(row.created_at).toLocaleDateString("ru-RU")}</span><b className={row.amount > 0 ? "text-emerald-200" : "text-rose-200"}>{row.amount > 0 ? "+" : ""}{row.amount} SC</b></li>)}</ul> : <p className="mt-2 text-sm text-white/40">Операций пока нет.</p>}
          </section>
          {!user && <p className="mt-6 rounded-xl border border-cyan-100/15 bg-cyan-100/5 p-4 text-sm text-cyan-50/75">Чтобы получать SnowCoins, покупать украшения и открывать награды, войди в аккаунт на главной странице.</p>}
        </>}
      </div>
    </main>
  );
}
