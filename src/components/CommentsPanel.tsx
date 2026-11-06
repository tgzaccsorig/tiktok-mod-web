"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, type AccountIdentity } from "@/lib/supabase";
import type { VideoItem } from "@/lib/types";

type CommentRow = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles: { username: string; display_name: string | null } | null;
};

export default function CommentsPanel({
  open,
  video,
  user,
  onClose,
  onLogin,
}: {
  open: boolean;
  video: VideoItem | null;
  user: AccountIdentity | null;
  onClose: () => void;
  onLogin: () => void;
}) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!video) return;
    const supabase = getSupabase();
    if (!supabase) {
      setError("Комментарии временно недоступны: не настроено подключение.");
      return;
    }
    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase
      .from("comments")
      .select("id,user_id,content,created_at,profiles(username,display_name)")
      .eq("video_id", video.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (queryError) setError("Не удалось загрузить комментарии.");
    else setComments((data ?? []) as unknown as CommentRow[]);
    setLoading(false);
  }, [video?.id]);

  useEffect(() => {
    if (open) void load();
    else {
      setComments([]);
      setText("");
      setError("");
    }
  }, [open, load]);

  const send = async () => {
    const content = text.trim();
    if (!video || !user || !content || sending) return;
    const supabase = getSupabase();
    if (!supabase) {
      setError("Подключение к аккаунту недоступно.");
      return;
    }
    setSending(true);
    setError("");
    const { data: inserted, error: insertError } = await supabase
      .from("comments")
      .insert({ video_id: video.id, user_id: user.id, content })
      .select("id")
      .single();
    setSending(false);
    if (insertError) {
      setError("Не удалось отправить комментарий. Проверь вход в аккаунт.");
      return;
    }
    if (video.ownerId && video.ownerId !== user.id && inserted?.id) {
      // Уведомление не должно мешать отправке самого комментария.
      await supabase.from("notifications").insert({
        user_id: video.ownerId,
        actor_id: user.id,
        type: "comment",
        video_id: video.id,
        comment_id: inserted.id,
      });
    }
    setText("");
    await load();
  };

  const remove = async (id: string) => {
    const supabase = getSupabase();
    if (!supabase || !user) return;
    const { error: deleteError } = await supabase.from("comments").delete().eq("id", id).eq("user_id", user.id);
    if (deleteError) setError("Не удалось удалить комментарий.");
    else setComments((items) => items.filter((item) => item.id !== id));
  };

  if (!open || !video) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center" onPointerDown={(e) => e.stopPropagation()}>
      <section role="dialog" aria-modal="true" aria-label="Комментарии" className="flex max-h-[82dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#11131b] shadow-2xl sm:rounded-3xl">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <div>
            <h2 className="font-bold text-white">Комментарии</h2>
            <p className="text-xs text-white/45">{video.author} · {comments.length}</p>
          </div>
          <button onClick={onClose} aria-label="Закрыть комментарии" className="rounded-full bg-white/10 px-3 py-2 text-white">✕</button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
          {loading && <p className="py-6 text-center text-sm text-white/55">Загружаю комментарии…</p>}
          {!loading && comments.length === 0 && <p className="py-8 text-center text-sm text-white/45">Пока нет комментариев. Будь первым!</p>}
          {comments.map((comment) => (
            <article key={comment.id} className="rounded-xl bg-white/[0.05] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-cyan-200">{comment.profiles?.display_name || comment.profiles?.username || "Пользователь"}</p>
                {user?.id === comment.user_id && <button onClick={() => void remove(comment.id)} className="text-xs text-white/40 hover:text-red-300">Удалить</button>}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/90">{comment.content}</p>
              <time className="mt-2 block text-[10px] text-white/35">{new Date(comment.created_at).toLocaleString("ru-RU")}</time>
            </article>
          ))}
        </div>

        <div className="border-t border-white/10 p-3">
          {error && <p role="alert" className="mb-2 text-xs text-red-300">{error}</p>}
          {user ? (
            <div className="flex items-end gap-2">
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))} maxLength={1000} rows={2} placeholder="Написать комментарий…" className="min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/60" />
              <button disabled={!text.trim() || sending} onClick={() => void send()} className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-black disabled:opacity-40">{sending ? "…" : "Отправить"}</button>
            </div>
          ) : (
            <button onClick={onLogin} className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-black">Войдите, чтобы комментировать</button>
          )}
          <p className="mt-2 text-[10px] text-white/35">До 1000 символов. Комментарии видны всем посетителям.</p>
        </div>
      </section>
    </div>
  );
}
