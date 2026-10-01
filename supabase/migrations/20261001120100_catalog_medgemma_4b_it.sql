-- Generated from the frontend catalog; scoped to MedGemma 4B IT and its Q4_K_M board.
begin;

insert into public.models (id, name, family, params, architecture, active_params, source_url, logo_url, brand_color) values
  ('medgemma-4b-it', 'MedGemma 4B IT', 'MedGemma', '4B', 'dense', null, 'https://huggingface.co/google/medgemma-4b-it', null, '#4fc3a1')
on conflict (id) do update set name = excluded.name, family = excluded.family, params = excluded.params, architecture = excluded.architecture, active_params = excluded.active_params, source_url = excluded.source_url, logo_url = excluded.logo_url, brand_color = excluded.brand_color;

insert into public.model_quants (model_id, quant_id) values
  ('medgemma-4b-it', 'q4_k_m')
on conflict (model_id, quant_id) do nothing;

commit;
