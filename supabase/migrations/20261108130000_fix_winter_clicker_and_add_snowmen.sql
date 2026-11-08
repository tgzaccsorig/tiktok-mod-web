-- Repair click history references and add passive Snowman Auto Clickers.
create or replace function private.winter_clicker_click()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid:=auth.uid(); v_stats public.winter_clicker_stats%rowtype; v_balance integer;
 v_reward integer; v_power integer; v_total integer; v_now timestamptz:=clock_timestamp();
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if private.winter_event_today()<date '2026-12-20' then raise exception 'event_not_started'; end if;
 insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
 insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
 select * into v_stats from public.winter_clicker_stats where user_id=v_user for update;
 if v_stats.last_click_at is not null and v_stats.last_click_at>v_now-interval '450 milliseconds' then raise exception 'click_too_fast'; end if;
 select coalesce(sum(l.level),0)::integer,1+coalesce(sum(l.level*d.power_per_level),0)::integer
 into v_total,v_power from public.winter_clicker_upgrade_defs d
 left join public.winter_clicker_upgrade_levels l on l.upgrade_key=d.upgrade_key and l.user_id=v_user where d.active=true;
 v_reward:=v_power;
 update public.winter_wallets set balance=balance+v_reward,updated_at=v_now where user_id=v_user returning balance into v_balance;
 update public.winter_clicker_stats set clicks_total=clicks_total+1,earned_total=earned_total+v_reward,last_click_at=v_now,updated_at=v_now where user_id=v_user returning * into v_stats;
 insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,v_reward,'clicker','click:'||gen_random_uuid()::text);
 return jsonb_build_object('reward',v_reward,'balance',v_balance,'level',v_total,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'click_power',v_power,'next_upgrade_cost',null);
end $$;

create table if not exists public.winter_snowman_defs (
 snowman_key text primary key,title text not null,description text not null,icon text not null,
 base_cost integer not null check(base_cost>0),income_per_level integer not null check(income_per_level>0),
 max_level integer not null default 25 check(max_level between 1 and 100),active boolean not null default true
);
insert into public.winter_snowman_defs(snowman_key,title,description,icon,base_cost,income_per_level,max_level) values
 ('helper','Снеговик-помощник','Начинает собирать SnowCoins вместо тебя','⛄',120,1,25),
 ('lantern','Снеговик-фонарщик','Собирает монеты в ночную смену','🏮',450,4,25),
 ('miner','Снежный шахтёр','Добывает ледяные кристаллы и монеты','⛏️',1400,12,25),
 ('polar','Полярный снеговик','Ускоряет сбор благодаря северному сиянию','🐻‍❄️',4200,35,25),
 ('captain','Снежный капитан','Командует целой бригадой снеговиков','🎖️',12000,100,25)
on conflict(snowman_key) do update set title=excluded.title,description=excluded.description,icon=excluded.icon,base_cost=excluded.base_cost,income_per_level=excluded.income_per_level,max_level=excluded.max_level,active=true;

create table if not exists public.winter_snowman_levels (
 user_id uuid not null references public.profiles(id) on delete cascade,
 snowman_key text not null references public.winter_snowman_defs(snowman_key) on delete cascade,
 level integer not null default 0 check(level between 0 and 25),updated_at timestamptz not null default now(),
 primary key(user_id,snowman_key)
);
create table if not exists public.winter_snowman_collection (
 user_id uuid primary key references public.profiles(id) on delete cascade,last_collected_at timestamptz not null default now()
);
alter table public.winter_snowman_defs enable row level security;
alter table public.winter_snowman_levels enable row level security;
alter table public.winter_snowman_collection enable row level security;
drop policy if exists "Anyone can read active snowmen" on public.winter_snowman_defs;
create policy "Anyone can read active snowmen" on public.winter_snowman_defs for select to anon,authenticated using(active);
drop policy if exists "Users can read own snowman levels" on public.winter_snowman_levels;
create policy "Users can read own snowman levels" on public.winter_snowman_levels for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists "Users can read own snowman collection" on public.winter_snowman_collection;
create policy "Users can read own snowman collection" on public.winter_snowman_collection for select to authenticated using(user_id=(select auth.uid()));
revoke insert,update,delete on public.winter_snowman_defs,public.winter_snowman_levels,public.winter_snowman_collection from anon,authenticated;

create or replace function private.winter_auto_clicker_collect()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_last timestamptz; v_now timestamptz:=clock_timestamp();
 v_elapsed integer; v_rate integer; v_amount integer; v_balance integer;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if private.winter_event_today()<date '2026-12-20' then raise exception 'event_not_started'; end if;
 insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
 insert into public.winter_snowman_collection(user_id,last_collected_at) values(v_user,v_now) on conflict(user_id) do nothing;
 select last_collected_at into v_last from public.winter_snowman_collection where user_id=v_user for update;
 select coalesce(sum(l.level*d.income_per_level),0)::integer into v_rate
 from public.winter_snowman_defs d left join public.winter_snowman_levels l
 on l.snowman_key=d.snowman_key and l.user_id=v_user where d.active=true;
 v_elapsed:=greatest(0,least(43200,floor(extract(epoch from (v_now-v_last)))::integer));
 v_amount:=floor(v_elapsed/60.0)::integer*v_rate;
 if v_amount>0 then
  update public.winter_wallets set balance=balance+v_amount,updated_at=v_now where user_id=v_user returning balance into v_balance;
  insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,v_amount,'snowman_auto','snowman:'||gen_random_uuid()::text);
 else select balance into v_balance from public.winter_wallets where user_id=v_user; end if;
 update public.winter_snowman_collection set last_collected_at=v_now where user_id=v_user;
 return jsonb_build_object('collected',v_amount,'balance',coalesce(v_balance,0),'income_per_minute',v_rate);
end $$;

create or replace function private.winter_auto_clicker_state()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_collect jsonb; v_snowmen jsonb; v_rate integer;
begin
 v_collect:=private.winter_auto_clicker_collect();
 select coalesce(sum(coalesce(l.level,0)*d.income_per_level),0)::integer,
 coalesce(jsonb_agg(jsonb_build_object('snowman_key',d.snowman_key,'title',d.title,'description',d.description,'icon',d.icon,
 'level',coalesce(l.level,0),'max_level',d.max_level,
 'next_cost',case when coalesce(l.level,0)>=d.max_level then null else ceil(d.base_cost*power(coalesce(l.level,0)+1,1.6))::integer end,
 'income_per_minute',coalesce(l.level,0)*d.income_per_level) order by d.base_cost),'[]'::jsonb)
 into v_rate,v_snowmen from public.winter_snowman_defs d left join public.winter_snowman_levels l
 on l.snowman_key=d.snowman_key and l.user_id=auth.uid() where d.active=true;
 return jsonb_build_object('snowmen',v_snowmen,'income_per_minute',v_rate,
 'collected',coalesce((v_collect->>'collected')::integer,0),'balance',coalesce((v_collect->>'balance')::integer,0));
end $$;

create or replace function private.winter_auto_clicker_upgrade(p_snowman_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_def public.winter_snowman_defs%rowtype; v_level integer; v_cost integer; v_balance integer;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 perform private.winter_auto_clicker_collect();
 select * into v_def from public.winter_snowman_defs where snowman_key=p_snowman_key and active=true;
 if not found then raise exception 'snowman_not_found'; end if;
 insert into public.winter_snowman_levels(user_id,snowman_key) values(v_user,p_snowman_key) on conflict do nothing;
 select level into v_level from public.winter_snowman_levels where user_id=v_user and snowman_key=p_snowman_key for update;
 if v_level>=v_def.max_level then raise exception 'snowman_max_level'; end if;
 v_cost:=ceil(v_def.base_cost*power(v_level+1,1.6))::integer;
 update public.winter_wallets set balance=balance-v_cost,updated_at=now() where user_id=v_user and balance>=v_cost returning balance into v_balance;
 if not found then raise exception 'insufficient_balance'; end if;
 update public.winter_snowman_levels set level=level+1,updated_at=now() where user_id=v_user and snowman_key=p_snowman_key returning level into v_level;
 insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,-v_cost,'snowman_upgrade','snowman-upgrade:'||gen_random_uuid()::text);
 return jsonb_build_object('snowman_key',p_snowman_key,'level',v_level,'balance',v_balance,'cost',v_cost);
end $$;

create or replace function public.winter_auto_clicker_state() returns jsonb language sql security invoker set search_path='' as $$ select private.winter_auto_clicker_state(); $$;
create or replace function public.winter_auto_clicker_upgrade(p_snowman_key text) returns jsonb language sql security invoker set search_path='' as $$ select private.winter_auto_clicker_upgrade(p_snowman_key); $$;
revoke all on function private.winter_auto_clicker_collect() from public,anon;
revoke all on function private.winter_auto_clicker_state() from public,anon;
revoke all on function private.winter_auto_clicker_upgrade(text) from public,anon;
grant execute on function private.winter_auto_clicker_collect() to authenticated;
grant execute on function private.winter_auto_clicker_state() to authenticated;
grant execute on function private.winter_auto_clicker_upgrade(text) to authenticated;
revoke all on function public.winter_auto_clicker_state() from public,anon;
revoke all on function public.winter_auto_clicker_upgrade(text) from public,anon;
grant execute on function public.winter_auto_clicker_state() to authenticated;
grant execute on function public.winter_auto_clicker_upgrade(text) to authenticated;
