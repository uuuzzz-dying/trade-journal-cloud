create table if not exists public.stock_master (
  ts_code text primary key,
  symbol text not null,
  name text not null,
  area text default '',
  industry text default '',
  market text default '',
  list_date date,
  updated_at timestamptz not null default now()
);

alter table public.stock_master enable row level security;

drop policy if exists "stock_master_read_authenticated" on public.stock_master;
create policy "stock_master_read_authenticated"
on public.stock_master
for select
to authenticated
using (true);

create index if not exists stock_master_symbol_idx on public.stock_master(symbol);
create index if not exists stock_master_name_idx on public.stock_master(name);
