-- Notifications for follows, likes, and comments on user-published videos.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('follow','like','comment')),
  video_id text,
  comment_id uuid references public.comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (
    (type = 'follow' and video_id is null and comment_id is null)
    or (type = 'like' and video_id is not null and comment_id is null)
    or (type = 'comment' and video_id is not null and comment_id is not null)
  ),
  check (user_id <> actor_id)
);
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, created_at desc) where read_at is null;
alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users mark own notifications read" on public.notifications;
create policy "Users mark own notifications read"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users create valid social notifications" on public.notifications;
create policy "Users create valid social notifications"
  on public.notifications for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and user_id <> (select auth.uid())
    and (
      (
        type = 'follow'
        and exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = notifications.user_id
        )
      )
      or (
        type = 'like'
        and exists (
          select 1 from public.user_videos v
          where v.user_id = notifications.user_id
            and v.video_id = notifications.video_id
        )
        and exists (
          select 1 from public.likes l
          where l.user_id = (select auth.uid())
            and l.video_id = notifications.video_id
        )
      )
      or (
        type = 'comment'
        and exists (
          select 1 from public.user_videos v
          where v.user_id = notifications.user_id
            and v.video_id = notifications.video_id
        )
        and exists (
          select 1 from public.comments c
          where c.id = notifications.comment_id
            and c.user_id = (select auth.uid())
            and c.video_id = notifications.video_id
        )
      )
    )
  );
