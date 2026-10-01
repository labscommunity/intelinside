-- Generated from the frontend catalog; scoped to Qwen3-1.7B and its INT4 board.
begin;

insert into public.models (id, name, family, params, architecture, active_params, source_url, logo_url, brand_color) values
  ('qwen3-1-7b', 'Qwen3-1.7B', 'Qwen3', '1.7B', 'dense', null, 'https://huggingface.co/Qwen/Qwen3-1.7B', '/logos/models/qwen.svg', '#b699eb')
on conflict (id) do update set name = excluded.name, family = excluded.family, params = excluded.params, architecture = excluded.architecture, active_params = excluded.active_params, source_url = excluded.source_url, logo_url = excluded.logo_url, brand_color = excluded.brand_color;

insert into public.model_quants (model_id, quant_id) values
  ('qwen3-1-7b', 'int4')
on conflict (model_id, quant_id) do nothing;

commit;
