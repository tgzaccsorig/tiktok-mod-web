-- Site-wide admin controls, moderation audit, and the Winter Fest level-20 trophy.
create table if not exists public.site_control_settings (
  id boolean primary key default true check (id),
  announcement text not null default '',
  announcement_active boolean not null default false,
  maintenance_mode boolean not null default false,
  maintenance_message text not null default 'Проводим небольшое обновление. Скоро вернёмся!',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.site_control_settings(id) values(true) on conflict(id) do nothing;
alter table public.site_control_settings enable row level security;
drop policy if exists "Public can read site controls" on public.site_control_settings;
create policy "Public can read site controls" on public.site_control_settings for select to anon, authenticated using (true);
revoke insert, update, delete on public.site_control_settings from anon, authenticated;

create table if not exists public.site_admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.site_admin_audit_log enable row level security;
revoke all on public.site_admin_audit_log from anon, authenticated;

create or replace function private.site_admin_require()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'admin_required' using errcode='42501';
  end if;
  return v_user;
end;
$$;

create or replace function public.site_admin_stats()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := private.site_admin_require();
begin
  return jsonb_build_object(
    'users',(select count(*) from public.profiles),
    'videos',(select count(*) from public.user_videos),
    'comments',(select count(*) from public.comments),
    'likes',(select count(*) from public.likes),
    'follows',(select count(*) from public.follows),
    'winter_wallets',(select count(*) from public.winter_wallets)
  );
end;
$$;

create or replace function public.site_admin_update_controls(
  p_announcement text,
  p_announcement_active boolean,
  p_maintenance_mode boolean,
  p_maintenance_message text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := private.site_admin_require();
begin
  if char_length(coalesce(p_announcement,'')) > 240 then raise exception 'announcement_too_long'; end if;
  if char_length(coalesce(p_maintenance_message,'')) > 240 then raise exception 'message_too_long'; end if;
  update public.site_control_settings set
    announcement=coalesce(p_announcement,''),
    announcement_active=coalesce(p_announcement_active,false),
    maintenance_mode=coalesce(p_maintenance_mode,false),
    maintenance_message=coalesce(p_maintenance_message,''),
    updated_by=v_user, updated_at=now()
  where id=true;
  insert into public.site_admin_audit_log(actor_id,action,target_type,target_id,details)
  values(v_user,'update_site_controls','site','global',jsonb_build_object('announcement_active',p_announcement_active,'maintenance_mode',p_maintenance_mode));
  return (select to_jsonb(s) from public.site_control_settings s where id=true);
end;
$$;

create or replace function public.site_admin_delete_comment(p_comment_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := private.site_admin_require(); v_content text;
begin
  select left(content,120) into v_content from public.comments where id=p_comment_id;
  if not found then return false; end if;
  insert into public.site_admin_audit_log(actor_id,action,target_type,target_id,details)
  values(v_user,'delete_comment','comment',p_comment_id::text,jsonb_build_object('preview',v_content));
  delete from public.comments where id=p_comment_id;
  return true;
end;
$$;

create or replace function public.site_admin_delete_user_video(p_video_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := private.site_admin_require(); v_title text; v_owner uuid;
begin
  select title,user_id into v_title,v_owner from public.user_videos where id=p_video_id;
  if not found then return false; end if;
  insert into public.site_admin_audit_log(actor_id,action,target_type,target_id,details)
  values(v_user,'delete_user_video','video',p_video_id::text,jsonb_build_object('title',left(coalesce(v_title,''),120),'owner_id',v_owner));
  delete from public.user_videos where id=p_video_id;
  return true;
end;
$$;

create or replace function public.site_admin_audit()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := private.site_admin_require();
begin
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (select id,action,target_type,target_id,details,created_at from public.site_admin_audit_log order by created_at desc limit 40) a),'[]'::jsonb);
end;
$$;

insert into public.winter_shop_items(slug,name,description,icon,rarity,slot,price,active)
values('snow-legend','Легенда снежного клика','Эксклюзивный трофей за полную прокачку кликера до 20 уровня.','🏆','legendary','badge',0,true)
on conflict (slug) do update set name=excluded.name,description=excluded.description,icon=excluded.icon,rarity=excluded.rarity,slot=excluded.slot,price=0,active=true;

create or replace function private.winter_clicker_upgrade()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid(); v_stats public.winter_clicker_stats%rowtype;
  v_cost integer; v_balance integer; v_trophy boolean := false;
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
  if v_stats.level = 20 then
    insert into public.winter_inventory(user_id,item_slug) values(v_user,'snow-legend') on conflict(user_id,item_slug) do nothing;
    v_trophy := true;
  end if;
  return jsonb_build_object('level',v_stats.level,'balance',v_balance,'click_power',v_stats.level,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'next_upgrade_cost',case when v_stats.level >= 20 then null else 100 * v_stats.level * v_stats.level end,'trophy_unlocked',v_trophy);
end;
$$;

revoke all on function private.site_admin_require() from public, anon, authenticated;
grant execute on function private.site_admin_require() to authenticated;
revoke all on function public.site_admin_stats() from public, anon;
revoke all on function public.site_admin_update_controls(text,boolean,boolean,text) from public, anon;
revoke all on function public.site_admin_delete_comment(uuid) from public, anon;
revoke all on function public.site_admin_delete_user_video(uuid) from public, anon;
revoke all on function public.site_admin_audit() from public, anon;
grant execute on function public.site_admin_stats() to authenticated;
grant execute on function public.site_admin_update_controls(text,boolean,boolean,text) to authenticated;
grant execute on function public.site_admin_delete_comment(uuid) to authenticated;
grant execute on function public.site_admin_delete_user_video(uuid) to authenticated;
grant execute on function public.site_admin_audit() to authenticated;

-- Award the level-20 trophy on state reads as a recovery path and make the
-- upgrade ledger reference idempotent if a previous request was retried.
create or replace function private.winter_clicker_state()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_stats public.winter_clicker_stats%rowtype; v_today date := private.winter_event_today();
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if v_today < date '2026-12-20' then raise exception 'event_not_started'; end if;
  insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_stats from public.winter_clicker_stats where user_id=v_user;
  if v_stats.level >= 20 then
    insert into public.winter_inventory(user_id,item_slug) values(v_user,'snow-legend') on conflict(user_id,item_slug) do nothing;
  end if;
  return jsonb_build_object('level',v_stats.level,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'click_power',v_stats.level,'next_upgrade_cost',case when v_stats.level >= 20 then null else 100 * v_stats.level * v_stats.level end,'trophy_unlocked',v_stats.level >= 20);
end;
$$;

create or replace function private.winter_clicker_upgrade()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid(); v_stats public.winter_clicker_stats%rowtype;
  v_cost integer; v_balance integer; v_trophy boolean := false;
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
  insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,-v_cost,'clicker_upgrade','clicker-level:'||v_stats.level::text) on conflict(user_id,reference) do nothing;
  if v_stats.level = 20 then
    insert into public.winter_inventory(user_id,item_slug) values(v_user,'snow-legend') on conflict(user_id,item_slug) do nothing;
    v_trophy := true;
  end if;
  return jsonb_build_object('level',v_stats.level,'balance',v_balance,'click_power',v_stats.level,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'next_upgrade_cost',case when v_stats.level >= 20 then null else 100 * v_stats.level * v_stats.level end,'trophy_unlocked',v_trophy);
end;
$$;
