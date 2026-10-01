-- Generated from the frontend catalog; scoped to Moonlight 16B-A3B and its Q4_K_M board.
begin;

insert into public.models (id, name, family, params, architecture, active_params, source_url, logo_url, brand_color) values
  ('moonlight-16b-a3b', 'Moonlight 16B-A3B', 'Moonlight', '16B', 'moe', '3B', 'https://huggingface.co/moonshotai/Moonlight-16B-A3B-Instruct', null, '#9fc3e8')
on conflict (id) do update set name = excluded.name, family = excluded.family, params = excluded.params, architecture = excluded.architecture, active_params = excluded.active_params, source_url = excluded.source_url, logo_url = excluded.logo_url, brand_color = excluded.brand_color;

insert into public.model_quants (model_id, quant_id) values
  ('moonlight-16b-a3b', 'q4_k_m')
on conflict (model_id, quant_id) do nothing;

commit;
