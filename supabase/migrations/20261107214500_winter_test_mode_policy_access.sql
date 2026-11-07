
grant usage on schema private to authenticated;
grant execute on function private.winter_event_today() to authenticated;

drop policy if exists "Winter users enter open competitions" on public.winter_competition_entries;
create policy "Winter users enter open competitions" on public.winter_competition_entries
for insert to authenticated
with check (
  user_id=(select auth.uid())
  and private.winter_event_today()>=date '2026-12-20'
  and exists (
    select 1 from public.winter_competitions c
    where c.slug=winter_competition_entries.competition_slug
      and c.status='open'
      and (c.starts_at at time zone 'Europe/Helsinki')::date <= private.winter_event_today()
      and (c.ends_at is null or (c.ends_at at time zone 'Europe/Helsinki')::date >= private.winter_event_today())
  )
);
