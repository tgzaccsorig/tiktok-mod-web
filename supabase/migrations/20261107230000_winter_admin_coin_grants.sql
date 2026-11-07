create or replace function private.winter_admin_grant_coins(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_balance integer;
begin
  if v_user is null then
    raise exception 'authentication_required';
  end if;

  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'admin_required';
  end if;

  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'invalid_coin_amount';
  end if;

  insert into public.winter_wallets(user_id, balance)
  values (v_user, 0)
  on conflict (user_id) do nothing;

  update public.winter_wallets
  set balance = balance + p_amount, updated_at = now()
  where user_id = v_user
  returning balance into v_balance;

  insert into public.winter_coin_ledger(user_id, amount, reason, reference)
  values (v_user, p_amount, 'admin_grant', 'admin-grant:' || gen_random_uuid()::text);

  return jsonb_build_object('amount', p_amount, 'balance', v_balance);
end;
$$;

create or replace function public.winter_admin_grant_coins(p_amount integer)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.winter_admin_grant_coins(p_amount);
$$;

revoke all on function private.winter_admin_grant_coins(integer) from public, anon, authenticated;
grant execute on function private.winter_admin_grant_coins(integer) to authenticated;
revoke all on function public.winter_admin_grant_coins(integer) from public, anon;
grant execute on function public.winter_admin_grant_coins(integer) to authenticated;
