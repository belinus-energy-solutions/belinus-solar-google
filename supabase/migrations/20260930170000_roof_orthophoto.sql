-- Store the Solar API aerial image (true orthophoto) per design for the roof viewer.
alter table public.solar_designs add column if not exists roof_image jsonb;  -- {epsg, bbox, width, height, path, imagery_date, quality}
insert into storage.buckets (id, name, public) values ('roof-images', 'roof-images', false) on conflict (id) do nothing;
