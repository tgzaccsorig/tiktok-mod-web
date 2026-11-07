create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.winter_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.winter_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null,
  reference text not null,
  created_at timestamptz not null default now(),
  unique(user_id, reference)
);
create table if not exists public.winter_advent_rewards (
  day date primary key,
  reward_coins integer not null default 10 check (reward_coins >= 0),
  reward_title text not null default 'SnowCoins',
  icon text not null default '❄️',
  active boolean not null default true
);
create table if not exists public.winter_advent_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null references public.winter_advent_rewards(day),
  reward_coins integer not null,
  claimed_at timestamptz not null default now(),
  primary key(user_id, day)
);
create table if not exists public.winter_shop_items (
  slug text primary key,
  name text not null,
  description text not null default '',
  icon text not null default '❄️',
  rarity text not null check (rarity in ('common','rare','epic','legendary')),
  slot text not null check (slot in ('frame','background','badge','title')),
  price integer not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.winter_inventory (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_slug text not null references public.winter_shop_items(slug),
  purchased_at timestamptz not null default now(),
  primary key(user_id, item_slug)
);
create table if not exists public.winter_equipped_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot text not null check (slot in ('frame','background','badge','title')),
  item_slug text not null,
  updated_at timestamptz not null default now(),
  primary key(user_id, slot),
  foreign key(user_id, item_slug) references public.winter_inventory(user_id, item_slug) on delete cascade
);
create table if not exists public.winter_quests (
  slug text primary key,
  title text not null,
  description text not null default '',
  action_key text not null check (action_key in ('like','follow')),
  cadence text not null check (cadence in ('daily','weekly','special','event')),
  goal integer not null check (goal > 0),
  reward_coins integer not null check (reward_coins > 0),
  starts_on date not null default date '2026-12-20',
  ends_on date,
  active boolean not null default true
);
create table if not exists public.winter_quest_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  quest_slug text not null references public.winter_quests(slug) on delete cascade,
  cycle_key text not null,
  action_ref text not null,
  created_at timestamptz not null default now(),
  unique(user_id, quest_slug, cycle_key, action_ref)
);
create table if not exists public.winter_quest_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  quest_slug text not null references public.winter_quests(slug) on delete cascade,
  cycle_key text not null,
  progress integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  claimed_at timestamptz,
  primary key(user_id, quest_slug, cycle_key)
);
create table if not exists public.winter_competitions (
  slug text primary key,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft','open','closed','finished')),
  winner_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.winter_competition_entries (
  id uuid primary key default gen_random_uuid(),
  competition_slug text not null references public.winter_competitions(slug) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_url text not null check (video_url ~ '^https://(www\.)?tiktok\.com/'),
  created_at timestamptz not null default now(),
  unique(competition_slug, user_id)
);

create index if not exists winter_ledger_user_created_idx on public.winter_coin_ledger(user_id, created_at desc);
create index if not exists winter_claims_user_day_idx on public.winter_advent_claims(user_id, day);
create index if not exists winter_inventory_user_idx on public.winter_inventory(user_id);
create index if not exists winter_progress_user_idx on public.winter_quest_progress(user_id, quest_slug);
create index if not exists winter_entries_competition_idx on public.winter_competition_entries(competition_slug, created_at);

alter table public.winter_wallets enable row level security;
alter table public.winter_coin_ledger enable row level security;
alter table public.winter_advent_rewards enable row level security;
alter table public.winter_advent_claims enable row level security;
alter table public.winter_shop_items enable row level security;
alter table public.winter_inventory enable row level security;
alter table public.winter_equipped_items enable row level security;
alter table public.winter_quests enable row level security;
alter table public.winter_quest_events enable row level security;
alter table public.winter_quest_progress enable row level security;
alter table public.winter_competitions enable row level security;
alter table public.winter_competition_entries enable row level security;

create policy "Winter wallet owner reads balance" on public.winter_wallets for select to authenticated using ((select auth.uid()) = user_id);
create policy "Winter ledger owner reads history" on public.winter_coin_ledger for select to authenticated using ((select auth.uid()) = user_id);
create policy "Winter advent rewards are public" on public.winter_advent_rewards for select to anon, authenticated using (true);
create policy "Winter claims owner reads claims" on public.winter_advent_claims for select to authenticated using ((select auth.uid()) = user_id);
create policy "Winter shop is public" on public.winter_shop_items for select to anon, authenticated using (active);
create policy "Winter inventory owner reads items" on public.winter_inventory for select to authenticated using ((select auth.uid()) = user_id);
create policy "Winter equipped items are public" on public.winter_equipped_items for select to anon, authenticated using (true);
create policy "Winter quests are public" on public.winter_quests for select to anon, authenticated using (active);
create policy "Winter progress owner reads progress" on public.winter_quest_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "Winter competitions are public" on public.winter_competitions for select to anon, authenticated using (true);
create policy "Winter entries are public" on public.winter_competition_entries for select to anon, authenticated using (true);
create policy "Winter users enter open competitions" on public.winter_competition_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select timezone('Europe/Helsinki', now())::date) >= date '2026-12-20'
    and exists (
      select 1 from public.winter_competitions c
      where c.slug = competition_slug and c.status = 'open'
        and now() >= c.starts_at and (c.ends_at is null or now() <= c.ends_at)
    )
  );
create policy "Winter admins manage shop" on public.winter_shop_items for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins manage quests" on public.winter_quests for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Winter admins manage competitions" on public.winter_competitions for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

grant select on public.winter_advent_rewards, public.winter_shop_items, public.winter_quests, public.winter_competitions, public.winter_competition_entries, public.winter_equipped_items to anon, authenticated;
grant select on public.winter_wallets, public.winter_coin_ledger, public.winter_advent_claims, public.winter_inventory, public.winter_quest_progress to authenticated;
grant insert on public.winter_competition_entries to authenticated;
grant insert, update, delete on public.winter_shop_items, public.winter_quests, public.winter_competitions to authenticated;

insert into public.winter_advent_rewards(day, reward_coins, reward_title, icon)
select date '2026-12-01' + n, 10, 'SnowCoins', '❄️'
from generate_series(0, 23) as n
on conflict (day) do nothing;

insert into public.winter_shop_items(slug,name,description,icon,rarity,slot,price) values
('snowflake-frame','Снежная рамка','Холодное сияние вокруг аватара.','❄️','common','frame',50),
('frost-background','Морозный фон','Зимний фон для профиля.','🌨️','rare','background',100),
('winter-badge','Значок Winter Fest','Праздничный значок профиля.','🎄','epic','badge',150),
('ice-title','Ледяной титул','Особый зимний титул.','🧊','legendary','title',250)
on conflict (slug) do nothing;

insert into public.winter_quests(slug,title,description,action_key,cadence,goal,reward_coins) values
('daily-like','Первый лайк дня','Поставь лайк одному ролику сегодня.','like','daily',1,10),
('weekly-follow','Неделя знакомств','Подпишись на трёх разных авторов за неделю.','follow','weekly',3,35),
('winter-likes','Зимний марафон','Поставь лайки десяти разным роликам.','like','special',10,100)
on conflict (slug) do nothing;

create or replace function private.winter_record_social_action()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_action text;
  v_ref text;
  q record;
  v_cycle text;
  v_count integer;
begin
  if tg_table_name = 'likes' then
    v_user := new.user_id; v_action := 'like'; v_ref := new.video_id;
  elsif tg_table_name = 'follows' then
    v_user := new.follower_id; v_action := 'follow'; v_ref := new.following_id::text;
  else
    return new;
  end if;
  if auth.uid() is null or auth.uid() <> v_user then return new; end if;
  if timezone('Europe/Helsinki', now())::date < date '2026-12-20' then return new; end if;
  for q in
    select * from public.winter_quests
    where active and action_key = v_action
      and timezone('Europe/Helsinki', now())::date >= starts_on
      and (ends_on is null or timezone('Europe/Helsinki', now())::date <= ends_on)
  loop
    v_cycle := case
      when q.cadence = 'daily' then to_char(timezone('Europe/Helsinki', now())::date, 'YYYY-MM-DD')
      when q.cadence = 'weekly' then to_char(date_trunc('week', timezone('Europe/Helsinki', now()))::date, 'YYYY-MM-DD')
      else 'event'
    end;
    insert into public.winter_quest_events(user_id, quest_slug, cycle_key, action_ref)
    values (v_user, q.slug, v_cycle, v_ref) on conflict do nothing;
    if found then
      select count(*)::integer into v_count from public.winter_quest_events
      where user_id = v_user and quest_slug = q.slug and cycle_key = v_cycle;
      insert into public.winter_quest_progress(user_id, quest_slug, cycle_key, progress, completed_at)
      values (v_user, q.slug, v_cycle, v_count, case when v_count >= q.goal then now() else null end)
      on conflict (user_id, quest_slug, cycle_key) do update
        set progress = excluded.progress,
            completed_at = case when excluded.progress >= q.goal then coalesce(public.winter_quest_progress.completed_at, now()) else public.winter_quest_progress.completed_at end;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists winter_like_quest_progress on public.likes;
create trigger winter_like_quest_progress after insert on public.likes for each row execute function private.winter_record_social_action();
drop trigger if exists winter_follow_quest_progress on public.follows;
create trigger winter_follow_quest_progress after insert on public.follows for each row execute function private.winter_record_social_action();

create or replace function private.winter_claim_advent_day(p_day date)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_reward public.winter_advent_rewards%rowtype;
  v_balance integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if timezone('Europe/Helsinki', now())::date < date '2026-12-20' then raise exception 'event_not_started'; end if;
  if p_day < date '2026-12-01' or p_day > date '2026-12-24' or p_day > timezone('Europe/Helsinki', now())::date then raise exception 'advent_day_locked'; end if;
  select * into v_reward from public.winter_advent_rewards where day = p_day and active;
  if not found then raise exception 'reward_unavailable'; end if;
  insert into public.winter_wallets(user_id, balance) values (v_user, 0) on conflict (user_id) do nothing;
  insert into public.winter_advent_claims(user_id, day, reward_coins) values (v_user, p_day, v_reward.reward_coins) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  update public.winter_wallets set balance = balance + v_reward.reward_coins, updated_at = now()
    where user_id = v_user returning balance into v_balance;
  insert into public.winter_coin_ledger(user_id, amount, reason, reference)
    values (v_user, v_reward.reward_coins, 'advent', 'advent:' || p_day::text);
  return jsonb_build_object('day', p_day, 'reward_coins', v_reward.reward_coins, 'balance', v_balance);
end;
$$;

create or replace function private.winter_purchase_item(p_slug text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item public.winter_shop_items%rowtype;
  v_balance integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if timezone('Europe/Helsinki', now())::date < date '2026-12-20' then raise exception 'event_not_started'; end if;
  select * into v_item from public.winter_shop_items where slug = p_slug and active;
  if not found then raise exception 'item_unavailable'; end if;
  if exists (select 1 from public.winter_inventory where user_id = v_user and item_slug = p_slug) then raise exception 'already_owned'; end if;
  insert into public.winter_wallets(user_id, balance) values (v_user, 0) on conflict (user_id) do nothing;
  update public.winter_wallets set balance = balance - v_item.price, updated_at = now()
    where user_id = v_user and balance >= v_item.price returning balance into v_balance;
  if not found then raise exception 'insufficient_balance'; end if;
  insert into public.winter_inventory(user_id, item_slug) values (v_user, p_slug);
  if v_item.price > 0 then
    insert into public.winter_coin_ledger(user_id, amount, reason, reference) values (v_user, -v_item.price, 'purchase', 'purchase:' || p_slug);
  end if;
  return jsonb_build_object('item', p_slug, 'balance', v_balance);
end;
$$;

create or replace function private.winter_equip_item(p_slug text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_slot text;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if timezone('Europe/Helsinki', now())::date < date '2026-12-20' then raise exception 'event_not_started'; end if;
  select i.slot into v_slot from public.winter_shop_items i
  join public.winter_inventory inv on inv.item_slug = i.slug and inv.user_id = v_user
  where i.slug = p_slug and i.active;
  if not found then raise exception 'item_not_owned'; end if;
  insert into public.winter_equipped_items(user_id, slot, item_slug) values (v_user, v_slot, p_slug)
  on conflict (user_id, slot) do update set item_slug = excluded.item_slug, updated_at = now();
  return jsonb_build_object('slot', v_slot, 'item', p_slug);
end;
$$;

create or replace function private.winter_claim_quest(p_slug text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_quest public.winter_quests%rowtype;
  v_cycle text;
  v_balance integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if timezone('Europe/Helsinki', now())::date < date '2026-12-20' then raise exception 'event_not_started'; end if;
  select * into v_quest from public.winter_quests where slug = p_slug and active;
  if not found then raise exception 'quest_unavailable'; end if;
  v_cycle := case
    when v_quest.cadence = 'daily' then to_char(timezone('Europe/Helsinki', now())::date, 'YYYY-MM-DD')
    when v_quest.cadence = 'weekly' then to_char(date_trunc('week', timezone('Europe/Helsinki', now()))::date, 'YYYY-MM-DD')
    else 'event'
  end;
  update public.winter_quest_progress set claimed_at = now()
  where user_id = v_user and quest_slug = p_slug and cycle_key = v_cycle
    and progress >= v_quest.goal and completed_at is not null and claimed_at is null;
  if not found then raise exception 'quest_not_ready_or_already_claimed'; end if;
  insert into public.winter_wallets(user_id, balance) values (v_user, 0) on conflict (user_id) do nothing;
  update public.winter_wallets set balance = balance + v_quest.reward_coins, updated_at = now()
    where user_id = v_user returning balance into v_balance;
  insert into public.winter_coin_ledger(user_id, amount, reason, reference)
    values (v_user, v_quest.reward_coins, 'quest', 'quest:' || p_slug || ':' || v_cycle);
  return jsonb_build_object('quest', p_slug, 'reward_coins', v_quest.reward_coins, 'balance', v_balance);
end;
$$;

create or replace function public.winter_claim_advent_day(p_day date)
returns jsonb language sql security invoker set search_path = '' as $$ select private.winter_claim_advent_day(p_day); $$;
create or replace function public.winter_purchase_item(p_slug text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.winter_purchase_item(p_slug); $$;
create or replace function public.winter_equip_item(p_slug text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.winter_equip_item(p_slug); $$;
create or replace function public.winter_claim_quest(p_slug text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.winter_claim_quest(p_slug); $$;

revoke all on function private.winter_claim_advent_day(date), private.winter_purchase_item(text), private.winter_equip_item(text), private.winter_claim_quest(text), private.winter_record_social_action() from public, anon;
grant execute on function private.winter_claim_advent_day(date), private.winter_purchase_item(text), private.winter_equip_item(text), private.winter_claim_quest(text), private.winter_record_social_action() to authenticated;
revoke all on function public.winter_claim_advent_day(date), public.winter_purchase_item(text), public.winter_equip_item(text), public.winter_claim_quest(text) from public, anon;
grant execute on function public.winter_claim_advent_day(date), public.winter_purchase_item(text), public.winter_equip_item(text), public.winter_claim_quest(text) to authenticated;

