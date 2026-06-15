-- =============================================================================
-- 005_crm_team_members.sql — shared team list across browsers
-- =============================================================================
-- Stores the list of team members (agent confirmation, livraison, comptable…)
-- so they're visible from any browser/account. Optionally linked to a real
-- Supabase Auth user via auth_user_id.
--
-- NOTE: this is separate from auth.users + public.user_profiles. A team member
-- can exist here without a Supabase Auth login (e.g. an offline employee
-- whose tasks you still want to delegate).
-- =============================================================================

create table if not exists public.crm_team_members (
  id            text primary key,                          -- e.g. 'tm_1733567890'
  name          text not null,
  email         text,
  role          text default 'member'
                check (role in ('admin','member','viewer','agent_confirm','agent_delivery','accountant')),
  auth_user_id  uuid references auth.users(id) on delete set null,
  avatar_url    text,
  phone         text,
  active        boolean default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists idx_crm_team_members_email   on public.crm_team_members(email);
create index if not exists idx_crm_team_members_auth    on public.crm_team_members(auth_user_id);
create index if not exists idx_crm_team_members_active  on public.crm_team_members(active) where deleted_at is null;

drop trigger if exists touch_crm_team_members on public.crm_team_members;
create trigger touch_crm_team_members before update on public.crm_team_members
  for each row execute function public.touch_updated_at();

alter table public.crm_team_members enable row level security;

drop policy if exists "auth_read_team" on public.crm_team_members;
create policy "auth_read_team" on public.crm_team_members
  for select to authenticated using (true);

drop policy if exists "auth_write_team" on public.crm_team_members;
create policy "auth_write_team" on public.crm_team_members
  for all to authenticated using (true) with check (true);
