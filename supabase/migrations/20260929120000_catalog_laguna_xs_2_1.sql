-- Generated from the frontend catalog; scoped to Laguna XS 2.1 and its Q4_K_M board.
begin;

insert into public.models (id, name, family, params, architecture, active_params, source_url, logo_url, brand_color) values
  ('laguna-xs-2-1', 'Laguna XS 2.1', 'Laguna XS', '33B', 'moe', '3B', 'https://huggingface.co/poolside/Laguna-XS-2.1', '/logos/models/poolside.png', '#7fd4a8')
on conflict (id) do update set name = excluded.name, family = excluded.family, params = excluded.params, architecture = excluded.architecture, active_params = excluded.active_params, source_url = excluded.source_url, logo_url = excluded.logo_url, brand_color = excluded.brand_color;

insert into public.model_quants (model_id, quant_id) values
  ('laguna-xs-2-1', 'q4_k_m')
on conflict (model_id, quant_id) do nothing;

commit;
