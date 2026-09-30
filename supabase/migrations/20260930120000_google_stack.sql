-- Belinus Solar — custom stack (Google Solar API + PVGIS)
-- Additive only: the Aurora version keeps working unchanged in the same project.

-- Which engine produced a lead / quote ('aurora' = existing rows, 'google' = custom stack)
alter table public.leads  add column if not exists source text not null default 'aurora';
alter table public.quotes add column if not exists source text not null default 'aurora';

create table if not exists public.solar_designs (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  lead_id              uuid references public.leads(id) on delete set null,
  address              text,
  formatted_address    text,
  lat                  double precision,
  lng                  double precision,
  geocode_type         text,               -- ROOFTOP / RANGE_INTERPOLATED / ...
  annual_kwh           integer,
  monthly_consumption  jsonb,
  roof_status          text,               -- running / succeeded / failed
  layout_status        text,
  sim_status           text,
  last_error           text,
  insights             jsonb,              -- raw Google buildingInsights response
  imagery_date         date,
  imagery_quality      text,
  target_kwh           integer,
  layout               jsonb,              -- chosen panels, segments, polygons
  panel_count          integer,
  kwp                  numeric,
  production           jsonb,              -- PVGIS per segment × Google shading
  annual_production_kwh numeric
);
create index if not exists solar_designs_lead_idx on public.solar_designs(lead_id);
alter table public.solar_designs enable row level security;  -- service role only

alter table public.leads  add column if not exists solar_design_id uuid references public.solar_designs(id) on delete set null;
alter table public.quotes add column if not exists solar_design_id uuid references public.solar_designs(id) on delete set null;

-- Reserved for the upcoming Odoo connector: every web quote gets mirrored as a
-- real Odoo sale.order with Odoo's own numbering and product codes.
alter table public.quotes add column if not exists odoo_order_id     bigint;
alter table public.quotes add column if not exists odoo_quote_number text;
alter table public.quotes add column if not exists odoo_synced_at    timestamptz;

create index if not exists quotes_source_idx on public.quotes(source, created_at desc);
