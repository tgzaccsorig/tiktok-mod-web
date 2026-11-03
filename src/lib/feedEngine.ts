import type { Slide, VideoItem } from "./types";

export type SwipeAction = "next" | "prev" | "tap" | "stay";

/**
 * Решает, что означает жест. dy < 0 — палец/мышь ушли ВВЕРХ (следующий ролик).
 * dt — длительность жеста в мс, height — высота экрана в px.
 */
export function decideSwipe(p: { dy: number; dt: number; height: number }): SwipeAction {
  const { dy, dt, height } = p;
  const dist = Math.abs(dy);
  if (dist < 10 && dt < 350) return "tap";
  const threshold = Math.min(80, height * 0.15);
  const velocity = dist / Math.max(dt, 1);
  if (dist >= threshold || (dist >= 24 && velocity > 0.45)) return dy < 0 ? "next" : "prev";
  return "stay";
}

export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return Math.min(Math.max(i, 0), len - 1);
}

/** Индексы слайдов, у которых смонтирован настоящий плеер: текущий + следующий (предзагрузка). */
export function playerIndexes(index: number, len: number): number[] {
  return [index, index + 1].filter((i) => i >= 0 && i < len);
}

/** Индексы слайдов, у которых рисуется только постер (дешёвый DOM). */
export function visibleIndexes(index: number, len: number): number[] {
  const out: number[] = [];
  for (let i = index - 1; i <= index + 2; i++) if (i >= 0 && i < len) out.push(i);
  return out;
}

export function toSlides(items: VideoItem[], cycle: number): Slide[] {
  return items.map((item) => ({ key: `${item.id}#${cycle}`, item, cycle }));
}

/**
 * Следующий «проход» по каталогу для бесконечной ленты.
 * Не ставит подряд тот же ролик, что закончил предыдущий проход (если в каталоге больше одного видео).
 */
export function nextPass(pass: VideoItem[], lastId: string | undefined, cycle: number): Slide[] {
  const items = pass.slice();
  if (items.length > 1 && items[0].id === lastId) {
    [items[0], items[1]] = [items[1], items[0]];
  }
  return toSlides(items, cycle);
}

/** Нужно ли подгружать продолжение ленты. */
export function needsMore(index: number, len: number): boolean {
  return len > 0 && index >= len - 2;
}
