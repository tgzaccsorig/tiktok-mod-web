-- User avatars and a safe way to unequip owned Winter Fest cosmetics.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = true,
  file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Avatar uploads are scoped to user folders" on storage.objects;
create policy "Avatar uploads are scoped to user folders"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create or replace function private.winter_unequip_item(p_slot text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if p_slot not in ('frame','background','badge','title') then raise exception 'invalid_slot'; end if;
  if private.winter_event_today() < date '2026-12-20' then raise exception 'event_not_started'; end if;
  delete from public.winter_equipped_items where user_id = v_user and slot = p_slot;
  return jsonb_build_object('slot', p_slot, 'equipped', false);
end;
$$;

create or replace function public.winter_unequip_item(p_slot text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.winter_unequip_item(p_slot); $$;

revoke all on function private.winter_unequip_item(text) from public, anon, authenticated;
grant execute on function private.winter_unequip_item(text) to authenticated;
revoke all on function public.winter_unequip_item(text) from public, anon;
grant execute on function public.winter_unequip_item(text) to authenticated;
