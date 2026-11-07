"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

type Profile = { id: string; username: string; display_name: string | null; bio: string | null; avatar_url: string | null };
type Cosmetic = { slug: string; name: string; icon: string; slot: "frame" | "background" | "badge" | "title" };
const PRESETS = [
  { emoji: "🦊", label: "Лис", bg: "from-orange-500/40 to-amber-900/60" },
  { emoji: "🐼", label: "Панда", bg: "from-slate-500/40 to-slate-950/70" },
  { emoji: "🐸", label: "Лягушка", bg: "from-lime-500/40 to-emerald-950/70" },
  { emoji: "🐧", label: "Пингвин", bg: "from-sky-500/40 to-blue-950/70" },
  { emoji: "🐱", label: "Кот", bg: "from-violet-500/40 to-purple-950/70" },
  { emoji: "🐙", label: "Осьминог", bg: "from-fuchsia-500/40 to-pink-950/70" },
  { emoji: "🌌", label: "Космос", bg: "from-indigo-500/50 to-slate-950/80" },
  { emoji: "🌙", label: "Луна", bg: "from-blue-300/30 to-indigo-950/80" },
  { emoji: "❄️", label: "Снег", bg: "from-cyan-300/40 to-blue-950/70" },
  { emoji: "🔥", label: "Огонь", bg: "from-orange-500/40 to-red-950/70" },
  { emoji: "🌸", label: "Сакура", bg: "from-pink-300/40 to-rose-950/70" },
  { emoji: "⭐", label: "Звезда", bg: "from-amber-300/40 to-yellow-950/70" },
];
const slotLabels: Record<Cosmetic["slot"], string> = { frame: "Рамки", background: "Фоны", badge: "Значки", title: "Титулы" };

export default function AvatarCustomizer({ user, profile, onProfileChange }: { user: User; profile: Profile | null; onProfileChange: (profile: Profile) => void }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [items, setItems] = useState<Cosmetic[]>([]);
  const [equipped, setEquipped] = useState<Record<string, string>>({});
  const [selectedSlot, setSelectedSlot] = useState<Cosmetic["slot"]>("frame");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");

  const refresh = async () => {
    if (!supabase) return;
    const [inventory, worn] = await Promise.all([
      supabase.from("winter_inventory").select("item_slug").eq("user_id", user.id),
      supabase.from("winter_equipped_items").select("slot,item_slug").eq("user_id", user.id),
    ]);
    if (inventory.error) throw inventory.error;
    if (worn.error) throw worn.error;
    const slugs = (inventory.data ?? []).map((row) => row.item_slug);
    const catalog = slugs.length
      ? await supabase.from("winter_shop_items").select("slug,name,icon,slot").in("slug", slugs)
      : { data: [], error: null };
    if (catalog.error) throw catalog.error;
    setItems((catalog.data ?? []) as Cosmetic[]);
    setEquipped(Object.fromEntries((worn.data ?? []).map((row) => [row.slot, row.item_slug])));
  };

  useEffect(() => { void refresh().catch((e) => setFailure(e.message || "Не удалось загрузить коллекцию.")); }, [user.id]);

  const saveAvatar = async (value: string) => {
    if (!supabase) return;
    setBusy(true); setNotice(""); setFailure("");
    try {
      const fallback = profile ?? { id: user.id, username: String(user.user_metadata?.username || user.id.slice(0, 8)), display_name: String(user.user_metadata?.display_name || user.email?.split("@")[0] || "Пользователь"), bio: "" };
      const { data, error } = await supabase.from("profiles").upsert({
        id: user.id, username: fallback.username, display_name: fallback.display_name, bio: fallback.bio, avatar_url: value, updated_at: new Date().toISOString(),
      }, { onConflict: "id" }).select("id,username,display_name,bio,avatar_url").single();
      if (error) throw error;
      onProfileChange(data as Profile);
      setNotice("Аватар обновлён!");
    } catch (e) { setFailure(e instanceof Error ? e.message : "Не удалось сохранить аватар."); }
    finally { setBusy(false); }
  };

  const uploadAvatar = async (file?: File) => {
    if (!supabase || !file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { setFailure("Поддерживаются JPG, PNG, WEBP и GIF."); return; }
    if (file.size > 1024 * 1024) { setFailure("Размер изображения должен быть не больше 1 МБ."); return; }
    setUploading(true); setFailure(""); setNotice("");
    try {
      const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const path = user.id + "/" + crypto.randomUUID() + "." + ext;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      await saveAvatar(data.publicUrl);
    } catch (e) { setFailure(e instanceof Error ? e.message : "Не удалось загрузить изображение."); }
    finally { setUploading(false); }
  };

  const equip = async (item: Cosmetic) => {
    if (!supabase || busy) return;
    setBusy(true); setFailure(""); setNotice("");
    try {
      const { error } = await supabase.rpc("winter_equip_item", { p_slug: item.slug });
      if (error) throw error;
      await refresh();
      setNotice(item.name + " установлено!");
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setFailure(message.includes("event_not_started") ? "Украшения можно менять после официального старта Winter Fest." : "Не удалось установить предмет. Проверь доступ к событию.");
    } finally { setBusy(false); }
  };

  const unequip = async () => {
    if (!supabase || busy) return;
    setBusy(true); setFailure(""); setNotice("");
    try {
      const { error } = await supabase.rpc("winter_unequip_item", { p_slot: selectedSlot });
      if (error) throw error;
      await refresh();
      setNotice("Украшение снято.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setFailure(message.includes("event_not_started") ? "Снимать украшения можно после официального старта Winter Fest." : "Не удалось снять предмет.");
    } finally { setBusy(false); }
  };

  const currentAvatar = profile?.avatar_url ?? null;
  const preset = currentAvatar?.startsWith("preset:") ? PRESETS.find((item) => item.emoji === currentAvatar.slice(7)) : null;
  const frame = items.find((item) => item.slug === equipped.frame);
  const background = items.find((item) => item.slug === equipped.background);
  const badge = items.find((item) => item.slug === equipped.badge);
  const title = items.find((item) => item.slug === equipped.title);
  const shownItems = items.filter((item) => item.slot === selectedSlot);

  return (
    <aside className="h-fit space-y-4 rounded-2xl border border-cyan-100/15 bg-gradient-to-b from-cyan-950/35 to-white/[0.035] p-4 md:sticky md:top-2">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Оформление</p><h3 className="mt-1 text-lg font-extrabold">Мой аватар</h3></div>
      <div className={"relative mx-auto grid h-36 w-36 place-items-center rounded-full bg-gradient-to-br " + (preset?.bg || "from-slate-700 to-slate-950") + (frame ? " ring-4 ring-amber-300 ring-offset-4 ring-offset-slate-950" : " ring-2 ring-white/20")}>
        {currentAvatar && !preset ? <img src={currentAvatar} alt="Твой аватар" className="h-full w-full rounded-full object-cover" /> : <span className="text-6xl">{preset?.emoji || "👤"}</span>}
        {badge && <span className="absolute -bottom-1 -right-1 grid h-10 w-10 place-items-center rounded-full border-2 border-slate-950 bg-cyan-200 text-xl text-slate-950" title={badge.name}>{badge.icon}</span>}
      </div>
      {title && <p className="text-center text-sm font-bold text-amber-200">{title.icon} {title.name}</p>}
      {background && <p className="text-center text-xs text-cyan-100/70">{background.icon} {background.name}</p>}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Выбери основу</p>
        <div className="grid grid-cols-4 gap-2">{PRESETS.map((item) => <button key={item.emoji} title={item.label} disabled={busy} onClick={() => void saveAvatar("preset:" + item.emoji)} className={"grid aspect-square place-items-center rounded-xl border text-2xl " + (currentAvatar === "preset:" + item.emoji ? "border-cyan-300 bg-cyan-300/15" : "border-white/10 bg-black/25 hover:bg-white/10")}>{item.emoji}</button>)}</div>
        <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 px-3 py-2 text-center text-xs font-semibold hover:bg-white/5">{uploading ? "Загружаю…" : "📷 Загрузить своё фото"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading || busy} onChange={(e) => { const file = e.target.files?.[0]; void uploadAvatar(file); e.currentTarget.value = ""; }} /></label>
        <p className="text-[11px] leading-4 text-white/40">JPG, PNG, WEBP или GIF · до 1 МБ. Фото видно в публичном профиле.</p>
      </div>
      <div className="border-t border-white/10 pt-3">
        <p className="text-sm font-semibold">Украшения Winter Fest</p>
        <div className="mt-2 grid grid-cols-2 gap-1">{(["frame","background","badge","title"] as const).map((slot) => <button key={slot} onClick={() => setSelectedSlot(slot)} className={"rounded-lg px-2 py-2 text-xs " + (selectedSlot === slot ? "bg-cyan-300 text-slate-950 font-bold" : "bg-white/5 text-white/70")}>{slotLabels[slot]}</button>)}</div>
        <div className="mt-2 space-y-2">
          {shownItems.length ? shownItems.map((item) => <div key={item.slug} className="flex items-center justify-between gap-2 rounded-lg bg-black/25 p-2"><span className="min-w-0 text-xs"><span className="mr-1 text-base">{item.icon}</span>{item.name}</span><button disabled={busy || equipped[selectedSlot] === item.slug} onClick={() => void equip(item)} className="shrink-0 rounded-md bg-white/10 px-2 py-1 text-[11px] disabled:opacity-40">{equipped[selectedSlot] === item.slug ? "Надето" : "Надеть"}</button></div>) : <p className="rounded-lg bg-black/20 p-2 text-xs text-white/45">В этой категории пока нет купленных предметов.</p>}
        </div>
        {equipped[selectedSlot] && <button disabled={busy} onClick={() => void unequip()} className="mt-2 w-full rounded-lg border border-white/10 py-2 text-xs text-white/60 disabled:opacity-40">Снять украшение</button>}
      </div>
      {notice && <p className="rounded-lg bg-emerald-400/10 p-2 text-xs text-emerald-200">{notice}</p>}
      {failure && <p className="rounded-lg bg-red-400/10 p-2 text-xs text-red-200">{failure}</p>}
    </aside>
  );
}
