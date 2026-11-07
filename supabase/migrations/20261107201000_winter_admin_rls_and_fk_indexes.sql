
drop policy if exists "Winter admins manage shop" on public.winter_shop_items;
drop policy if exists "Winter admins manage quests" on public.winter_quests;
drop policy if exists "Winter admins manage competitions" on public.winter_competitions;
drop policy if exists "Winter admins manage advent rewards" on public.winter_advent_rewards;

create policy "Winter admins insert shop" on public.winter_shop_items for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins update shop" on public.winter_shop_items for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins delete shop" on public.winter_shop_items for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy "Winter admins insert quests" on public.winter_quests for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins update quests" on public.winter_quests for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins delete quests" on public.winter_quests for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy "Winter admins insert competitions" on public.winter_competitions for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins update competitions" on public.winter_competitions for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins delete competitions" on public.winter_competitions for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy "Winter admins insert advent rewards" on public.winter_advent_rewards for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins update advent rewards" on public.winter_advent_rewards for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins delete advent rewards" on public.winter_advent_rewards for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create index if not exists notifications_actor_id_idx on public.notifications(actor_id);
create index if not exists notifications_comment_id_idx on public.notifications(comment_id);
create index if not exists winter_advent_claims_day_idx on public.winter_advent_claims(day);
create index if not exists winter_competition_entries_user_idx on public.winter_competition_entries(user_id);
create index if not exists winter_competitions_winner_idx on public.winter_competitions(winner_user_id);
create index if not exists winter_equipped_items_inventory_idx on public.winter_equipped_items(user_id,item_slug);
create index if not exists winter_inventory_item_idx on public.winter_inventory(item_slug);
create index if not exists winter_quest_events_quest_idx on public.winter_quest_events(quest_slug);
create index if not exists winter_quest_progress_quest_idx on public.winter_quest_progress(quest_slug);

