-- Winter Fest SnowCoins clicker, server-authoritative rewards and upgrade progression.
create table if not exists public.winter_clicker_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  level integer not null default 1 check (level between 1 and 20),
  clicks_total bigint not null default 0 check (clicks_total >= 0),
  earned_total bigint not null default 0 check (earned_total >= 0),
  last_click_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.winter_clicker_stats enable row level security;
revoke all on table public.winter_clicker_stats from anon, authenticated;

insert into public.winter_shop_items(slug,name,description,icon,rarity,slot,price,active)
values
 ('frost-frame','Ледяная рамка','Холодное сияние вокруг твоего профиля.','🧊','rare','frame',180,true),
 ('aurora-frame','Рамка Аврора','Северное сияние в праздничной рамке.','🌌','epic','frame',420,true),
 ('royal-frame','Королевская зима','Особая рамка для настоящего зимнего коллекционера.','👑','legendary','frame',900,true),
 ('snowfall-bg','Снегопад','Спокойный фон с падающим снегом.','🌨️','common','background',120,true),
 ('aurora-bg','Полярное сияние','Яркое северное сияние за аватаром.','🌌','epic','background',500,true),
 ('ice-castle-bg','Ледяной замок','Профиль на фоне ледяного дворца.','🏰','legendary','background',1100,true),
 ('snowflake-badge','Снежинка','Маленький знак зимнего события.','❄️','common','badge',80,true),
 ('penguin-badge','Пингвин','Милый зимний спутник.','🐧','rare','badge',220,true),
 ('yeti-badge','Йети','Редкий знак снежного хранителя.','👣','epic','badge',600,true),
 ('winter-title','Зимний гость','Титул участника Winter Fest.','🎟️','common','title',100,true),
 ('snow-master-title','Повелитель снега','Титул для опытных участников события.','⛄','epic','title',700,true),
 ('north-star-title','Северная звезда','Легендарный титул коллекционера.','⭐','legendary','title',1500,true)
on conflict (slug) do nothing;

create or replace function private.winter_clicker_state()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_stats public.winter_clicker_stats%rowtype; v_today date := private.winter_event_today();
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if v_today < date '2026-12-20' then raise exception 'event_not_started'; end if;
  insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_stats from public.winter_clicker_stats where user_id=v_user;
  return jsonb_build_object('level',v_stats.level,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'click_power',v_stats.level,'next_upgrade_cost',case when v_stats.level >= 20 then null else 100 * v_stats.level * v_stats.level end);
end;
$$;

create or replace function private.winter_clicker_click()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid(); v_stats public.winter_clicker_stats%rowtype;
  v_balance integer; v_reward integer; v_now timestamptz := clock_timestamp();
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if private.winter_event_today() < date '2026-12-20' then raise exception 'event_not_started'; end if;
  insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
  insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_stats from public.winter_clicker_stats where user_id=v_user for update;
  if v_stats.last_click_at is not null and v_stats.last_click_at > v_now - interval '450 milliseconds' then raise exception 'click_too_fast'; end if;
  v_reward := v_stats.level;
  update public.winter_wallets set balance=balance+v_reward,updated_at=v_now where user_id=v_user returning balance into v_balance;
  update public.winter_clicker_stats set clicks_total=clicks_total+1,earned_total=earned_total+v_reward,last_click_at=v_now,updated_at=v_now where user_id=v_user returning * into v_stats;
  insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,v_reward,'clicker','click:'||v_stats.clicks_total::text);
  return jsonb_build_object('reward',v_reward,'balance',v_balance,'level',v_stats.level,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'click_power',v_stats.level,'next_upgrade_cost',case when v_stats.level >= 20 then null else 100 * v_stats.level * v_stats.level end);
end;
$$;

create or replace function private.winter_clicker_upgrade()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid(); v_stats public.winter_clicker_stats%rowtype;
  v_cost integer; v_balance integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if private.winter_event_today() < date '2026-12-20' then raise exception 'event_not_started'; end if;
  insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
  insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_stats from public.winter_clicker_stats where user_id=v_user for update;
  if v_stats.level >= 20 then raise exception 'clicker_max_level'; end if;
  v_cost := 100 * v_stats.level * v_stats.level;
  update public.winter_wallets set balance=balance-v_cost,updated_at=now() where user_id=v_user and balance>=v_cost returning balance into v_balance;
  if not found then raise exception 'insufficient_balance'; end if;
  update public.winter_clicker_stats set level=level+1,updated_at=now() where user_id=v_user returning * into v_stats;
  insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,-v_cost,'clicker_upgrade','clicker-level:'||v_stats.level::text);
  return jsonb_build_object('level',v_stats.level,'balance',v_balance,'click_power',v_stats.level,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'next_upgrade_cost',case when v_stats.level >= 20 then null else 100 * v_stats.level * v_stats.level end);
end;
$$;

create or replace function public.winter_clicker_state() returns jsonb language sql security invoker set search_path = '' as $$ select private.winter_clicker_state(); $$;
create or replace function public.winter_clicker_click() returns jsonb language sql security invoker set search_path = '' as $$ select private.winter_clicker_click(); $$;
create or replace function public.winter_clicker_upgrade() returns jsonb language sql security invoker set search_path = '' as $$ select private.winter_clicker_upgrade(); $$;

revoke all on function private.winter_clicker_state() from public, anon, authenticated;
revoke all on function private.winter_clicker_click() from public, anon, authenticated;
revoke all on function private.winter_clicker_upgrade() from public, anon, authenticated;
grant execute on function private.winter_clicker_state() to authenticated;
grant execute on function private.winter_clicker_click() to authenticated;
grant execute on function private.winter_clicker_upgrade() to authenticated;
revoke all on function public.winter_clicker_state() from public, anon;
revoke all on function public.winter_clicker_click() from public, anon;
revoke all on function public.winter_clicker_upgrade() from public, anon;
grant execute on function public.winter_clicker_state() to authenticated;
grant execute on function public.winter_clicker_click() to authenticated;
grant execute on function public.winter_clicker_upgrade() to authenticated;
