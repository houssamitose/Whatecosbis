-- =============================================================================
-- 004_crm_shared.sql — Multi-user shared tables for CRM
-- =============================================================================
-- Adds the tables needed so that multiple authenticated users see the same
-- products, tasks, and settings instead of each browser having its own
-- localStorage silo.
--
-- Tables created:
--   * user_profiles  — extends auth.users with display name + role
--   * crm_products   — Active / To Test / Inactive / Off products
--   * crm_tasks      — kanban tasks
--   * crm_settings   — workspace-wide settings (single row, id='global')
--
-- RLS strategy: any authenticated user can read everything; any authenticated
-- user can write (no role gating yet — keeps things simple while we ramp up).
-- Tighten later by checking user_profiles.role in policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. user_profiles
-- -----------------------------------------------------------------------------
create table if not exists public.user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  role         text not null default 'member' check (role in ('admin','member','viewer')),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_user_profiles_email on public.user_profiles(email);

-- Auto-create a profile when a new auth.users row appears
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. crm_products
-- -----------------------------------------------------------------------------
create table if not exists public.crm_products (
  id            text primary key,                  -- e.g. 'p1733567890123'
  status        text not null default 'active'
                check (status in ('active','test','inactive','off')),
  name          text not null,
  emoji         text default '📦',
  price         numeric default 0,
  unit_cost     numeric default 0,
  stock         integer default 0,
  category      text,
  color         text,
  tracking_code text,                                -- SpaceSeller SKU
  ss_available  boolean default false,
  landing_page  text,
  landing_pages jsonb default '[]'::jsonb,
  best_creatives jsonb default '[]'::jsonb,
  avatars       jsonb default '[]'::jsonb,
  metrics       jsonb default '{}'::jsonb,           -- {ordered, confirmed, delivered, returned}
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz                          -- soft delete
);
create index if not exists idx_crm_products_status   on public.crm_products(status) where deleted_at is null;
create index if not exists idx_crm_products_sku      on public.crm_products(tracking_code) where tracking_code is not null;
create index if not exists idx_crm_products_deleted  on public.crm_products(deleted_at);

-- -----------------------------------------------------------------------------
-- 3. crm_tasks
-- -----------------------------------------------------------------------------
create table if not exists public.crm_tasks (
  id          text primary key,
  title       text not null,
  description text,
  status      text not null default 'todo' check (status in ('todo','doing','done','blocked')),
  priority    text default 'normal' check (priority in ('low','normal','high','urgent')),
  due_date    date,
  assigned_to uuid references auth.users(id) on delete set null,
  product_id  text references public.crm_products(id) on delete set null,
  tags        text[],
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists idx_crm_tasks_status   on public.crm_tasks(status) where deleted_at is null;
create index if not exists idx_crm_tasks_assigned on public.crm_tasks(assigned_to);
create index if not exists idx_crm_tasks_due      on public.crm_tasks(due_date);

-- -----------------------------------------------------------------------------
-- 4. crm_settings (single global row)
-- -----------------------------------------------------------------------------
create table if not exists public.crm_settings (
  id                    text primary key default 'global',
  low_stock_threshold   integer default 40,
  theme                 text default 'dark',
  currency              text default 'MAD',
  spaceseller_token_id  text,
  business_name         text,
  business_logo         text,
  business_email        text,
  business_phone        text,
  extras                jsonb default '{}'::jsonb,
  updated_by            uuid references auth.users(id) on delete set null,
  updated_at            timestamptz not null default now()
);

-- seed global row
insert into public.crm_settings (id) values ('global') on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 5. updated_at triggers
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_user_profiles on public.user_profiles;
create trigger touch_user_profiles before update on public.user_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_crm_products on public.crm_products;
create trigger touch_crm_products before update on public.crm_products
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_crm_tasks on public.crm_tasks;
create trigger touch_crm_tasks before update on public.crm_tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_crm_settings on public.crm_settings;
create trigger touch_crm_settings before update on public.crm_settings
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.user_profiles enable row level security;
alter table public.crm_products  enable row level security;
alter table public.crm_tasks     enable row level security;
alter table public.crm_settings  enable row level security;

-- Read for any authenticated user
drop policy if exists "auth_read_profiles" on public.user_profiles;
create policy "auth_read_profiles" on public.user_profiles
  for select to authenticated using (true);

drop policy if exists "auth_read_products" on public.crm_products;
create policy "auth_read_products" on public.crm_products
  for select to authenticated using (true);

drop policy if exists "auth_read_tasks" on public.crm_tasks;
create policy "auth_read_tasks" on public.crm_tasks
  for select to authenticated using (true);

drop policy if exists "auth_read_settings" on public.crm_settings;
create policy "auth_read_settings" on public.crm_settings
  for select to authenticated using (true);

-- Write for any authenticated user (tighten later by role)
drop policy if exists "auth_write_products" on public.crm_products;
create policy "auth_write_products" on public.crm_products
  for all to authenticated using (true) with check (true);

drop policy if exists "auth_write_tasks" on public.crm_tasks;
create policy "auth_write_tasks" on public.crm_tasks
  for all to authenticated using (true) with check (true);

drop policy if exists "auth_write_settings" on public.crm_settings;
create policy "auth_write_settings" on public.crm_settings
  for all to authenticated using (true) with check (true);

-- Users can update their own profile
drop policy if exists "auth_update_own_profile" on public.user_profiles;
create policy "auth_update_own_profile" on public.user_profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- =============================================================================
-- Done. Run this in Supabase SQL editor (or via psql).
-- =============================================================================
