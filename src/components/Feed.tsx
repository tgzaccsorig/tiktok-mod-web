"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCatalogCache, saveCatalogCache, useStore } from "@/hooks/useStore";
import { clampIndex, decideSwipe, needsMore, nextPass, playerIndexes, toSlides, visibleIndexes } from "@/lib/feedEngine";
import { buildPass } from "@/lib/recommend";
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

type Playback = "loading" | "playing" | "paused" | "error";

const CHIPS: { id: FeedMode; label: string }[] = [
  { id: "foryou", label: "Для тебя" },
  { id: "random", label: "Случайные" },
  ...CATEGORIES.map((c) => ({ id: c.id as FeedMode, label: c.label })),
  { id: "favorites", label: "Избранное" },
  { id: "history", label: "История" },
];

const EMPTY_TEXT: Partial<Record<FeedMode, string>> = {
  favorites: "В избранном пока пусто. Нажмите на закладку у любого ролика.",
  history: "История пуста — посмотрите несколько роликов.",
};

export default function Feed() {
  const [store, update, ready] = useStore();
  const [catalog, setCatalog] = useState<VideoItem[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [customItems, setCustomItems] = useState<VideoItem[]>([]);
  const [customLoaded, setCustomLoaded] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);

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
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasPlayingRef = useRef(false);
  const priorityRef = useRef<string[]>([]);
  const reloadCountRef = useRef<Record<string, number>>({});
  // Параметры iframe фиксируются при первом показе слайда: смена src перезагрузила бы плеер.
  const autoplayKeys = useRef(new Set<string>());
  const srcOpts = useRef(new Map<string, { muted: boolean; loop: boolean }>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gesture = useRef<{ id: number; y0: number; t0: number; dy: number; lockedAtDown: boolean } | null>(null);

  storeRef.current = store;
  modeRef.current = mode;
  currentKeyRef.current = currentKey;
  playbackRef.current = playback;
  sheetRef.current = sheet;
  unlockedRef.current = unlocked;
  soundRef.current = unlocked && store.settings.sound;

  const pool = useMemo(() => {
    const map = new Map<string, VideoItem>();
    [...catalog, ...customItems].forEach((v) => {
      if (!map.has(v.id) && !removed.includes(v.id)) map.set(v.id, v);
    });
    return Array.from(map.values());
  }, [catalog, customItems, removed]);
  poolRef.current = pool;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  /* ---------- загрузка каталога (официальный oEmbed через /api/feed) ---------- */
  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/feed");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items: VideoItem[] };
      setCatalog(data.items);
      saveCatalogCache(data.items);
      setCatalogState("ready");
    } catch {
      const cached = loadCatalogCache<VideoItem[]>();
      if (cached && cached.length) {
        setCatalog(cached);
        setCatalogState("ready");
      } else {
        setCatalogState("error");
      }
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  /* ---------- ролики, добавленные пользователем ---------- */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const urls = storeRef.current.custom;
      const out: VideoItem[] = [];
      for (const url of urls) {
        try {
          const r = await fetch(`/api/oembed?url=${encodeURIComponent(url)}`);
          const j = (await r.json()) as { ok: boolean; item?: VideoItem };
          if (j.ok && j.item) out.push(j.item);
        } catch {
          /* пропускаем */
        }
      }
      if (!cancelled) {
        setCustomItems(out);
        setCustomLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const bootstrapped = ready && catalogState !== "loading" && customLoaded;

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

  /** Запускает текущий ролик и гарантированно ставит на паузу все остальные. */
  const activate = useCallback(
    (key: string) => {
      frames.current.forEach((_, k) => {
        if (k !== key) post(k, "pause");
      });
      post(key, soundRef.current ? "unMute" : "mute");
      post(key, "play");
      clearTimeout(fallbackRef.current);
      // Если плеер ещё не собран TikTok'ом и команда проигнорирована — перезагружаем его сразу с autoplay=1.
      fallbackRef.current = setTimeout(() => {
        if (confirmedRef.current || currentKeyRef.current !== key) return;
        const n = reloadCountRef.current[key] ?? 0;
        if (n >= 2) return;
        reloadCountRef.current[key] = n + 1;
        autoplayKeys.current.add(key);
        setReloads((r) => ({ ...r, [key]: n + 1 }));
      }, 1600);
    },
    [post],
  );

  /* ---------- сборка очереди ---------- */
  const ctx = () => ({
    likes: storeRef.current.likes,
    favs: storeRef.current.favs,
    history: storeRef.current.history,
  });

  useEffect(() => {
    if (!bootstrapped) return;
    const pass = buildPass(modeRef.current, poolRef.current, ctx(), Math.random, priorityRef.current);
    priorityRef.current = [];
    const q = toSlides(pass, 0);
    queueRef.current = q;
    indexRef.current = 0;
    reloadCountRef.current = {};
    if (q[0]) autoplayKeys.current.add(q[0].key);
    setQueue(q);
    setIndex(0);
    setPlayback("loading");
    applyTransform(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, mode, nonce]);

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
    const t = setTimeout(() => {
      if (!id) return;
      update((s) => ({ ...s, history: [...s.history, { id, ts: Date.now() }].slice(-300) }));
    }, 1500);
    return () => clearTimeout(t);
  }, [currentKey, activate, update]);

  /* первый жест пользователя разрешает звук */
  useEffect(() => {
    if (currentKeyRef.current) post(currentKeyRef.current, unlocked && store.settings.sound ? "unMute" : "mute");
  }, [unlocked, store.settings.sound, post]);

  const dropVideo = useCallback(
    (id: string) => {
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
      showToast("Видео недоступно — пропущено");
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
          if (isCur) activate(key);
          break;
        case "onStateChange": {
          const v = d.value as number;
          if (!isCur) {
            if (v === 1) post(key, "pause"); // защита: одновременно играет только один ролик
            break;
          }
          if (v === 1) {
            confirmedRef.current = true;
            playedRef.current.add(key);
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
            setPlayback("error");
          }
          break;
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [activate, post, go, dropVideo]);

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
      setNeedsTap(false);
    } else {
      post(key, "pause");
      setPlayback("paused");
    }
  }, [needsTap, post]);

  const unlock = useCallback(() => {
    if (!unlockedRef.current) {
      unlockedRef.current = true;
      setUnlocked(true);
    }
  }, []);

  /* ---------- жесты: мышь и касания (Pointer Events) ---------- */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    gesture.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0, lockedAtDown: !unlockedRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
    unlock();
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
      // первый тап включает звук, а не ставит на паузу
      if (!g.lockedAtDown || playbackRef.current !== "playing") togglePlay();
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
      unlock();
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
    update((s) => ({
      ...s,
      [field]: s[field].includes(id) ? s[field].filter((x) => x !== id) : [...s[field], id],
    }));
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

  const setMode = (m: FeedMode) => update((s) => ({ ...s, category: m }));

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
  const players = new Set(playerIndexes(index, queue.length));
  const visible = visibleIndexes(index, queue.length);
  const showSpinner = !!current && playback === "loading";
  const soundOn = unlocked && store.settings.sound;

  return (
    <div ref={rootRef} className="relative h-dvh w-full select-none overflow-hidden bg-black" data-testid="feed">
      {/* лента */}
      <div ref={trackRef} className="absolute inset-0 will-change-transform" data-testid="track">
        {visible.map((i) => {
          const s = queue[i];
          const isCur = i === index;
          if (!srcOpts.current.has(s.key)) {
            srcOpts.current.set(s.key, {
              muted: !(unlockedRef.current && store.settings.sound),
              loop: !store.settings.autoNext,
            });
          }
          const opts = srcOpts.current.get(s.key)!;
          return (
            <VideoSlide
              key={s.key}
              slide={s}
              position={i}
              mountPlayer={players.has(i)}
              autoplay={autoplayKeys.current.has(s.key)}
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
            <button
              className="rounded-lg bg-brand-red px-4 py-2 font-semibold"
              onClick={() => currentKey && setReloads((r) => ({ ...r, [currentKey]: (r[currentKey] ?? 0) + 1 }))}
            >
              Повторить
            </button>
            <button className="rounded-lg bg-white/15 px-4 py-2" onClick={() => go(1)}>
              Пропустить
            </button>
          </div>
        </div>
      )}
      {current && playback === "playing" && !unlocked && store.settings.sound && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-sm">
          Коснитесь экрана, чтобы включить звук
        </div>
      )}

      {/* верхняя панель */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/70 to-transparent pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between px-3">
          <span className="logo-glitch text-base font-extrabold tracking-tight">TikTok Mod Web</span>
          <div className="pointer-events-auto flex items-center gap-1">
            <button aria-label="Обновить ленту" onClick={refresh} className="rounded-full p-2 hover:bg-white/10">
              <RefreshIcon />
            </button>
            <button
              aria-label="Звук"
              onClick={() => {
                unlock();
                update((s) => ({ ...s, settings: { ...s.settings, sound: !s.settings.sound } }));
              }}
              className="rounded-full p-2 hover:bg-white/10"
            >
              <VolumeIcon filled={soundOn} />
            </button>
            <button aria-label="Во весь экран" onClick={toggleFullscreen} className="rounded-full p-2 hover:bg-white/10">
              <FullscreenIcon className={isFs ? "text-brand-cyan" : ""} />
            </button>
            <button aria-label="Добавить видео" onClick={() => setSheet(true)} className="rounded-full p-2 hover:bg-white/10">
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
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                mode === c.id ? "bg-white text-black" : "bg-white/15 text-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* правая панель действий */}
      {current && (
        <div className="absolute bottom-[max(7rem,calc(env(safe-area-inset-bottom)+6rem))] right-2 z-30 flex flex-col items-center gap-5">
          <button aria-label="Лайк" data-testid="like" onClick={() => toggleIn("likes")} className="flex flex-col items-center">
            <HeartIcon filled={liked} className={`h-9 w-9 drop-shadow ${liked ? "pop text-brand-red" : ""}`} />
            <span className="text-xs">{liked ? "Нравится" : "Лайк"}</span>
          </button>
          <button aria-label="В избранное" data-testid="fav" onClick={() => toggleIn("favs")} className="flex flex-col items-center">
            <BookmarkIcon filled={faved} className={`h-9 w-9 drop-shadow ${faved ? "pop text-yellow-300" : ""}`} />
            <span className="text-xs">{faved ? "В избранном" : "Избранное"}</span>
          </button>
          <button aria-label="Поделиться" onClick={share} className="flex flex-col items-center">
            <ShareIcon className="h-9 w-9 drop-shadow" />
            <span className="text-xs">Поделиться</span>
          </button>
        </div>
      )}

      {/* информация о ролике */}
      {current && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-16 pr-20">
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
                <button className="rounded-lg bg-brand-red px-4 py-2 font-semibold" onClick={() => setSheet(true)}>
                  Добавить видео
                </button>
                <button className="rounded-lg bg-white/15 px-4 py-2" onClick={refresh}>
                  Повторить
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-28 z-50 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black">
          {toast}
        </div>
      )}

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        store={store}
        customItems={customItems}
        onAdd={addLinks}
        onRemoveCustom={removeCustom}
        onClearHistory={() => update((s) => ({ ...s, history: [] }))}
        onSettings={(patch) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }))}
      />
    </div>
  );
}
