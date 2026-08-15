-- ===========================================================================
-- KK Financial Assistant — personal financial records, a PRIVATE per-user
-- ledger to track lecture fees, referred radiotherapy cases and hospital work.
--
-- Privacy: owner-only RLS. Each row is visible only to its owner — no other
-- user (not even a project admin using the anon/authenticated role) can read
-- another user's financial rows.
-- ===========================================================================

create table if not exists public.finance_entries (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null default 'other',   -- 'lecture' | 'referral' | 'hospital' | 'other'
  title       text not null default '',
  site        text default '',
  patient_ref text default '',
  fee         numeric not null default 0,
  currency    text not null default 'EGP',
  date        date not null default current_date,
  paid        boolean not null default false,
  notes       text default '',
  remind_at   timestamptz,                      -- optional follow-up reminder for an unpaid fee
  notified_at timestamptz,                      -- stamped once a reminder push has been sent
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists finance_user_idx on public.finance_entries (user_id);
create index if not exists finance_remind_idx
  on public.finance_entries (remind_at)
  where remind_at is not null and paid = false and notified_at is null;

alter table public.finance_entries enable row level security;

-- Owner-only: a user can see and change only their own rows.
drop policy if exists finance_owner on public.finance_entries;
create policy finance_owner on public.finance_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
