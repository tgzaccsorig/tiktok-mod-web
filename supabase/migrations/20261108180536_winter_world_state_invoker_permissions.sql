-- Keep the public world-state RPC invoker-safe while allowing its private,
-- narrowly scoped SECURITY DEFINER implementation to read the world state.
alter function public.winter_world_state() security invoker;
grant usage on schema private to anon, authenticated;
grant execute on function private.winter_world_state() to anon, authenticated;
