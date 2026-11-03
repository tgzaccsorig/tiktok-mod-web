"use client";

import { useCallback, useEffect, useState } from "react";
import type { Store } from "@/lib/types";

const KEY = "tmw:v1";

export const DEFAULT_STORE: Store = {
  likes: [],
  favs: [],
  history: [],
  custom: [],
  category: "foryou",
  settings: { sound: true, autoNext: false },
};

/** Локальное хранилище (localStorage): избранное, лайки, история, настройки, последняя категория. */
export function useStore() {
  const [store, setStore] = useState<Store>(DEFAULT_STORE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Store>;
        setStore({
          ...DEFAULT_STORE,
          ...parsed,
          settings: { ...DEFAULT_STORE.settings, ...(parsed.settings ?? {}) },
        });
      }
    } catch {
      /* повреждённые данные — начинаем с чистого листа */
    }
    setReady(true);
  }, []);

  const update = useCallback((fn: (s: Store) => Store) => {
    setStore((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* приватный режим / переполнение */
      }
      return next;
    });
  }, []);

  return [store, update, ready] as const;
}

/** Кэш в localStorage: каталог и добавленные пользователем ролики открываются мгновенно, без ожидания сети. */
function saveCache(key: string, items: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function loadCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const saveCatalogCache = (items: unknown) => saveCache("tmw:catalog", items);
export const loadCatalogCache = <T,>() => loadCache<T>("tmw:catalog");
export const saveDiscoveredCache = (items: unknown) => saveCache("tmw:discovered", items);
export const loadDiscoveredCache = <T,>() => loadCache<T>("tmw:discovered");
export const saveCustomCache =(items: unknown) => saveCache("tmw:custom-items", items);
export const loadCustomCache = <T,>() => loadCache<T>("tmw:custom-items");
