create table if not exists public.winter_event_settings (
  id boolean primary key default true check (id = true),
  test_mode boolean not null default false,
  test_date date not null default date '2026-12-20',
  updated_at timestamptz not null default now()
);
alter table public.winter_event_settings enable row level security;
revoke all on public.winter_event_settings from anon, authenticated;
grant select, update on public.winter_event_settings to authenticated;
drop policy if exists "Winter admins read event settings" on public.winter_event_settings;
drop policy if exists "Winter admins update event settings" on public.winter_event_settings;
create policy "Winter admins read event settings" on public.winter_event_settings for select to authenticated using (((select auth.jwt())->'app_metadata'->>'role')='admin');
create policy "Winter admins update event settings" on public.winter_event_settings for update to authenticated using (((select auth.jwt())->'app_metadata'->>'role')='admin') with check (((select auth.jwt())->'app_metadata'->>'role')='admin');
insert into public.winter_event_settings(id,test_mode,test_date) values(true,false,date '2026-12-20') on conflict(id) do nothing;
create or replace function private.winter_event_today() returns date language sql stable security definer set search_path='' as $$
select case when (select auth.jwt()->'app_metadata'->>'role')='admin' and coalesce((select s.test_mode from public.winter_event_settings s where s.id=true),false) then coalesce((select s.test_date from public.winter_event_settings s where s.id=true),timezone('Europe/Helsinki',now())::date) else timezone('Europe/Helsinki',now())::date end;
$$;
revoke all on function private.winter_event_today() from public,anon,authenticated;
create or replace function private.winter_claim_advent_day(p_day date) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid(); v_reward public.winter_advent_rewards%rowtype; v_balance integer; v_today date:=private.winter_event_today();
begin
if v_user is null then raise exception 'authentication_required'; end if;
if v_today<date '2026-12-20' then raise exception 'event_not_started'; end if;
if p_day<date '2026-12-01' or p_day>date '2026-12-24' or p_day>v_today then raise exception 'advent_day_locked'; end if;
select * into v_reward from public.winter_advent_rewards where day=p_day and active;
if not found then raise exception 'reward_unavailable'; end if;
insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
insert into public.winter_advent_claims(user_id,day,reward_coins) values(v_user,p_day,v_reward.reward_coins) on conflict do nothing;
if not found then raise exception 'already_claimed'; end if;
update public.winter_wallets set balance=balance+v_reward.reward_coins,updated_at=now() where user_id=v_user returning balance into v_balance;
insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,v_reward.reward_coins,'advent','advent:'||p_day::text);
return jsonb_build_object('day',p_day,'reward_coins',v_reward.reward_coins,'balance',v_balance);
end;$function$;
create or replace function private.winter_claim_quest(p_slug text) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid(); v_quest public.winter_quests%rowtype; v_cycle text; v_balance integer; v_today date:=private.winter_event_today();
begin
if v_user is null then raise exception 'authentication_required'; end if;
if v_today<date '2026-12-20' then raise exception 'event_not_started'; end if;
select * into v_quest from public.winter_quests where slug=p_slug and active;
if not found then raise exception 'quest_unavailable'; end if;
v_cycle:=case when v_quest.cadence='daily' then to_char(v_today,'YYYY-MM-DD') when v_quest.cadence='weekly' then to_char(date_trunc('week',v_today)::date,'YYYY-MM-DD') else 'event' end;
update public.winter_quest_progress set claimed_at=now() where user_id=v_user and quest_slug=p_slug and cycle_key=v_cycle and progress>=v_quest.goal and completed_at is not null and claimed_at is null;
if not found then raise exception 'quest_not_ready_or_already_claimed'; end if;
insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
update public.winter_wallets set balance=balance+v_quest.reward_coins,updated_at=now() where user_id=v_user returning balance into v_balance;
insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,v_quest.reward_coins,'quest','quest:'||p_slug||':'||v_cycle);
return jsonb_build_object('quest',p_slug,'reward_coins',v_quest.reward_coins,'balance',v_balance);
end;$function$;
create or replace function private.winter_equip_item(p_slug text) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid(); v_slot text; v_today date:=private.winter_event_today();
begin
if v_user is null then raise exception 'authentication_required'; end if;
if v_today<date '2026-12-20' then raise exception 'event_not_started'; end if;
select i.slot into v_slot from public.winter_shop_items i join public.winter_inventory inv on inv.item_slug=i.slug and inv.user_id=v_user where i.slug=p_slug and i.active;
if not found then raise exception 'item_not_owned'; end if;
insert into public.winter_equipped_items(user_id,slot,item_slug) values(v_user,v_slot,p_slug) on conflict(user_id,slot) do update set item_slug=excluded.item_slug,updated_at=now();
return jsonb_build_object('slot',v_slot,'item',p_slug);
end;$function$;
create or replace function private.winter_purchase_item(p_slug text) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid(); v_item public.winter_shop_items%rowtype; v_balance integer; v_today date:=private.winter_event_today();
begin
if v_user is null then raise exception 'authentication_required'; end if;
if v_today<date '2026-12-20' then raise exception 'event_not_started'; end if;
select * into v_item from public.winter_shop_items where slug=p_slug and active;
if not found then raise exception 'item_unavailable'; end if;
if exists(select 1 from public.winter_inventory where user_id=v_user and item_slug=p_slug) then raise exception 'already_owned'; end if;
insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
update public.winter_wallets set balance=balance-v_item.price,updated_at=now() where user_id=v_user and balance>=v_item.price returning balance into v_balance;
if not found then raise exception 'insufficient_balance'; end if;
insert into public.winter_inventory(user_id,item_slug) values(v_user,p_slug);
if v_item.price>0 then insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,-v_item.price,'purchase','purchase:'||p_slug); end if;
return jsonb_build_object('item',p_slug,'balance',v_balance);
end;$function$;
create or replace function private.winter_record_social_action() returns trigger language plpgsql security definer set search_path='' as $function$
declare v_user uuid; v_action text; v_ref text; q record; v_cycle text; v_count integer; v_today date:=private.winter_event_today();
begin
if tg_table_name='likes' then v_user:=new.user_id;v_action:='like';v_ref:=new.video_id; elsif tg_table_name='follows' then v_user:=new.follower_id;v_action:='follow';v_ref:=new.following_id::text; else return new; end if;
if auth.uid() is null or auth.uid()<>v_user then return new; end if;
if v_today<date '2026-12-20' then return new; end if;
for q in select * from public.winter_quests where active and action_key=v_action and v_today>=starts_on and (ends_on is null or v_today<=ends_on) loop
v_cycle:=case when q.cadence='daily' then to_char(v_today,'YYYY-MM-DD') when q.cadence='weekly' then to_char(date_trunc('week',v_today)::date,'YYYY-MM-DD') else 'event' end;
insert into public.winter_quest_events(user_id,quest_slug,cycle_key,action_ref) values(v_user,q.slug,v_cycle,v_ref) on conflict do nothing;
if found then
select count(*)::integer into v_count from public.winter_quest_events where user_id=v_user and quest_slug=q.slug and cycle_key=v_cycle;
insert into public.winter_quest_progress(user_id,quest_slug,cycle_key,progress,completed_at) values(v_user,q.slug,v_cycle,v_count,case when v_count>=q.goal then now() else null end)
on conflict(user_id,quest_slug,cycle_key) do update set progress=excluded.progress,completed_at=case when excluded.progress>=q.goal then coalesce(public.winter_quest_progress.completed_at,now()) else public.winter_quest_progress.completed_at end;
end if; end loop; return new;
end;$function$;
drop policy if exists "Winter users enter open competitions" on public.winter_competition_entries;
create policy "Winter users enter open competitions" on public.winter_competition_entries for insert to authenticated with check (
user_id=(select auth.uid()) and private.winter_event_today()>=date '2026-12-20' and exists(select 1 from public.winter_competitions c where c.slug=winter_competition_entries.competition_slug and c.status='open' and now()>=c.starts_at and (c.ends_at is null or now()<=c.ends_at))
);
