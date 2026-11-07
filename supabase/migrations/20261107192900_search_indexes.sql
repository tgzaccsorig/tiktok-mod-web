create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);
create index if not exists user_videos_title_trgm_idx on public.user_videos using gin (title gin_trgm_ops);
create index if not exists user_videos_author_trgm_idx on public.user_videos using gin (author gin_trgm_ops);
create index if not exists user_videos_categories_gin_idx on public.user_videos using gin (categories);
create index if not exists user_videos_created_idx on public.user_videos (created_at desc);
