-- Winter World: rotating weather, scheduled events, and a shared weekly goal.
-- This migration is intentionally additive; it does not modify existing Winter Fest tables.

create table if not exists public.winter_world_goal_cycles (
  cycle_key date primary key,
  title text not null,
  description text not null,
  target_amount integer not null check (target_amount > 0),
  reward_coins integer not null check (reward_coins > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.winter_world_goal_contributions (
  cycle_key date not null references public.winter_world_goal_cycles(cycle_key) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null default 0 check (amount between 1 and 500),
  reward_claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (cycle_key, user_id)
);

create table if not exists public.winter_world_event_claims (
  event_slot text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_coins integer not null check (reward_coins > 0),
  claimed_at timestamptz not null default now(),
  primary key (event_slot, user_id)
);

alter table public.winter_world_goal_cycles enable row level security;
alter table public.winter_world_goal_contributions enable row level security;
alter table public.winter_world_event_claims enable row level security;

drop policy if exists "Anyone can read world goal cycles" on public.winter_world_goal_cycles;
create policy "Anyone can read world goal cycles"
  on public.winter_world_goal_cycles for select to anon, authenticated using (true);

drop policy if exists "Users can read own world goal contributions" on public.winter_world_goal_contributions;
create policy "Users can read own world goal contributions"
  on public.winter_world_goal_contributions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can read own world event claims" on public.winter_world_event_claims;
create policy "Users can read own world event claims"
  on public.winter_world_event_claims for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.winter_world_goal_cycles,
  public.winter_world_goal_contributions, public.winter_world_event_claims
  from anon, authenticated;

create or replace function private.winter_world_ensure_goal(p_day date)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle date := date_trunc('week', p_day::timestamp)::date;
begin
  insert into public.winter_world_goal_cycles(cycle_key, title, description, target_amount, reward_coins)
  values (v_cycle, 'Большая зимняя ёлка', 'Вместе соберём SnowCoins, чтобы зажечь главную ёлку Winter Fest.', 5000, 25)
  on conflict (cycle_key) do nothing;
  return v_cycle;
end;
$$;

create or replace function private.winter_world_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := private.winter_event_today();
  v_hour integer := extract(hour from timezone('Europe/Helsinki', now()))::integer;
  v_weather_slot integer := floor(v_hour / 6.0)::integer;
  v_event_slot integer := floor(v_hour / 12.0)::integer;
  v_weather_key text;
  v_event_key text;
  v_event_slot_key text;
  v_cycle date;
  v_goal public.winter_world_goal_cycles%rowtype;
  v_total integer := 0;
  v_mine integer := 0;
  v_reward_claimed boolean := false;
  v_event_claimed boolean := false;
  v_user uuid := auth.uid();
begin
  v_weather_key := (array['snowfall','aurora','frost','clear','blizzard'])
    [1 + (ascii(substr(md5(v_day::text || ':' || v_weather_slot::text), 1, 1)) % 5)];
  v_event_key := (array['snowflake_rush','aurora_night','frozen_gifts','snowman_parade'])
    [1 + (ascii(substr(md5(v_day::text || ':' || v_event_slot::text), 1, 1)) % 4)];
  v_event_slot_key := v_day::text || ':' || v_event_slot::text || ':' || v_event_key;

  v_cycle := private.winter_world_ensure_goal(v_day);
  select * into v_goal from public.winter_world_goal_cycles where cycle_key = v_cycle;
  select coalesce(sum(amount), 0)::integer into v_total
    from public.winter_world_goal_contributions where cycle_key = v_cycle;

  if v_user is not null then
    select coalesce(amount, 0), reward_claimed_at is not null
      into v_mine, v_reward_claimed
      from public.winter_world_goal_contributions
      where cycle_key = v_cycle and user_id = v_user;
    v_mine := coalesce(v_mine, 0);
    select exists(select 1 from public.winter_world_event_claims
      where event_slot = v_event_slot_key and user_id = v_user) into v_event_claimed;
  end if;

  return jsonb_build_object(
    'date', v_day,
    'weather_key', v_weather_key,
    'weather_slot', v_weather_slot,
    'event_key', v_event_key,
    'event_slot', v_event_slot_key,
    'event_claimed', v_event_claimed,
    'event_reward', 10,
    'goal', jsonb_build_object(
      'cycle_key', v_cycle,
      'title', v_goal.title,
      'description', v_goal.description,
      'target', v_goal.target_amount,
      'total', v_total,
      'my_contribution', v_mine,
      'reward_coins', v_goal.reward_coins,
      'reward_claimed', v_reward_claimed
    )
  );
end;
$$;

create or replace function private.winter_claim_world_event()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_state jsonb;
  v_slot text;
  v_reward integer := 10;
  v_balance integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if private.winter_event_today() < date '2026-12-20' then raise exception 'event_not_started'; end if;

  v_state := private.winter_world_state();
  v_slot := v_state->>'event_slot';

  insert into public.winter_world_event_claims(event_slot, user_id, reward_coins)
  values (v_slot, v_user, v_reward)
  on conflict (event_slot, user_id) do nothing;
  if not found then raise exception 'world_event_already_claimed'; end if;

  insert into public.winter_wallets(user_id, balance)
  values (v_user, 0) on conflict (user_id) do nothing;
  update public.winter_wallets set balance = balance + v_reward, updated_at = now()
    where user_id = v_user returning balance into v_balance;
  insert into public.winter_coin_ledger(user_id, amount, reason, reference)
  values (v_user, v_reward, 'world_event', 'world-event:' || v_slot);

  return jsonb_build_object('reward', v_reward, 'balance', v_balance, 'event_slot', v_slot);
end;
$$;

create or replace function private.winter_contribute_world_goal(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_cycle date;
  v_balance integer;
  v_mine integer;
  v_total integer;
  v_target integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if private.winter_event_today() < date '2026-12-20' then raise exception 'event_not_started'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 500 then raise exception 'invalid_contribution'; end if;

  v_cycle := private.winter_world_ensure_goal(private.winter_event_today());

  insert into public.winter_wallets(user_id, balance)
  values (v_user, 0) on conflict (user_id) do nothing;
  update public.winter_wallets set balance = balance - p_amount, updated_at = now()
    where user_id = v_user and balance >= p_amount returning balance into v_balance;
  if not found then raise exception 'insufficient_balance'; end if;

  insert into public.winter_world_goal_contributions(cycle_key, user_id, amount)
  values (v_cycle, v_user, p_amount)
  on conflict (cycle_key, user_id) do update
    set amount = public.winter_world_goal_contributions.amount + excluded.amount,
        updated_at = now()
    where public.winter_world_goal_contributions.amount <= 500 - excluded.amount
  returning amount into v_mine;
  if not found then raise exception 'weekly_contribution_limit'; end if;

  insert into public.winter_coin_ledger(user_id, amount, reason, reference)
  values (v_user, -p_amount, 'world_goal', 'world-goal:' || v_cycle::text);

  select coalesce(sum(amount), 0)::integer into v_total
    from public.winter_world_goal_contributions where cycle_key = v_cycle;
  select target_amount into v_target from public.winter_world_goal_cycles where cycle_key = v_cycle;

  return jsonb_build_object('contributed', p_amount, 'my_contribution', v_mine,
    'total', v_total, 'target', v_target, 'balance', v_balance);
end;
$$;

create or replace function private.winter_claim_world_goal_reward()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_cycle date;
  v_goal public.winter_world_goal_cycles%rowtype;
  v_total integer;
  v_balance integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if private.winter_event_today() < date '2026-12-20' then raise exception 'event_not_started'; end if;

  v_cycle := private.winter_world_ensure_goal(private.winter_event_today());
  select * into v_goal from public.winter_world_goal_cycles where cycle_key = v_cycle;
  select coalesce(sum(amount), 0)::integer into v_total
    from public.winter_world_goal_contributions where cycle_key = v_cycle;
  if v_total < v_goal.target_amount then raise exception 'world_goal_not_complete'; end if;

  update public.winter_world_goal_contributions
    set reward_claimed_at = now(), updated_at = now()
    where cycle_key = v_cycle and user_id = v_user
      and amount > 0 and reward_claimed_at is null;
  if not found then raise exception 'world_goal_reward_unavailable'; end if;

  insert into public.winter_wallets(user_id, balance)
  values (v_user, 0) on conflict (user_id) do nothing;
  update public.winter_wallets set balance = balance + v_goal.reward_coins, updated_at = now()
    where user_id = v_user returning balance into v_balance;
  insert into public.winter_coin_ledger(user_id, amount, reason, reference)
  values (v_user, v_goal.reward_coins, 'world_goal_reward', 'world-goal-reward:' || v_cycle::text);

  return jsonb_build_object('reward', v_goal.reward_coins, 'balance', v_balance, 'cycle_key', v_cycle);
end;
$$;

create or replace function public.winter_world_state()
returns jsonb language sql security definer set search_path = ''
as $ select private.winter_world_state(); $;

create or replace function public.winter_claim_world_event()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.winter_claim_world_event(); $$;

create or replace function public.winter_contribute_world_goal(p_amount integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.winter_contribute_world_goal(p_amount); $$;

create or replace function public.winter_claim_world_goal_reward()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.winter_claim_world_goal_reward(); $$;

revoke all on function private.winter_world_ensure_goal(date) from public, anon, authenticated;
revoke all on function private.winter_world_state() from public, anon, authenticated;
revoke all on function private.winter_claim_world_event() from public, anon;
revoke all on function private.winter_contribute_world_goal(integer) from public, anon;
revoke all on function private.winter_claim_world_goal_reward() from public, anon;
grant execute on function private.winter_claim_world_event() to authenticated;
grant execute on function private.winter_contribute_world_goal(integer) to authenticated;
grant execute on function private.winter_claim_world_goal_reward() to authenticated;

revoke all on function public.winter_world_state() from public;
revoke all on function public.winter_claim_world_event() from public, anon;
revoke all on function public.winter_contribute_world_goal(integer) from public, anon;
revoke all on function public.winter_claim_world_goal_reward() from public, anon;
grant execute on function public.winter_world_state() to anon, authenticated;
grant execute on function public.winter_claim_world_event() to authenticated;
grant execute on function public.winter_contribute_world_goal(integer) to authenticated;
grant execute on function public.winter_claim_world_goal_reward() to authenticated;
