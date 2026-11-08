-- Finalize the eight-track clicker at 320 total upgrade levels and make admin ledger reflect the actual applied balance delta.
create or replace function private.winter_clicker_state()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_stats public.winter_clicker_stats%rowtype; v_levels jsonb; v_total integer; v_power integer;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if private.winter_event_today()<date '2026-12-20' then raise exception 'event_not_started'; end if;
 insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
 select * into v_stats from public.winter_clicker_stats where user_id=v_user;
 select coalesce(sum(coalesce(l.level,0)),0)::integer,
        coalesce(sum(coalesce(l.level,0)*d.power_per_level),0)::integer,
        coalesce(jsonb_agg(jsonb_build_object('upgrade_key',d.upgrade_key,'title',d.title,'description',d.description,'icon',d.icon,'base_cost',d.base_cost,'power_per_level',d.power_per_level,'level',coalesce(l.level,0),'next_cost',case when coalesce(l.level,0)>=40 then null else ceil(d.base_cost*power(coalesce(l.level,0)+1,1.45))::integer end) order by d.base_cost),'[]'::jsonb)
 into v_total,v_power,v_levels
 from public.winter_clicker_upgrade_defs d left join public.winter_clicker_upgrade_levels l on l.upgrade_key=d.upgrade_key and l.user_id=v_user where d.active=true;
 if v_stats.level>=20 or v_total>=320 then insert into public.winter_inventory(user_id,item_slug) values(v_user,'snow-legend') on conflict(user_id,item_slug) do nothing; end if;
 return jsonb_build_object('level',v_total,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'click_power',1+v_power,'next_upgrade_cost',null,'upgrades',v_levels);
end $$;
create or replace function private.winter_clicker_click()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_stats public.winter_clicker_stats%rowtype; v_balance integer; v_reward integer; v_power integer; v_total integer; v_now timestamptz:=clock_timestamp();
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if private.winter_event_today()<date '2026-12-20' then raise exception 'event_not_started'; end if;
 insert into public.winter_wallets(user_id,balance) values(v_user,0) on conflict(user_id) do nothing;
 insert into public.winter_clicker_stats(user_id) values(v_user) on conflict(user_id) do nothing;
 select * into v_stats from public.winter_clicker_stats where user_id=v_user for update;
 if v_stats.last_click_at is not null and v_stats.last_click_at>v_now-interval '450 milliseconds' then raise exception 'click_too_fast'; end if;
 select coalesce(sum(l.level),0)::integer,1+coalesce(sum(l.level*d.power_per_level),0)::integer into v_total,v_power
 from public.winter_clicker_upgrade_defs d left join public.winter_clicker_upgrade_levels l on l.upgrade_key=d.upgrade_key and l.user_id=v_user where d.active=true;
 v_reward:=v_power;
 update public.winter_wallets set balance=balance+v_reward,updated_at=v_now where user_id=v_user returning balance into v_balance;
 update public.winter_clicker_stats set clicks_total=clicks_total+1,earned_total=earned_total+v_reward,last_click_at=v_now,updated_at=v_now where user_id=v_user returning * into v_stats;
 insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_user,v_reward,'clicker','click:'||v_stats.clicks_total::text);
 return jsonb_build_object('reward',v_reward,'balance',v_balance,'level',v_total,'clicks_total',v_stats.clicks_total,'earned_total',v_stats.earned_total,'click_power',v_power,'next_upgrade_cost',null);
end $$;
create or replace function private.site_admin_manage_winter_user(p_username text,p_coin_delta integer default 0,p_reset_clicker boolean default false)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_admin uuid:=private.site_admin_require(); v_target uuid; v_balance integer; v_before integer; v_actual integer;
begin
 select id into v_target from public.profiles where lower(username)=lower(trim(p_username)) limit 1;
 if v_target is null then raise exception 'user_not_found'; end if;
 if p_coin_delta < -1000000 or p_coin_delta > 1000000 then raise exception 'coin_delta_out_of_range'; end if;
 if p_coin_delta<>0 then
  insert into public.winter_wallets(user_id,balance) values(v_target,0) on conflict(user_id) do nothing;
  select balance into v_before from public.winter_wallets where user_id=v_target for update;
  update public.winter_wallets set balance=greatest(0,balance+p_coin_delta),updated_at=now() where user_id=v_target returning balance into v_balance;
  v_actual:=v_balance-v_before;
  if v_actual<>0 then insert into public.winter_coin_ledger(user_id,amount,reason,reference) values(v_target,v_actual,'admin_adjust','admin:'||gen_random_uuid()::text); end if;
 end if;
 if p_reset_clicker then
  insert into public.winter_clicker_stats(user_id) values(v_target) on conflict(user_id) do nothing;
  update public.winter_clicker_stats set level=1,clicks_total=0,earned_total=0,last_click_at=null,updated_at=now() where user_id=v_target;
  delete from public.winter_clicker_upgrade_levels where user_id=v_target;
 end if;
 insert into public.site_admin_audit_log(actor_id,action,target_type,target_id,details)
 values(v_admin,'manage_winter_user','user',v_target::text,jsonb_build_object('username',p_username,'coin_delta_requested',p_coin_delta,'coin_delta_applied',coalesce(v_actual,0),'reset_clicker',p_reset_clicker));
 select balance into v_balance from public.winter_wallets where user_id=v_target;
 return jsonb_build_object('user_id',v_target,'balance',coalesce(v_balance,0),'clicker_reset',p_reset_clicker,'coin_delta_applied',coalesce(v_actual,0));
end $$;