-- ===========================================================================
-- KK Financial Assistant — Vendor / Hospital list (Settings page).
--
-- A small per-user lookup table backing the vendor dropdown in the record
-- form and the vendor filter on the main screen. Same privacy model as
-- finance_entries: owner-only RLS.
--
-- Optional but recommended when sync is enabled — without it, the vendor
-- list still works but stays device-local.
-- ===========================================================================

create table if not exists public.finance_vendors (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz default now()
);

create index if not exists finance_vendors_user_idx on public.finance_vendors (user_id);

alter table public.finance_vendors enable row level security;

-- Owner-only: a user can see and change only their own rows.
drop policy if exists finance_vendors_owner on public.finance_vendors;
create policy finance_vendors_owner on public.finance_vendors
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
