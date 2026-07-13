-- 你已经执行过旧版 SQL 时，可以先尝试直接运行本文件。
-- 它使用 IF NOT EXISTS，重复执行不会重复创建表。

create extension if not exists pgcrypto;

create table if not exists public.stocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  custom_sector text default '',
  industry text default '',
  market text default '',
  list_date date,
  current_price numeric(18,4) default 0,
  created_at timestamptz not null default now(),
  unique(user_id, code)
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stock_id uuid not null references public.stocks(id) on delete cascade,
  open_quantity numeric(18,4) not null default 0,
  status text not null default 'open' check(status in ('open','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  stock_id uuid not null references public.stocks(id) on delete cascade,
  trade_type text not null check(trade_type in ('buy','sell')),
  trade_date date not null,
  trade_time time not null,
  price numeric(18,4) not null check(price > 0),
  quantity numeric(18,4) not null check(quantity > 0),
  fee numeric(18,4) not null default 0,
  reason text not null,
  lesson text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stock_id uuid references public.stocks(id) on delete set null,
  note_date date not null,
  note_type text not null default '每日心得',
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.stocks enable row level security;
alter table public.positions enable row level security;
alter table public.trades enable row level security;
alter table public.notes enable row level security;

drop policy if exists "stocks_owner_all" on public.stocks;
create policy "stocks_owner_all" on public.stocks for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "positions_owner_all" on public.positions;
create policy "positions_owner_all" on public.positions for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "trades_owner_all" on public.trades;
create policy "trades_owner_all" on public.trades for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notes_owner_all" on public.notes;
create policy "notes_owner_all" on public.notes for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists stocks_user_idx on public.stocks(user_id);
create index if not exists positions_user_idx on public.positions(user_id);
create index if not exists trades_user_date_idx on public.trades(user_id, trade_date desc);
create index if not exists notes_user_date_idx on public.notes(user_id, note_date desc);
