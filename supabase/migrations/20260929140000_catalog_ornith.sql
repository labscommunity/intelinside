begin;

-- Keep PR #62's Ornith models and INT4 boards in sync with the frontend catalog.
insert into public.models (id, name, family, params, architecture, active_params, source_url, logo_url, brand_color) values
  ('ornith-1-5-35b-a3b', 'Ornith 1.5 35B A3B', 'Ornith 1.5', '35B', 'moe', '3B', 'https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B', '/logos/models/ornith.webp', '#7fb5d9'),
  ('ornith-1-5-9b', 'Ornith 1.5 9B', 'Ornith 1.5', '9B', 'dense', null, 'https://huggingface.co/ornith-ai/Ornith-1.5-9B', '/logos/models/ornith.webp', '#7fb5d9')
on conflict (id) do update set name = excluded.name, family = excluded.family, params = excluded.params, architecture = excluded.architecture, active_params = excluded.active_params, source_url = excluded.source_url, logo_url = excluded.logo_url, brand_color = excluded.brand_color;

insert into public.model_quants (model_id, quant_id) values
  ('ornith-1-5-35b-a3b', 'int4'),
  ('ornith-1-5-9b', 'int4')
on conflict (model_id, quant_id) do nothing;

commit;
