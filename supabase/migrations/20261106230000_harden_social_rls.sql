-- Tighten policies and avoid repeated auth.uid() evaluation per row.
drop policy if exists "Users create own profile" on public.profiles;
create policy "Users create own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Users follow as themselves" on public.follows;
create policy "Users follow as themselves" on public.follows for insert to authenticated with check ((select auth.uid()) = follower_id);
drop policy if exists "Users unfollow as themselves" on public.follows;
create policy "Users unfollow as themselves" on public.follows for delete to authenticated using ((select auth.uid()) = follower_id);

drop policy if exists "Users manage own likes" on public.likes;
drop policy if exists "Users create own likes" on public.likes;
create policy "Users create own likes" on public.likes for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own likes" on public.likes;
create policy "Users delete own likes" on public.likes for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users manage own favorites" on public.favorites;
drop policy if exists "Users create own favorites" on public.favorites;
create policy "Users create own favorites" on public.favorites for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own favorites" on public.favorites;
create policy "Users delete own favorites" on public.favorites for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own history" on public.watch_history;
create policy "Users insert own history" on public.watch_history for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own history" on public.watch_history;
create policy "Users delete own history" on public.watch_history for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users create own comments" on public.comments;
create policy "Users create own comments" on public.comments for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own comments" on public.comments;
create policy "Users delete own comments" on public.comments for delete to authenticated using ((select auth.uid()) = user_id);
create index if not exists comments_user_created_idx on public.comments(user_id, created_at desc);

-- Keep private reads scoped to authenticated owners and avoid per-row auth calls.
drop policy if exists "Favorites are private to owner" on public.favorites;
create policy "Favorites are private to owner" on public.favorites for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "History is private to owner" on public.watch_history;
create policy "History is private to owner" on public.watch_history for select to authenticated using ((select auth.uid()) = user_id);


-- User publications: validated public TikTok links attached to a profile.
create table if not exists public.user_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id text not null,
  video_url text not null,
  author text not null,
  author_url text not null default '',
  title text not null default '',
  hashtags text[] not null default '{}',
  music text,
  thumbnail text,
  categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(user_id, video_id)
);
create index if not exists user_videos_user_created_idx on public.user_videos(user_id, created_at desc);
alter table public.user_videos enable row level security;
drop policy if exists "Published videos are publicly readable" on public.user_videos;
create policy "Published videos are publicly readable" on public.user_videos for select to anon, authenticated using (true);
drop policy if exists "Users publish their own videos" on public.user_videos;
create policy "Users publish their own videos" on public.user_videos for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete their own videos" on public.user_videos;
create policy "Users delete their own videos" on public.user_videos for delete to authenticated using ((select auth.uid()) = user_id);
