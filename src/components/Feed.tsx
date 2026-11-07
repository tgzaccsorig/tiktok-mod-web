"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadCatalogCache,
  loadCustomCache,
  loadDiscoveredCache,
  saveCatalogCache,
  saveCustomCache,
  saveDiscoveredCache,
  useStore,
} from "@/hooks/useStore";
import { clampIndex, decideSwipe, needsMore, nextPass, playerIndexes, toSlides, visibleIndexes } from "@/lib/feedEngine";
import { buildPass, isRussianVideo } from "@/lib/recommend";
import { normalizeUrl } from "@/lib/tiktok";
import { CATEGORIES, type FeedMode, type Slide, type VideoItem } from "@/lib/types";
import {
  BookmarkIcon,
  FullscreenIcon,
  HeartIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  ShareIcon,
  VolumeIcon,
} from "./Icons";
import Sheet, { reasonLabel, type AddResult } from "./Sheet";
import VideoSlide from "./VideoSlide";
import AccountPanel from "./AccountPanel";
import CommentsPanel from "./CommentsPanel";
import { getSupabase, type AccountIdentity } from "@/lib/supabase";

type Playback = "loading" | "playing" | "paused" | "error";

const CHIPS: { id: FeedMode; label: string }[] = [
  { id: "foryou", label: "Для тебя" },
  { id: "subscriptions", label: "Подписки" },
  { id: "random", label: "Случайные" },
  ...CATEGORIES.map((c) => ({ id: c.id as FeedMode, label: c.label })),
  { id: "favorites", label: "Избранное" },
  { id: "history", label: "История" },
];

const EMPTY_TEXT: Partial<Record<FeedMode, string>> = {
  favorites: "В избранном пока пусто. Нажмите на закладку у любого ролика.",
  history: "История пуста — посмотрите несколько роликов.",
  subscriptions: "Здесь будут новые видео авторов, на которых вы подписались. Войдите и подпишитесь на авторов.",
};

export default function Feed() {
  const [store, update, ready] = useStore();
  const [catalog, setCatalog] = useState<VideoItem[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [customItems, setCustomItems] = useState<VideoItem[]>([]);
  const [customLoaded, setCustomLoaded] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<VideoItem[]>([]);
  const [subscriptionItems, setSubscriptionItems] = useState<VideoItem[]>([]);
  const [discoverInfo, setDiscoverInfo] = useState<{ configured: boolean; intervalMin: number } | null>(null);

  const [queue, setQueue] = useState<Slide[]>([]);
  const [index, setIndex] = useState(0);
  const [playback, setPlayback] = useState<Playback>("loading");
  const [unlocked, setUnlocked] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [reloads, setReloads] = useState<Record<string, number>>({});
  const [sheet, setSheet] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [isFs, setIsFs] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountUser, setAccountUser] = useState<AccountIdentity | null>(null);

  const mode = store.category;
  const currentKey = queue[index]?.key;
  const current = queue[index]?.item;

  /* ---------- refs: актуальные значения для обработчиков событий ---------- */
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const queueRef = useRef<Slide[]>([]);
  const indexRef = useRef(0);
  const storeRef = useRef(store);
  const poolRef = useRef<VideoItem[]>([]);
  const modeRef = useRef(mode);
  const currentKeyRef = useRef<string | undefined>(undefined);
  const playbackRef = useRef<Playback>("loading");
  const soundRef = useRef(false);
  const unlockedRef = useRef(false);
  const sheetRef = useRef(false);
  const confirmedRef = useRef(false);
  const playedRef = useRef(new Set<string>());
  const readyRef = useRef(new Set<string>());
  const mutedState = useRef(new Map<string, boolean>());
  const soundFixed = useRef(new Set<string>());
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const soundTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasPlayingRef = useRef(false);
  const priorityRef = useRef<string[]>([]);
  const accountOwnerRef = useRef<string | null>(null);
  const reloadCountRef = useRef<Record<string, number>>({});
  // Параметры iframe фиксируются, пока плеер смонтирован: смена src перезагрузила бы его.
  const srcOpts = useRef(new Map<string, { muted: boolean; loop: boolean }>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gesture = useRef<{ id: number; y0: number; t0: number; dy: number; first: boolean } | null>(null);

  storeRef.current = store;
  modeRef.current = mode;
  currentKeyRef.current = currentKey;
  playbackRef.current = playback;
  sheetRef.current = sheet;
  unlockedRef.current = unlocked;
  soundRef.current = unlocked && store.settings.sound;

  const pool = useMemo(() => {
    const map = new Map<string, VideoItem>();
    [...subscriptionItems, ...catalog, ...discovered, ...customItems].forEach((v) => {
      if (!map.has(v.id) && !removed.includes(v.id)) map.set(v.id, v);
    });
    return Array.from(map.values());
  }, [subscriptionItems, catalog, discovered, customItems, removed]);
  poolRef.current = pool;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  /* ---------- каталог: мгновенно из кэша, свежий — в фоне (официальный oEmbed через /api/feed) ---------- */
  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/feed");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items: VideoItem[] };
      if (data.items.length > 0) {
        setCatalog(data.items);
        saveCatalogCache(data.items);
      }
      setCatalogState("ready");
    } catch {
      const cached = loadCatalogCache<VideoItem[]>();
      if (cached && cached.length) {
        setCatalog(cached);
        setCatalogState("ready");
      } else {
        setCatalogState((s) => (s === "ready" ? s : "error"));
      }
    }
  }, []);

  useEffect(() => {
    const cached = loadCatalogCache<VideoItem[]>();
    if (cached && cached.length) {
      setCatalog(cached);
      setCatalogState("ready");
    }
    const found = loadDiscoveredCache<VideoItem[]>();
    if (found && found.length) setDiscovered(found);
    loadCatalog();
  }, [loadCatalog]);

  /* ---------- ролики, добавленные пользователем: из кэша сразу, недостающие — по сети в фоне ---------- */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const urls = storeRef.current.custom;
    const cached = (loadCustomCache<VideoItem[]>() ?? []).filter((v) => urls.includes(v.url));
    setCustomItems(cached);
    const missing = urls.filter((u) => !cached.some((v) => v.url === u));
    if (missing.length === 0 || cached.length > 0) setCustomLoaded(true);

    (async () => {
      const fetched: VideoItem[] = [];
      for (const url of missing) {
        try {
          const r = await fetch(`/api/oembed?url=${encodeURIComponent(url)}`);
          const j = (await r.json()) as { ok: boolean; item?: VideoItem };
          if (j.ok && j.item) fetched.push(j.item);
        } catch {
          /* пропускаем */
        }
      }
      if (cancelled) return;
      if (fetched.length) setCustomItems((c) => [...c, ...fetched.filter((f) => !c.some((x) => x.id === f.id))]);
      setCustomLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  useEffect(() => {
    if (customLoaded) saveCustomCache(customItems);
  }, [customItems, customLoaded]);

  /* ---------- автопополнение: новые ролики подмешиваются в ленту сразу после следующего ---------- */
  const injectFresh = useCallback((fresh: VideoItem[]) => {
    const m = modeRef.current;
    if (m === "favorites" || m === "history" || queueRef.current.length === 0) return;
    const inQueue = new Set(queueRef.current.map((s) => s.item.id));
    const fits = fresh.filter(
      (v) => !inQueue.has(v.id) && (m === "foryou" || m === "random" || CATEGORIES.some((category) => category.id === m && v.categories.includes(category.id))),
    );
    if (m === "foryou" || m === "random") {
      fits.sort((a, b) => Number(isRussianVideo(b)) - Number(isRussianVideo(a)));
    }
    if (!fits.length) return;
    const slides: Slide[] = fits.slice(0, 10).map((item) => ({ key: `${item.id}#f`, item, cycle: 0 }));
    const at = Math.min(indexRef.current + 2, queueRef.current.length);
    const q = [...queueRef.current.slice(0, at), ...slides, ...queueRef.current.slice(at)];
    queueRef.current = q;
    setQueue(q);
  }, []);

  const loadDiscovered = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/discover");
      if (!res.ok) return;
      const data = (await res.json()) as { configured: boolean; intervalMin: number; items: VideoItem[] };
      setDiscoverInfo({ configured: data.configured, intervalMin: data.intervalMin });
      const known = new Set(poolRef.current.map((v) => v.id));
      const fresh = data.items.filter((v) => !known.has(v.id));
      if (!fresh.length) return;
      setDiscovered((prev) => {
        const next = [...prev, ...fresh].slice(-300);
        saveDiscoveredCache(next);
        return next;
      });
      if (queueRef.current.length === 0) setNonce((n) => n + 1);
      else injectFresh(fresh);
      showToast(`Новые ролики: +${fresh.length}`);
    } catch {
      /* сеть недоступна — попробуем в следующий раз */
    }
  }, [injectFresh, showToast]);

  useEffect(() => {
    const previousOwner = accountOwnerRef.current;
    const nextOwner = accountUser?.id ?? null;
    accountOwnerRef.current = nextOwner;

    // Не переносим личные данные одного аккаунта в другой и не оставляем их после выхода.
    if (!nextOwner) {
      if (previousOwner) update((s) => ({ ...s, likes: [], favs: [], history: [] }));
      return;
    }

    if (previousOwner !== nextOwner) {
      update((s) => ({ ...s, likes: [], favs: [], history: [] }));
    }
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const [likesResult, favoritesResult, historyResult] = await Promise.all([
        supabase.from("likes").select("video_id").eq("user_id", nextOwner),
        supabase.from("favorites").select("video_id").eq("user_id", nextOwner),
        supabase.from("watch_history").select("video_id,watched_at").eq("user_id", nextOwner).order("watched_at", { ascending: false }).limit(300),
      ]);
      if (cancelled) return;
      if (likesResult.error || favoritesResult.error || historyResult.error) {
        showToast("Не удалось полностью синхронизировать данные аккаунта");
        return;
      }
      update((s) => ({
        ...s,
        likes: Array.from(new Set((likesResult.data ?? []).map((x: {video_id:string}) => x.video_id))),
        favs: Array.from(new Set((favoritesResult.data ?? []).map((x: {video_id:string}) => x.video_id))),
        history: (historyResult.data ?? []).map((x: {video_id:string;watched_at:string}) => ({ id:x.video_id, ts:Date.parse(x.watched_at) || Date.now() })),
      }));
    })();
    return () => { cancelled = true; };
  }, [accountUser?.id, update, showToast]);

  useEffect(() => {
    if (mode !== "subscriptions") return;
    if (!accountUser) {
      setSubscriptionItems([]);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setSubscriptionItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: follows, error: followsError } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", accountUser.id);
      if (cancelled) return;
      if (followsError) {
        setSubscriptionItems([]);
        showToast("Не удалось загрузить подписки");
        return;
      }
      const creatorIds = (follows ?? []).map((row: { following_id: string }) => row.following_id);
      if (!creatorIds.length) {
        setSubscriptionItems([]);
        return;
      }
      const { data, error } = await supabase
        .from("user_videos")
        .select("user_id,video_id,video_url,author,author_url,title,hashtags,music,thumbnail,categories,created_at")
        .in("user_id", creatorIds)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        setSubscriptionItems([]);
        showToast("Не удалось загрузить видео подписок");
        return;
      }
      setSubscriptionItems((data ?? []).map((row: {
        user_id: string; video_id: string; video_url: string; author: string; author_url: string;
        title: string; hashtags: string[]; music: string | null; thumbnail: string | null;
        categories: string[]; created_at: string;
      }) => ({
        id: row.video_id,
        url: row.video_url,
        author: row.author,
        authorUrl: row.author_url,
        title: row.title,
        hashtags: row.hashtags ?? [],
        music: row.music,
        thumbnail: row.thumbnail,
        categories: (row.categories ?? []) as VideoItem["categories"],
        publishedAt: row.created_at,
        ownerId: row.user_id,
      })));
    })();
    return () => { cancelled = true; };
  }, [mode, accountUser?.id, accountOpen, showToast]);

  const bootstrapped = ready && catalogState !== "loading" && customLoaded;

  useEffect(() => {
    if (!bootstrapped) return;
    loadDiscovered();
    const t = setInterval(loadDiscovered, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [bootstrapped, loadDiscovered]);

  /* ---------- низкоуровневые функции плеера ---------- */
  const post = useCallback((key: string, type: string, value?: unknown) => {
    const w = frames.current.get(key)?.contentWindow;
    if (!w) return;
    const msg: Record<string, unknown> = { type, "x-tiktok-player": true };
    if (value !== undefined) msg.value = value;
    w.postMessage(msg, "*");
  }, []);

  const register = useCallback((key: string, el: HTMLIFrameElement | null) => {
    if (el) frames.current.set(key, el);
    else frames.current.delete(key);
  }, []);

  const applyTransform = useCallback((px: number, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 360ms cubic-bezier(.22,.8,.24,1)" : "none";
    el.style.transform = `translate3d(0, calc(${-indexRef.current * 100}% + ${px}px), 0)`;
  }, []);

  /** Перезагружает плеер текущего ролика (с autoplay=1) — когда плеер молчит или нужен звук. */
  const reloadCurrent = useCallback((muted: boolean) => {
    const key = currentKeyRef.current;
    if (!key) return;
    const prev = srcOpts.current.get(key) ?? { muted, loop: !storeRef.current.settings.autoNext };
    srcOpts.current.set(key, { ...prev, muted });
    readyRef.current.delete(key);
    mutedState.current.delete(key);
    confirmedRef.current = false;
    setNeedsTap(false);
    setPlayback("loading");
    setReloads((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 }));
  }, []);

  /**
   * Гарантирует звук у текущего ролика. Предзагруженный ролик «прогрет» с muted=1, и плеер часто игнорирует
   * unMute без жеста внутри iframe — ролик играл бы немым. Поэтому для КАЖДОГО ролика (а не только при
   * включении звука) проверяем подтверждение onMute=false и, если его нет, один раз перезагружаем плеер со звуком.
   */
  const ensureSound = useCallback(
    (key: string) => {
      clearTimeout(soundTimer.current);
      if (!soundRef.current) return;
      post(key, "unMute");
      soundTimer.current = setTimeout(() => {
        if (!soundRef.current || currentKeyRef.current !== key) return;
        if (mutedState.current.get(key) === false) return; // звук подтверждён
        const opts = srcOpts.current.get(key);
        if (!opts?.muted || soundFixed.current.has(key)) {
          post(key, "unMute"); // уже загружен со звуком — просто повторяем команду
          return;
        }
        soundFixed.current.add(key);
        reloadCurrent(false);
      }, 900);
    },
    [post, reloadCurrent],
  );

  /** Запускает текущий ролик и гарантированно ставит на паузу все остальные. */
  const activate = useCallback(
    (key: string) => {
      frames.current.forEach((_, k) => {
        if (k !== key) post(k, "pause");
      });
      post(key, soundRef.current ? "unMute" : "mute");
      post(key, "play");
      ensureSound(key);
      const skipFailedVideo = () => {
        const id = queueRef.current.find((s) => s.key === key)?.item.id;
        if (!id) return;
        const q = queueRef.current;
        const cur = indexRef.current;
        const kept = q.filter((slide) => slide.item.id !== id);
        const nextIndex = clampIndex(q.slice(0, cur).filter((slide) => slide.item.id !== id).length, kept.length);
        queueRef.current = kept;
        indexRef.current = nextIndex;
        setRemoved((items) => (items.includes(id) ? items : [...items, id]));
        setQueue(kept);
        setIndex(nextIndex);
        applyTransform(0, false);
        showToast("Ролик не загрузился — пропущен");
      };
      clearTimeout(fallbackRef.current);
      fallbackRef.current = setTimeout(() => {
        if (confirmedRef.current || currentKeyRef.current !== key) return;
        // Одна повторная загрузка; если плеер снова не отвечает, автоматически пропускаем ролик.
        const n = reloadCountRef.current[key] ?? 0;
        if (n >= 1) {
          skipFailedVideo();
          return;
        }
        reloadCountRef.current[key] = n + 1;
        reloadCurrent(!soundRef.current);
        fallbackRef.current = setTimeout(() => {
          if (!confirmedRef.current && currentKeyRef.current === key) skipFailedVideo();
        }, 6000);
      }, 7000);
    },
    [post, reloadCurrent, ensureSound, applyTransform, showToast],
  );

  /* ---------- сборка очереди ---------- */
  const ctx = () => ({
    likes: storeRef.current.likes,
    favs: storeRef.current.favs,
    history: storeRef.current.history,
    notInterested: storeRef.current.notInterested ?? [],
  });

  useEffect(() => {
    if (!bootstrapped) return;
    const pass = buildPass(modeRef.current, poolRef.current, ctx(), Math.random, priorityRef.current);
    priorityRef.current = [];
    const q = toSlides(pass, 0);
    queueRef.current = q;
    indexRef.current = 0;
    reloadCountRef.current = {};
    setQueue(q);
    setIndex(0);
    setPlayback("loading");
    applyTransform(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, mode, nonce, subscriptionItems]);

  /* бесконечная подгрузка: когда доходим до конца очереди, добавляем новый проход по каталогу */
  useEffect(() => {
    if (!needsMore(index, queue.length)) return;
    const pass = buildPass(modeRef.current, poolRef.current, ctx(), Math.random);
    if (!pass.length) return;
    const last = queueRef.current[queueRef.current.length - 1];
    const q = [...queueRef.current, ...nextPass(pass, last?.item.id, (last?.cycle ?? 0) + 1)];
    queueRef.current = q;
    setQueue(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, queue.length]);

  /* ---------- переключение роликов ---------- */
  const go = useCallback(
    (dir: 1 | -1) => {
      const target = indexRef.current + dir;
      if (target < 0 || target >= queueRef.current.length) {
        applyTransform(0, true);
        return;
      }
      indexRef.current = clampIndex(target, queueRef.current.length);
      setIndex(indexRef.current);
      applyTransform(0, true);
    },
    [applyTransform],
  );

  /* смена текущего ролика → автозапуск нового, остановка предыдущего, запись в историю */
  useEffect(() => {
    if (!currentKey) return;
    setNeedsTap(false);
    setPlayback("loading");
    confirmedRef.current = false;
    if (progressRef.current) progressRef.current.style.transform = "scaleX(0)";
    activate(currentKey);

    const id = queueRef.current[indexRef.current]?.item.id;
    const tHistory = setTimeout(() => {
      if (!id) return;
      update((s) => ({ ...s, history: [...s.history, { id, ts: Date.now() }].slice(-300) }));
      const supabase = getSupabase();
      if (accountUser && supabase) {
        void supabase.from("watch_history").insert({ user_id: accountUser.id, video_id: id, watched_at: new Date().toISOString() });
      }
    }, 1500);
    return () => {
      clearTimeout(tHistory);
    };
  }, [currentKey, activate, update, accountUser]);

  /* звук: включили/выключили кнопкой или после жеста — применяем к текущему ролику */
  useEffect(() => {
    const key = currentKeyRef.current;
    if (!key) return;
    if (unlocked && store.settings.sound) ensureSound(key);
    else {
      clearTimeout(soundTimer.current);
      post(key, "mute");
    }
    return () => clearTimeout(soundTimer.current);
  }, [unlocked, store.settings.sound, post, ensureSound]);

  const dropVideo = useCallback(
    (id: string, reason = "Видео недоступно — пропущено") => {
      const q = queueRef.current;
      const cur = indexRef.current;
      const kept = q.filter((s) => s.item.id !== id);
      const newIndex = clampIndex(q.slice(0, cur).filter((s) => s.item.id !== id).length, kept.length);
      queueRef.current = kept;
      indexRef.current = newIndex;
      setRemoved((r) => (r.includes(id) ? r : [...r, id]));
      setQueue(kept);
      setIndex(newIndex);
      applyTransform(0, false);
      showToast(reason);
    },
    [applyTransform, showToast],
  );

  /* ---------- сообщения от плеера TikTok ---------- */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; value?: unknown; "x-tiktok-player"?: boolean } | null;
      if (!d || typeof d !== "object" || d["x-tiktok-player"] !== true || typeof d.type !== "string") return;
      const key = Array.from(frames.current.entries()).find(([, el]) => el.contentWindow === e.source)?.[0];
      if (!key) return;
      const isCur = key === currentKeyRef.current;

      switch (d.type) {
        case "onPlayerReady":
          readyRef.current.add(key);
          if (isCur) activate(key);
          break;
        case "onMute":
          mutedState.current.set(key, !!d.value);
          break;
        case "onStateChange": {
          const v = d.value as number;
          if (!isCur) {
            if (v === 1) post(key, "pause"); // предзагруженный ролик «прогрет» и сразу остановлен: играет только один
            break;
          }
          if (v === 1) {
            confirmedRef.current = true;
            playedRef.current.add(key);
            if (soundRef.current && mutedState.current.get(key) !== false) ensureSound(key);
            clearTimeout(fallbackRef.current);
            setNeedsTap(false);
            setPlayback("playing");
          } else if (v === 2) {
            setPlayback("paused");
          } else if (v === 0 && storeRef.current.settings.autoNext) {
            go(1);
          }
          break;
        }
        case "onCurrentTime": {
          if (!isCur) break;
          const v = d.value as { currentTime?: number; duration?: number } | undefined;
          if (v?.duration && progressRef.current) {
            progressRef.current.style.transform = `scaleX(${Math.min(1, (v.currentTime ?? 0) / v.duration)})`;
          }
          break;
        }
        case "onPlayerError": {
          if (!isCur) break;
          const v = d.value as { errorCode?: number } | number | undefined;
          const code = typeof v === "number" ? v : v?.errorCode;
          if (code === 1001) {
            const id = queueRef.current.find((s) => s.key === key)?.item.id;
            if (id) dropVideo(id);
          } else if (code === 3002) {
            setNeedsTap(true);
            setPlayback("paused");
          } else {
            const id = queueRef.current.find((s) => s.key === key)?.item.id;
            if (id) dropVideo(id);
          }
          break;
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [activate, post, go, dropVideo, ensureSound]);

  /* пауза, когда вкладка скрыта */
  useEffect(() => {
    const onVis = () => {
      const key = currentKeyRef.current;
      if (!key) return;
      if (document.hidden) {
        wasPlayingRef.current = playbackRef.current === "playing";
        post(key, "pause");
      } else if (wasPlayingRef.current) {
        post(key, "play");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [post]);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  /* ---------- пауза / воспроизведение ---------- */
  const togglePlay = useCallback(() => {
    const key = currentKeyRef.current;
    if (!key) return;
    if (needsTap || playbackRef.current !== "playing") {
      post(key, soundRef.current ? "unMute" : "mute");
      post(key, "play");
      if (needsTap) {
        // плеер не принял команду (автозапуск был запрещён) — по касанию перезагружаем его с autoplay
        setTimeout(() => {
          if (!confirmedRef.current && currentKeyRef.current === key) reloadCurrent(!storeRef.current.settings.sound);
        }, 1200);
      }
      setNeedsTap(false);
    } else {
      post(key, "pause");
      setPlayback("paused");
    }
  }, [needsTap, post, reloadCurrent]);

  /** Браузеры разрешают звук только после настоящего жеста: клик мыши, тап, клавиша (но не скролл и не колесо). */
  const unlock = useCallback(() => {
    if (!unlockedRef.current) {
      unlockedRef.current = true;
      setUnlocked(true);
    }
  }, []);

  /* ---------- жесты: мышь и касания (Pointer Events) ---------- */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    gesture.current = {
      id: e.pointerId,
      y0: e.clientY,
      t0: performance.now(),
      dy: 0,
      first: !unlockedRef.current && storeRef.current.settings.sound,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === "mouse") unlock(); // нажатие мыши — настоящий жест
    applyTransform(0, false);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const raw = e.clientY - g.y0;
    g.dy = raw;
    const atTop = indexRef.current === 0 && raw > 0;
    const atEnd = indexRef.current >= queueRef.current.length - 1 && raw < 0;
    applyTransform(atTop || atEnd ? raw * 0.3 : raw, false);
  };

  const finishGesture = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    const dt = performance.now() - g.t0;
    const action = cancelled
      ? "stay"
      : decideSwipe({ dy: g.dy, dt, height: rootRef.current?.clientHeight ?? window.innerHeight });
    if (action === "next") go(1);
    else if (action === "prev") go(-1);
    else if (action === "tap") {
      unlock(); // тап — настоящий жест, звук разрешён
      // первый тап только включает звук, а не ставит ролик на паузу
      if (g.first && playbackRef.current === "playing") return;
      togglePlay();
    } else applyTransform(0, true);
  };

  /* колесо мыши и клавиатура (ПК) */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let lock = 0;
    let acc = 0;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (sheetRef.current) return;
      e.preventDefault();
      const now = Date.now();
      if (now - last > 200) acc = 0;
      last = now;
      if (now < lock) return;
      acc += e.deltaY;
      if (Math.abs(acc) > 40) {
        go(acc > 0 ? 1 : -1);
        acc = 0;
        lock = now + 550;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (sheetRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      unlock();
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "j") go(1);
      else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [go, togglePlay, unlock]);

  /* ---------- действия пользователя ---------- */
  const liked = !!current && store.likes.includes(current.id);
  const faved = !!current && store.favs.includes(current.id);

  const toggleIn = (field: "likes" | "favs") => {
    if (!current) return;
    const id = current.id;
    const wasActive = store[field].includes(id);
    update((s) => ({
      ...s,
      [field]: s[field].includes(id) ? s[field].filter((x) => x !== id) : [...s[field], id],
    }));
    const supabase = getSupabase();
    if (accountUser && supabase) {
      const table = field === "likes" ? "likes" : "favorites";
      void (async () => {
        const result = wasActive
          ? await supabase.from(table).delete().eq("user_id", accountUser.id).eq("video_id", id)
          : await supabase.from(table).upsert({ user_id: accountUser.id, video_id: id }, { onConflict: "user_id,video_id" });
        if (!result.error && !wasActive && field === "likes" && current.ownerId && current.ownerId !== accountUser.id) {
          await supabase.from("notifications").insert({
            user_id: current.ownerId,
            actor_id: accountUser.id,
            type: "like",
            video_id: id,
          });
        }
      })();
    }
  };

  const markNotInterested = () => {
    if (!current) return;
    const id = current.id;
    update((s) => ({ ...s, notInterested: Array.from(new Set([...(s.notInterested ?? []), id])) }));
    dropVideo(id, "Будем реже показывать такие ролики");
  };

  const share = async () => {
    if (!current) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${current.author} в TikTok`, url: current.url });
      } else {
        await navigator.clipboard.writeText(current.url);
        showToast("Ссылка скопирована");
      }
    } catch {
      /* пользователь закрыл меню «Поделиться» */
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      showToast("Полноэкранный режим недоступен в этом браузере");
    }
  };

  const refresh = async () => {
    await loadCatalog();
    setNonce((n) => n + 1);
    showToast("Лента обновлена");
  };

  const setMode = (m: FeedMode) => {
    update((s) => ({ ...s, category: m }));
    if (m === "subscriptions" && !accountUser) setAccountOpen(true);
  };

  const onSoundButton = () => {
    if (!unlocked && store.settings.sound) {
      unlock(); // звук включён в настройках, ждал только жеста
      return;
    }
    update((s) => ({ ...s, settings: { ...s.settings, sound: !s.settings.sound } }));
    unlock();
  };

  const addLinks = async (text: string): Promise<AddResult[]> => {
    const urls = Array.from(new Set(text.split(/[\s,]+/).map(normalizeUrl).filter(Boolean)));
    const results: AddResult[] = [];
    const added: VideoItem[] = [];
    for (const url of urls) {
      try {
        const r = await fetch(`/api/oembed?url=${encodeURIComponent(url)}`);
        const j = (await r.json()) as { ok: boolean; item?: VideoItem; reason?: string };
        if (j.ok && j.item) {
          added.push(j.item);
          results.push({ url, ok: true, label: "добавлено" });
        } else results.push({ url, ok: false, label: reasonLabel(j.reason ?? "") });
      } catch {
        results.push({ url, ok: false, label: reasonLabel("network") });
      }
    }
    if (added.length) {
      setCustomItems((c) => [...c.filter((x) => !added.some((a) => a.id === x.id)), ...added]);
      update((s) => ({
        ...s,
        custom: Array.from(new Set([...s.custom, ...added.map((a) => a.url)])),
        category: "foryou",
      }));
      setRemoved((r) => r.filter((id) => !added.some((a) => a.id === id)));
      priorityRef.current = added.map((a) => a.id);
      poolRef.current = [...poolRef.current.filter((v) => !added.some((a) => a.id === v.id)), ...added];
      setNonce((n) => n + 1);
    }
    return results;
  };

  const removeCustom = (id: string) => {
    const item = customItems.find((v) => v.id === id);
    setCustomItems((c) => c.filter((v) => v.id !== id));
    if (item) update((s) => ({ ...s, custom: s.custom.filter((u) => u !== item.url) }));
    setNonce((n) => n + 1);
  };

  /* ---------- отрисовка ---------- */
  // Один активный iframe: соседние слайды показываются только как лёгкие постеры.
  const players = new Set(playerIndexes(index, queue.length));
  const visible = visibleIndexes(index, queue.length);
  const showSpinner = !!current && playback === "loading";
  const soundOn = unlocked && store.settings.sound;

  return (
    <div ref={rootRef} data-theme={store.settings.theme ?? "dark"} className="relative h-dvh w-full select-none overflow-hidden bg-black" data-testid="feed">
      {/* лента */}
      <div ref={trackRef} className="absolute inset-0 will-change-transform" data-testid="track">
        {visible.map((i) => {
          const s = queue[i];
          const isCur = i === index;
          const mount = players.has(i);
          if (mount && !srcOpts.current.has(s.key)) {
            // текущий ролик грузится со звуком (если он разрешён жестом), предзагружаемый — «прогревается» без звука
            srcOpts.current.set(s.key, {
              muted: !isCur || !(unlockedRef.current && store.settings.sound),
              loop: !store.settings.autoNext,
            });
          } else if (!mount) {
            srcOpts.current.delete(s.key);
          }
          const opts = srcOpts.current.get(s.key) ?? { muted: true, loop: true };
          return (
            <VideoSlide
              key={s.key}
              slide={s}
              position={i}
              mountPlayer={mount}
              autoplay
              muted={opts.muted}
              loop={opts.loop}
              reloadNonce={reloads[s.key] ?? 0}
              showPoster={!(isCur && playback === "playing") && !(isCur && playback === "paused" && playedRef.current.has(s.key))}
              register={register}
            />
          );
        })}
      </div>

      {/* слой жестов поверх плеера (iframe иначе «съедает» касания) */}
      {current && (
        <div
          data-testid="gesture-layer"
          className="absolute inset-0 z-20 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => finishGesture(e, false)}
          onPointerCancel={(e) => finishGesture(e, true)}
        />
      )}

      {/* индикаторы состояния */}
      {showSpinner && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" data-testid="spinner">
          <div className="spinner" />
        </div>
      )}
      {current && (playback === "paused" || needsTap) && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" data-testid="paused">
          <div className="pop rounded-full bg-black/40 p-5 text-white/90">
            <PlayIcon className="h-14 w-14" />
          </div>
        </div>
      )}
      {current && playback === "error" && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/70 px-8 text-center">
          <p>Не удалось воспроизвести этот ролик.</p>
          <div className="flex gap-3">
            <button className="rounded-lg bg-brand-red px-4 py-2 font-semibold" onClick={() => reloadCurrent(!soundRef.current)}>
              Повторить
            </button>
            <button className="rounded-lg bg-white/15 px-4 py-2" onClick={() => go(1)}>
              Пропустить
            </button>
          </div>
        </div>
      )}
      {current && !unlocked && store.settings.sound && (
        <button
          data-testid="sound-pill"
          onClick={unlock}
          className="absolute left-1/2 top-28 z-40 -translate-x-1/2 rounded-full bg-brand-red px-4 py-2 text-sm font-semibold shadow-lg"
        >
          🔇 Нажмите, чтобы включить звук
        </button>
      )}

      {/* верхняя панель */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/70 to-transparent pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="feed-header flex items-center justify-between px-3">
          <span className="logo-glitch feed-logo text-base font-extrabold tracking-tight">TikTok Mod Web</span>
          <div className="pointer-events-auto flex items-center gap-1">
            <button aria-label="Настройки" title="Настройки" onClick={() => setSettingsOpen(true)} className="feed-icon-button rounded-full p-2 text-lg">⚙</button>
            <button aria-label="Профиль и аккаунт" onClick={() => setAccountOpen(true)} className="feed-icon-button rounded-full px-2 py-1 text-lg">
              {accountUser ? "👤" : "♙"}
            </button>
            <a href="/updates" aria-label="Журнал обновлений" title="Журнал обновлений" className="feed-icon-button rounded-full px-3 py-2 text-xs font-semibold whitespace-nowrap">
              ↻ Обновления
            </a>
            <button aria-label="Обновить ленту" onClick={refresh} className="feed-icon-button rounded-full p-2">
              <RefreshIcon />
            </button>
            <button aria-label="Звук" onClick={onSoundButton} className="feed-icon-button rounded-full p-2">
              <VolumeIcon filled={soundOn} />
            </button>
            <button aria-label="Во весь экран" onClick={toggleFullscreen} className="feed-icon-button rounded-full p-2">
              <FullscreenIcon className={isFs ? "text-brand-cyan" : ""} />
            </button>
            <button aria-label="Добавить видео" onClick={() => setSheet(true)} className="feed-icon-button rounded-full p-2">
              <PlusIcon />
            </button>
          </div>
        </div>
        <div className="no-scrollbar pointer-events-auto flex gap-2 overflow-x-auto px-3 pb-2 pt-1">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              data-testid={`chip-${c.id}`}
              onClick={() => setMode(c.id)}
              className={`feed-chip shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                mode === c.id ? "feed-chip-active" : ""
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* правая панель действий */}
      {current && (
        <div className="feed-action-rail absolute bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-2 z-30 flex flex-col items-center gap-5 sm:bottom-[max(7rem,calc(env(safe-area-inset-bottom)+6rem))]">
          <button aria-label="Лайк" data-testid="like" onClick={() => toggleIn("likes")} className="feed-action flex flex-col items-center">
            <HeartIcon filled={liked} className={`h-9 w-9 drop-shadow ${liked ? "pop text-brand-red" : ""}`} />
            <span className="text-xs">{liked ? "Нравится" : "Лайк"}</span>
          </button>
          <button aria-label="В избранное" data-testid="fav" onClick={() => toggleIn("favs")} className="feed-action flex flex-col items-center">
            <BookmarkIcon filled={faved} className={`h-9 w-9 drop-shadow ${faved ? "pop text-yellow-300" : ""}`} />
            <span className="text-xs">{faved ? "В избранном" : "Избранное"}</span>
          </button>
          <button aria-label="Комментарии" onClick={() => setCommentsOpen(true)} className="feed-action flex flex-col items-center">
            <span className="text-3xl leading-9 drop-shadow">💬</span>
            <span className="text-xs">Комментарии</span>
          </button>
          <button aria-label="Не интересно" onClick={markNotInterested} className="feed-action flex flex-col items-center">
            <span className="text-3xl leading-9 drop-shadow">👎</span>
            <span className="text-xs">Не интересно</span>
          </button>
          <button aria-label="Поделиться" onClick={share} className="feed-action flex flex-col items-center">
            <ShareIcon className="h-9 w-9 drop-shadow" />
            <span className="text-xs">Поделиться</span>
          </button>
        </div>
      )}

      {/* мобильная навигация: основные разделы доступны одной рукой */}
      <nav aria-label="Основная навигация" className="mobile-bottom-nav sm:hidden">
        <button type="button" aria-label="Для тебя" aria-current={mode === "foryou" ? "page" : undefined} onClick={() => setMode("foryou")} className={mode === "foryou" ? "is-active" : ""}>
          <span aria-hidden="true">⌂</span><small>Для тебя</small>
        </button>
        <button type="button" aria-label="Подписки" aria-current={mode === "subscriptions" ? "page" : undefined} onClick={() => setMode("subscriptions")} className={mode === "subscriptions" ? "is-active" : ""}>
          <span aria-hidden="true">♧</span><small>Подписки</small>
        </button>
        <button type="button" aria-label="Добавить видео" onClick={() => setSheet(true)}>
          <span aria-hidden="true">＋</span><small>Добавить</small>
        </button>
        <a href="/updates" aria-label="Update Log" data-testid="mobile-updates-link" className="mobile-nav-link">
          <span aria-hidden="true">↻</span><small>Обновления</small>
        </a>
        <button type="button" aria-label="Профиль" onClick={() => setAccountOpen(true)}>
          <span aria-hidden="true">♙</span><small>Профиль</small>
        </button>
        <button type="button" aria-label="Настройки" onClick={() => setSettingsOpen(true)}>
          <span aria-hidden="true">⚙</span><small>Настройки</small>
        </button>
      </nav>

      {/* информация о ролике */}
      {current && (
        <div className="feed-caption pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/35 to-transparent px-3 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] pt-16 pr-20 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <a
            href={current.authorUrl || current.url}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto font-bold"
          >
            {current.author}
          </a>
          {current.title && <p className="mt-1 line-clamp-2 text-sm text-white/90">{current.title}</p>}
          {current.music && <p className="mt-1 truncate text-xs text-white/80">♬ {current.music}</p>}
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto mt-1 inline-block text-xs text-brand-cyan underline"
          >
            Открыть в TikTok
          </a>
        </div>
      )}

      {/* тонкий индикатор прогресса */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 h-0.5 bg-white/10">
        <div ref={progressRef} className="h-full origin-left bg-brand-cyan" style={{ transform: "scaleX(0)" }} />
      </div>

      {/* пустые и ошибочные состояния */}
      {!current && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-8 pt-24 text-center">
          {!bootstrapped ? (
            <>
              <div className="spinner" />
              <p className="text-white/70">Загружаю ленту…</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold">
                {EMPTY_TEXT[mode] ??
                  (catalogState === "error" && pool.length === 0
                    ? "Не удалось связаться с TikTok."
                    : "В каталоге нет доступных видео.")}
              </p>
              {!EMPTY_TEXT[mode] && (
                <p className="max-w-sm text-sm text-white/60">
                  Добавьте ссылки на публичные видео TikTok (кнопка «+») или впишите их в файл data/videos.json.
                </p>
              )}
              <div className="flex gap-3">
                {mode === "subscriptions" ? (
                  <button className="rounded-lg bg-brand-red px-4 py-2 font-semibold" onClick={() => setAccountOpen(true)}>
                    Профиль и подписки
                  </button>
                ) : (
                  <button className="rounded-lg bg-brand-red px-4 py-2 font-semibold" onClick={() => setSheet(true)}>
                    Добавить видео
                  </button>
                )}
                <button className="rounded-lg bg-white/15 px-4 py-2" onClick={refresh}>
                  Повторить
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-44 z-50 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black">
          {toast}
        </div>
      )}

      {settingsOpen && (
        <div className="settings-backdrop fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4" onClick={() => setSettingsOpen(false)}>
          <section className="settings-panel max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/10 bg-neutral-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="mb-5 flex items-center justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">TikTok Mod Web</p><h2 className="text-2xl font-bold">Настройки</h2></div>
              <button onClick={() => setSettingsOpen(false)} className="rounded-full border border-white/15 px-3 py-2 text-sm">Закрыть</button>
            </header>
            <div className="space-y-5">
              <section><h3 className="mb-2 font-semibold">Оформление</h3><div className="grid grid-cols-2 gap-2">
                <button onClick={() => update((s) => ({ ...s, settings: { ...s.settings, theme: "dark" } }))} className={`rounded-xl border px-4 py-3 text-sm ${store.settings.theme !== "light" ? "border-cyan-300 bg-cyan-300/15" : "border-white/15 bg-white/5"}`}>🌙 Тёмная тема</button>
                <button onClick={() => update((s) => ({ ...s, settings: { ...s.settings, theme: "light" } }))} className={`rounded-xl border px-4 py-3 text-sm ${store.settings.theme === "light" ? "border-cyan-500 bg-cyan-500/15" : "border-white/15 bg-white/5"}`}>☀️ Светлая тема</button>
              </div></section>
              <section className="space-y-3 border-t border-white/10 pt-4"><h3 className="font-semibold">Воспроизведение</h3>
                <label className="flex items-center justify-between gap-3 text-sm">Качество видео <span className="rounded-lg bg-white/10 px-3 py-2 text-xs">Авто</span></label>
                <p className="text-xs opacity-60">Встроенный плеер TikTok сам выбирает качество. Ручное переключение качества для таких роликов сайт пока не поддерживает.</p>
                <label className="flex items-center justify-between gap-3 text-sm">Звук включён<input type="checkbox" checked={store.settings.sound} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, sound: e.target.checked } }))} className="h-5 w-5 accent-[#fe2c55]" /></label>
                <label className="flex items-center justify-between gap-3 text-sm">Автопереход после окончания ролика<input type="checkbox" checked={store.settings.autoNext} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, autoNext: e.target.checked } }))} className="h-5 w-5 accent-[#fe2c55]" /></label>
              </section>
              <section className="space-y-2 border-t border-white/10 pt-4"><h3 className="font-semibold">TikTok Mod Web</h3><a href="/updates" className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm hover:bg-white/10"><span>📋 Журнал обновлений</span><span>Открыть →</span></a><button onClick={() => { setSettingsOpen(false); setAccountOpen(true); }} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">👤 Аккаунт и профиль <span>Открыть →</span></button></section>
            </div>
          </section>
        </div>
      )}
      <CommentsPanel
        open={commentsOpen}
        video={current ?? null}
        user={accountUser}
        onClose={() => setCommentsOpen(false)}
        onLogin={() => { setCommentsOpen(false); setAccountOpen(true); }}
      />
      <AccountPanel
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onUserChange={setAccountUser}
      />
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        store={store}
        customItems={customItems}
        discover={discoverInfo}
        onAdd={addLinks}
        onRemoveCustom={removeCustom}
        onClearHistory={() => update((s) => ({ ...s, history: [] }))}
        onSettings={(patch) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }))}
      />
    </div>
  );
}
