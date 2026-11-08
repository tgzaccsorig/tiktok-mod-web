-- Expanded Winter Fest clicker and admin wallet controls.
create table if not exists public.winter_clicker_upgrade_defs (
  upgrade_key text primary key,
  title text not null,
  description text not null,
  icon text not null,
  base_cost integer not null check (base_cost > 0),
  power_per_level integer not null default 1,
  active boolean not null default true
);
insert into public.winter_clicker_upgrade_defs(upgrade_key,title,description,icon,base_cost,power_per_level) values
('power','Сила снежинки','Больше SnowCoins за каждое нажатие','❄️',40,3),
('gloves','Волшебные перчатки','Усиливают каждый клик','🧤',60,2),
('comet','Кометный след','Добавляет бонус к сбору','☄️',90,2),
('crystal','Кристальный фокус','Увеличивает отдачу клика','💎',120,3),
('streak','Снежная серия','Бонус за активные клики','🔥',160,2),
('magnet','Монетный магнит','Притягивает дополнительные монеты','🧲',220,2),
('aurora','Сила авроры','Усиливает общий доход','🌌',300,4),
('crown','Корона зимы','Редкое мощное улучшение','👑',450,5)
on conflict(upgrade_key) do update set title=excluded.title,description=excluded.description,icon=excluded.icon,base_cost=excluded.base_cost,power_per_level=excluded.power_per_level,active=true;

create table if not exists public.winter_clicker_upgrade_levels (
  user_id uuid not null references auth.users(id) on delete cascade,
  upgrade_key text not null references public.winter_clicker_upgrade_defs(upgrade_key) on delete cascade,
  level integer not null default 0 check (level between 0 and 40),
  updated_at timestamptz not null default now(),
  primary key(user_id,upgrade_key)
);
alter table public.winter_clicker_upgrade_defs enable row level security;
alter table public.winter_clicker_upgrade_levels enable row level security;
drop policy if exists "Anyone can read active clicker upgrades" on public.winter_clicker_upgrade_defs;
create policy "Anyone can read active clicker upgrades" on public.winter_clicker_upgrade_defs for select to anon,authenticated using(active);
drop policy if exists "Users can read own clicker upgrades" on public.winter_clicker_upgrade_levels;
create policy "Users can read own clicker upgrades" on public.winter_clicker_upgrade_levels for select to authenticated using(user_id=(select auth.uid()));
revoke insert,update,delete on public.winter_clicker_upgrade_defs from anon,authenticated;
revoke insert,update,delete on public.winter_clicker_upgrade_levels from anon,authenticated;

create or replace function private.winter_clicker_upgrade(p_upgrade_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_def public.winter_clicker_upgrade_defs%rowtype; v_level integer; v_cost integer; v_balance integer;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if private.winter_event_today()<date '2026-12-20' then raise exception 'event_not_started'; end if;
 select * into v_def from public.winter_clicker_upgrade_defs where upgrade_key=p_upgrade_key and active=true;
 if not found then raise exception 'upgrade_not_found'; end if;
 insert into public.winter_clicker_upgrade_levels(user_id,upgrade_key) values(v_user,p_upgrade_key) on conflict do nothing;
 select level into v_level from public.winter_clicker_upgrade_levels where user_id=v_user and upgrade_key=p_upgrade_key for update;
 if v_level>=40 then raise exception 'upgrade_max_level'; end if;
 v_cost:=ceil(v_def.base_cost*power(v_level+1,1.45))::integer;
 update public.winter_wallets set balance=balance-v_cost,updated_at=now() where user_id=v_user and balance>=v_cost returning balance into v_balance;
 if not found then raise exception 'insufficient_balance'; end if;
 update public.winter_clicker_upgrade_levels set level=level+1,updated_at=now() where user_id=v_user and upgrade_key=p_upgrade_key returning level into v_level;
 insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,-v_cost,'clicker_upgrade',p_upgrade_key||':'||v_level::text);
 return jsonb_build_object('upgrade_key',p_upgrade_key,'level',v_level,'balance',v_balance,'cost',v_cost);
end $$;

create or replace function public.winter_clicker_upgrade(p_upgrade_key text)
returns jsonb language sql security invoker set search_path='' as $$ select private.winter_clicker_upgrade(p_upgrade_key); $$;
revoke all on function private.winter_clicker_upgrade(text) from public,anon;
grant execute on function private.winter_clicker_upgrade(text) to authenticated;
revoke all on function public.winter_clicker_upgrade(text) from public,anon;
grant execute on function public.winter_clicker_upgrade(text) to authenticated;

create or replace function private.winter_clicker_state()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_stats public.winter_clicker_stats%rowtype; v_levels jsonb; v_power integer;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if private.winter_event_today()<date '2026-12-20' then raise exception 'event_not_started'; end if;
 insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
 select * into v_stats from public.winter_clicker_stats where user_id=v_user;
 select coalesce(jsonb_agg(jsonb_build_object('upgrade_key',d.upgrade_key,'title',d.title,'description',d.description,'icon',d.icon,'base_cost',d.base_cost,'power_per_level',d.power_per_level,'level',coalesce(l.level,0),'next_cost',case when coalesce(l.level,0)>=40 then null else ceil(d.base_cost*power(coalesce(l.level,0)+1,1.45))::integer end) order by d.base_cost),'[]'::jsonb),
        coalesce(sum(coalesce(l.level,0)*d.power_per_level),0)::integer
 into v_levels,v_power
 from public.winter_clicker_upgrade_defs d left join public.winter_clicker_upgrade_levels l on l.upgrade_key=d.upgrade_key and l.user_id=v_user where d.active=true;
 if v_stats.level>=20 then insert into public.winter_inventory(user_id,item_slug) values(v_user,'snow-legend') on conflict(user_id,item_slug) do nothing; end if;
 return jsonb_build_object('level',v_stats.level,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'click_power',greatest(1,v_stats.level+v_power),'next_upgrade_cost',null,'upgrades',v_levels);
end $$;
create or replace function public.winter_clicker_state() returns jsonb language sql security invoker set search_path='' as $$ select private.winter_clicker_state(); $$;
revoke all on function private.winter_clicker_state() from public,anon;
grant execute on function private.winter_clicker_state() to authenticated;
revoke all on function public.winter_clicker_state() from public,anon;
grant execute on function public.winter_clicker_state() to authenticated;

create or replace function private.winter_clicker_click()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_stats public.winter_clicker_stats%rowtype; v_balance integer; v_reward integer; v_power integer; v_now timestamptz:=clock_timestamp();
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if private.winter_event_today()<date '2026-12-20' then raise exception 'event_not_started'; end if;
 insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
 insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
 select * into v_stats from public.winter_clicker_stats where user_id=v_user for update;
 if v_stats.last_click_at is not null and v_stats.last_click_at>v_now-interval '450 milliseconds' then raise exception 'click_too_fast'; end if;
 select greatest(1,v_stats.level+coalesce(sum(l.level*d.power_per_level),0)::integer) into v_power from public.winter_clicker_upgrade_defs d left join public.winter_clicker_upgrade_levels l on l.upgrade_key=d.upgrade_key and l.user_id=v_user where d.active=true;
 v_reward:=v_power;
 update public.winter_wallets set balance=balance+v_reward,updated_at=v_now where user_id=v_user returning balance into v_balance;
 update public.winter_clicker_stats set clicks_total=clicks_total+1,earned_total=earned_total+v_reward,last_click_at=v_now,updated_at=v_now where user_id=v_user returning * into v_stats;
 insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,v_reward,'clicker','click:'||v_stats.clicks_total::text);
 return jsonb_build_object('reward',v_reward,'balance',v_balance,'level',v_stats.level,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'click_power',v_power,'next_upgrade_cost',null);
end $$;
create or replace function public.winter_clicker_click() returns jsonb language sql security invoker set search_path='' as $$ select private.winter_clicker_click(); $$;
revoke all on function private.winter_clicker_click() from public,anon;
grant execute on function private.winter_clicker_click() to authenticated;
revoke all on function public.winter_clicker_click() from public,anon;
grant execute on function public.winter_clicker_click() to authenticated;

create or replace function private.site_admin_manage_winter_user(p_username text,p_coin_delta integer default 0,p_reset_clicker boolean default false)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_admin uuid:=private.site_admin_require(); v_target uuid; v_balance integer;
begin
 select id into v_target from public.profiles where lower(username)=lower(trim(p_username)) limit 1;
 if v_target is null then raise exception 'user_not_found'; end if;
 if p_coin_delta < -1000000 or p_coin_delta > 1000000 then raise exception 'coin_delta_out_of_range'; end if;
 if p_coin_delta<>0 then
  insert into public.winter_wallets(user_id,balance) values(v_target,greatest(0,p_coin_delta)) on conflict(user_id) do nothing;
  update public.winter_wallets set balance=greatest(0,balance+p_coin_delta),updated_at=now() where user_id=v_target returning balance into v_balance;
  insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_target,case when p_coin_delta<0 then -least(abs(p_coin_delta),abs(p_coin_delta)) else p_coin_delta end,'admin_adjust','admin:'||gen_random_uuid()::text);
 end if;
 if p_reset_clicker then
  update public.winter_clicker_stats set level=1,clicks_total=0,earned_total=0,last_click_at=null,updated_at=now() where user_id=v_target;
  delete from public.winter_clicker_upgrade_levels where user_id=v_target;
 end if;
 insert into public.site_admin_audit_log(actor_id,action,target_type,target_id,details)
 values(v_admin,'manage_winter_user','user',v_target::text,jsonb_build_object('username',p_username,'coin_delta',p_coin_delta,'reset_clicker',p_reset_clicker));
 select balance into v_balance from public.winter_wallets where user_id=v_target;
 return jsonb_build_object('user_id',v_target,'balance',coalesce(v_balance,0),'clicker_reset',p_reset_clicker);
end $$;
create or replace function public.site_admin_manage_winter_user(p_username text,p_coin_delta integer default 0,p_reset_clicker boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.site_admin_manage_winter_user(p_username,p_coin_delta,p_reset_clicker); $$;
revoke all on function private.site_admin_manage_winter_user(text,integer,boolean) from public,anon;
grant execute on function private.site_admin_manage_winter_user(text,integer,boolean) to authenticated;
revoke all on function public.site_admin_manage_winter_user(text,integer,boolean) from public,anon;
grant execute on function public.site_admin_manage_winter_user(text,integer,boolean) to authenticated;

-- Additional varied daily/weekly/special quests using currently supported event actions.
insert into public.winter_quests(slug,title,description,action_key,cadence,goal,reward_coins,starts_on,active) values
('daily-five-likes','Ледяная пятёрка','Поставь пять лайков роликам за день.','like','daily',5,25,'2026-12-20',true),
('daily-ten-likes','Снежный поток','Поставь десять лайков за день.','like','daily',10,45,'2026-12-20',true),
('daily-new-friend','Новое знакомство','Подпишись на одного автора.','follow','daily',1,20,'2026-12-20',true),
('weekly-social','Неделя общения','Подпишись на пять интересных авторов.','follow','weekly',5,70,'2026-12-20',true),
('weekly-fan','Преданный зритель','Поставь 30 лайков за неделю.','like','weekly',30,120,'2026-12-20',true),
('special-like-50','Полярный марафон','Поставь 50 лайков за время события.','like','special',50,250,'2026-12-20',true),
('special-follow-10','Круг друзей','Подпишись на десять авторов за событие.','follow','special',10,180,'2026-12-20',true),
('daily-like-3','Три снежинки','Поставь три лайка за день.','like','daily',3,15,'2026-12-20',true),
('weekly-like-15','Снежная неделя','Поставь 15 лайков за неделю.','like','weekly',15,65,'2026-12-20',true),
('special-follow-5','Зимние знакомства','Подпишись на пять авторов.','follow','special',5,90,'2026-12-20',true)
on conflict(slug) do nothing;
