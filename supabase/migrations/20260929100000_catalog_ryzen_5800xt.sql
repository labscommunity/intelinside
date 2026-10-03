begin;

-- Keep the Ryzen 7 5800XT rig component in sync with the frontend catalog.
insert into public.hardware (id, type, vendor, name, series, specs, release_date, image_url, source, integrated) values
  ('amd-ryzen-7-5800xt', 'cpu', 'AMD', 'Ryzen 7 5800XT', 'Ryzen 5000', '{"cores":8,"threads":16,"boostGhz":4.8,"tdpW":105,"platform":"Zen 3"}'::jsonb, '2024-07-31'::date, null, 'seeded', '{}'::text[])
on conflict (id) do update set type = excluded.type, vendor = excluded.vendor, name = excluded.name, series = excluded.series, specs = excluded.specs, release_date = excluded.release_date, image_url = excluded.image_url, source = excluded.source, integrated = excluded.integrated;

commit;
