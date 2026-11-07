"use client";

import { useState } from "react";
import type { Store, VideoItem } from "@/lib/types";
import { CloseIcon } from "./Icons";

export type AddResult = { url: string; ok: boolean; label: string };

type Props = {
  open: boolean;
  onClose: () => void;
  store: Store;
  customItems: VideoItem[];
  discover: { configured: boolean; intervalMin: number } | null;
  onAdd: (text: string) => Promise<AddResult[]>;
  onRemoveCustom: (id: string) => void;
  onClearHistory: () => void;
  onSettings: (patch: Partial<Store["settings"]>) => void;
};

const REASONS: Record<string, string> = {
  not_allowed: "это не ссылка TikTok",
  unavailable: "видео недоступно или приватное",
  not_video: "это не ссылка на видео",
  network: "нет ответа от TikTok, попробуйте позже",
};

export function reasonLabel(reason: string) {
  return REASONS[reason] ?? "ошибка";
}

export default function Sheet(p: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AddResult[]>([]);

  if (!p.open) return null;

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await p.onAdd(text);
    setResults(r);
    setBusy(false);
    if (r.length && r.every((x) => x.ok)) {
      setText("");
      p.onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={p.onClose}>
      <div
        className="video-sheet max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl bg-neutral-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="sheet"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Добавить видео <span className="text-brand-cyan">TikTok</span>
          </h2>
          <button aria-label="Закрыть" onClick={p.onClose} className="rounded-full p-2 hover:bg-white/10">
            <CloseIcon />
          </button>
        </div>

        <p className="mb-2 text-sm text-neutral-400">
          Вставьте ссылки на публичные видео (по одной в строке), например
          <br />
          <span className="text-neutral-300">https://www.tiktok.com/@автор/video/1234567890</span>
          <br />
          Каждая ссылка проверяется через официальный oEmbed TikTok.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="https://www.tiktok.com/@..."
          className="w-full resize-none rounded-lg border border-white/10 bg-black p-3 text-sm outline-none focus:border-brand-cyan"
        />
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="mt-2 w-full rounded-lg bg-brand-red py-3 font-semibold disabled:opacity-40"
        >
          {busy ? "Проверяю…" : "Добавить в ленту"}
        </button>

        {results.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {results.map((r) => (
              <li key={r.url} className={r.ok ? "text-brand-cyan" : "text-brand-red"}>
                {r.ok ? "✓" : "✕"} <span className="break-all">{r.url}</span> — {r.label}
              </li>
            ))}
          </ul>
        )}

        {p.customItems.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-neutral-300">Мои добавленные видео</h3>
            <ul className="space-y-2">
              {p.customItems.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 p-2 text-sm">
                  <span className="truncate">
                    {v.author} · {v.title || v.id}
                  </span>
                  <button onClick={() => p.onRemoveCustom(v.id)} className="shrink-0 text-brand-red">
                    Удалить
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 rounded-lg bg-white/5 p-3 text-sm" data-testid="discover-status">
          <h3 className="mb-1 font-semibold text-neutral-300">Автопополнение ленты</h3>
          {p.discover?.configured ? (
            <p className="text-brand-cyan">✓ Включено: новая порция роликов подбирается каждые {p.discover.intervalMin} мин.</p>
          ) : (
            <p className="text-neutral-400">
              Выключено. Чтобы включить, добавьте ключ поискового API в настройки Vercel (см. README).
            </p>
          )}
        </div>

        <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <h3 className="text-sm font-semibold text-neutral-300">Настройки воспроизведения</h3>
          <label className="flex items-center justify-between text-sm">
            Звук включён
            <input
              type="checkbox"
              checked={p.store.settings.sound}
              onChange={(e) => p.onSettings({ sound: e.target.checked })}
              className="h-5 w-5 accent-[#fe2c55]"
            />
          </label>
          <label className="flex items-center justify-between text-sm">
            Автопереход после окончания ролика
            <input
              type="checkbox"
              checked={p.store.settings.autoNext}
              onChange={(e) => p.onSettings({ autoNext: e.target.checked })}
              className="h-5 w-5 accent-[#fe2c55]"
            />
          </label>
          <button onClick={p.onClearHistory} className="text-sm text-neutral-400 underline">
            Очистить историю просмотров ({p.store.history.length})
          </button>
        </div>
      </div>
    </div>
  );
}
