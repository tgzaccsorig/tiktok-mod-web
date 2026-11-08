-- Return the per-level snowman values needed for instant local UI updates.
create or replace function private.winter_auto_clicker_state()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_collect jsonb; v_snowmen jsonb; v_rate integer;
begin
 v_collect:=private.winter_auto_clicker_collect();
 select coalesce(sum(coalesce(l.level,0)*d.income_per_level),0)::integer,
 coalesce(jsonb_agg(jsonb_build_object(
   'snowman_key',d.snowman_key,'title',d.title,'description',d.description,'icon',d.icon,
   'base_cost',d.base_cost,'income_per_level',d.income_per_level,
   'level',coalesce(l.level,0),'max_level',d.max_level,
   'next_cost',case when coalesce(l.level,0)>=d.max_level then null
     else ceil(d.base_cost*power(coalesce(l.level,0)+1,1.6))::integer end,
   'income_per_minute',coalesce(l.level,0)*d.income_per_level
 ) order by d.base_cost),'[]'::jsonb)
 into v_rate,v_snowmen
 from public.winter_snowman_defs d left join public.winter_snowman_levels l
 on l.snowman_key=d.snowman_key and l.user_id=auth.uid() where d.active=true;
 return jsonb_build_object('snowmen',v_snowmen,'income_per_minute',v_rate,
   'collected',coalesce((v_collect->>'collected')::integer,0),
   'balance',coalesce((v_collect->>'balance')::integer,0));
end $$;
