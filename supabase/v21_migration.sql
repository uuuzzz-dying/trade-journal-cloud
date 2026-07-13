-- 在 Supabase SQL Editor 运行一次
alter table public.stocks add column if not exists open_price numeric(18,4);
alter table public.stocks add column if not exists close_price numeric(18,4);
alter table public.stocks add column if not exists price_date date;
