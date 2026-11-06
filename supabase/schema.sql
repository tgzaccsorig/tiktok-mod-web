-- TikTok Mod Web: run this file in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text,
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table if not exists public.watch_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id text not null,
  watched_at timestamptz not null default now()
);

create index if not exists watch_history_user_watched_idx on public.watch_history(user_id, watched_at desc);
create index if not exists follows_following_idx on public.follows(following_id);
create index if not exists profiles_username_idx on public.profiles using gin (username gin_trgm_ops);

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.likes enable row level security;
alter table public.favorites enable row level security;
alter table public.watch_history enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable" on public.profiles for select using (true);
drop policy if exists "Users create own profile" on public.profiles;
drop policy if exists "Users create own profile" on public.profiles;
create policy "Users create own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "Users update own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Follow relationships are publicly readable" on public.follows;
create policy "Follow relationships are publicly readable" on public.follows for select using (true);
drop policy if exists "Users follow as themselves" on public.follows;
drop policy if exists "Users follow as themselves" on public.follows;
create policy "Users follow as themselves" on public.follows for insert to authenticated with check ((select auth.uid()) = follower_id);
drop policy if exists "Users unfollow as themselves" on public.follows;
drop policy if exists "Users unfollow as themselves" on public.follows;
create policy "Users unfollow as themselves" on public.follows for delete to authenticated using ((select auth.uid()) = follower_id);

drop policy if exists "Likes are publicly readable" on public.likes;
create policy "Likes are publicly readable" on public.likes for select using (true);
drop policy if exists "Users manage own likes" on public.likes;
drop policy if exists "Users create own likes" on public.likes;
create policy "Users create own likes" on public.likes for insert to authenticated with check ((select auth.uid()) = user_id);\ndrop policy if exists "Users delete own likes" on public.likes;
create policy "Users delete own likes" on public.likes for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Favorites are private to owner" on public.favorites;
create policy "Favorites are private to owner" on public.favorites for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users manage own favorites" on public.favorites;
drop policy if exists "Users create own favorites" on public.favorites;
create policy "Users create own favorites" on public.favorites for insert to authenticated with check ((select auth.uid()) = user_id);\ndrop policy if exists "Users delete own favorites" on public.favorites;
create policy "Users delete own favorites" on public.favorites for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "History is private to owner" on public.watch_history;
create policy "History is private to owner" on public.watch_history for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users insert own history" on public.watch_history;
drop policy if exists "Users insert own history" on public.watch_history;
create policy "Users insert own history" on public.watch_history for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own history" on public.watch_history;
drop policy if exists "Users delete own history" on public.watch_history;
create policy "Users delete own history" on public.watch_history for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  wanted_username text;
begin
  wanted_username := lower(coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)));
  insert into public.profiles (id, username, display_name)
  values (new.id, wanted_username, coalesce(new.raw_user_meta_data->>'display_name', wanted_username))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();


-- Video comments (TikTok Mod Web 2.0)
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists comments_video_created_idx on public.comments(video_id, created_at desc);
alter table public.comments enable row level security;
drop policy if exists "Comments are publicly readable" on public.comments;
create policy "Comments are publicly readable" on public.comments for select using (true);
drop policy if exists "Users create own comments" on public.comments;
drop policy if exists "Users create own comments" on public.comments;
create policy "Users create own comments" on public.comments for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own comments" on public.comments;
drop policy if exists "Users delete own comments" on public.comments;
create policy "Users delete own comments" on public.comments for delete to authenticated using ((select auth.uid()) = user_id);\ncreate index if not exists comments_user_created_idx on public.comments(user_id, created_at desc);


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
