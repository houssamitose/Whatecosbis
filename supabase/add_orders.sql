create table if not exists public.ss_orders (
    order_id bigint primary key,
    uuid text,
    fullname text,
    phone text,
    second_phone text,
    address text,
    city text,
    id_city integer,
    note text,
    total_price numeric default 0,
    tracking_number text,
    order_status_code text,
    order_status_label text,
    delivery_status_code text,
    delivery_status_label text,
    date_order timestamptz,
    date_confirmation timestamptz,
    date_delivery timestamptz,
    products jsonb default '[]'::jsonb,
    order_status_history jsonb default '[]'::jsonb,
    delivery_status_history jsonb default '[]'::jsonb,
    raw_payload jsonb,
    synced_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
create index if not exists ss_orders_status_idx on public.ss_orders (order_status_code);
create index if not exists ss_orders_delivery_idx on public.ss_orders (delivery_status_code);
create index if not exists ss_orders_date_order_idx on public.ss_orders (date_order desc);
create index if not exists ss_orders_phone_idx on public.ss_orders (phone);
create table if not exists public.ss_tracked_ids (
    order_id bigint primary key,
    added_at timestamptz not null default now()
  );
alter table public.ss_orders enable row level security;
alter table public.ss_tracked_ids enable row level security;
drop policy if exists ss_orders_select on public.ss_orders;
create policy ss_orders_select on public.ss_orders for select using (auth.uid() is not null);
drop policy if exists ss_orders_modify on public.ss_orders;
create policy ss_orders_modify on public.ss_orders for all using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists ss_tracked_ids_select on public.ss_tracked_ids;
create policy ss_tracked_ids_select on public.ss_tracked_ids for select using (auth.uid() is not null);
drop policy if exists ss_tracked_ids_modify on public.ss_tracked_ids;
create policy ss_tracked_ids_modify on public.ss_tracked_ids for all using (auth.uid() is not null) with check (auth.uid() is not null);
