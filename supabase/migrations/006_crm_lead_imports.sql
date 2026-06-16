-- =============================================================================
-- 006_crm_lead_imports.sql — track leads imported from external sources
-- =============================================================================
-- Each row = one lead pulled from Google Sheets (or CSV / form) and sent to
-- SpaceSeller via POST /api/v1/orders. Used to dedupe + audit.
-- =============================================================================

create table if not exists public.crm_lead_imports (
  id              text primary key,                   -- hash of the source row
  source          text not null,                      -- 'gsheet','csv','form','fb'
  source_ref      text,                               -- row number / sheet URL / form id
  fullname        text not null,
  phone           text,
  address         text,
  city            text,
  product_ref     text,
  product_id      integer,
  qte             integer default 1,
  price           numeric,
  raw_payload     jsonb,                              -- original row as received
  spaceseller_order_id  bigint,                       -- assigned by SpaceSeller after POST
  spaceseller_response  jsonb,                        -- full response from SpaceSeller
  status          text not null default 'pending'
                  check (status in ('pending','sent','failed','duplicate','skipped')),
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_crm_lead_imports_status   on public.crm_lead_imports(status);
create index if not exists idx_crm_lead_imports_phone    on public.crm_lead_imports(phone);
create index if not exists idx_crm_lead_imports_ss_id    on public.crm_lead_imports(spaceseller_order_id);

drop trigger if exists touch_crm_lead_imports on public.crm_lead_imports;
create trigger touch_crm_lead_imports before update on public.crm_lead_imports
  for each row execute function public.touch_updated_at();

alter table public.crm_lead_imports enable row level security;

drop policy if exists "auth_read_imports" on public.crm_lead_imports;
create policy "auth_read_imports" on public.crm_lead_imports
  for select to authenticated using (true);

drop policy if exists "auth_write_imports" on public.crm_lead_imports;
create policy "auth_write_imports" on public.crm_lead_imports
  for all to authenticated using (true) with check (true);
