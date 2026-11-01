-- belinus.com website forms (quote, contact, partner, service, referrer).
-- Written by the container with the service role; no public access.
create table if not exists public.web_submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null,            -- quote | contact | partner | service | referrer
  lang        text,
  page        text,
  email       text,
  payload     jsonb not null default '{}'::jsonb,
  handled     boolean not null default false
);
create index if not exists web_submissions_kind_created on public.web_submissions (kind, created_at desc);
alter table public.web_submissions enable row level security;  -- no policies: service role only
