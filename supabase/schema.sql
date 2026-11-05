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
create policy "Users create own profile" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Follow relationships are publicly readable" on public.follows;
create policy "Follow relationships are publicly readable" on public.follows for select using (true);
drop policy if exists "Users follow as themselves" on public.follows;
create policy "Users follow as themselves" on public.follows for insert with check (auth.uid() = follower_id);
drop policy if exists "Users unfollow as themselves" on public.follows;
create policy "Users unfollow as themselves" on public.follows for delete using (auth.uid() = follower_id);

drop policy if exists "Likes are publicly readable" on public.likes;
create policy "Likes are publicly readable" on public.likes for select using (true);
drop policy if exists "Users manage own likes" on public.likes;
create policy "Users manage own likes" on public.likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Favorites are private to owner" on public.favorites;
create policy "Favorites are private to owner" on public.favorites for select using (auth.uid() = user_id);
drop policy if exists "Users manage own favorites" on public.favorites;
create policy "Users manage own favorites" on public.favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "History is private to owner" on public.watch_history;
create policy "History is private to owner" on public.watch_history for select using (auth.uid() = user_id);
drop policy if exists "Users insert own history" on public.watch_history;
create policy "Users insert own history" on public.watch_history for insert with check (auth.uid() = user_id);
drop policy if exists "Users delete own history" on public.watch_history;
create policy "Users delete own history" on public.watch_history for delete using (auth.uid() = user_id);

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
