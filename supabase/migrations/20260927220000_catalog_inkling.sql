-- Inkling rows selected from npm run catalog:seed output.
begin;

insert into public.models (id, name, family, params, architecture, active_params, source_url, logo_url, brand_color) values
  ('inkling', 'Inkling', 'Inkling', '975B', 'moe', '41B', 'https://huggingface.co/thinkingmachines/Inkling', null, '#e89960')
on conflict (id) do update set name = excluded.name, family = excluded.family, params = excluded.params, architecture = excluded.architecture, active_params = excluded.active_params, source_url = excluded.source_url, logo_url = excluded.logo_url, brand_color = excluded.brand_color;

insert into public.model_quants (model_id, quant_id) values
  ('inkling', 'int4')
on conflict (model_id, quant_id) do nothing;

commit;
