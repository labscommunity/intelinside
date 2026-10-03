-- Generated from the frontend catalog; scoped to Bonsai models and their quantizations.
begin;

insert into public.quants (id, label, bits, format) values
  ('u1', 'U1', 1, 'OpenVINO INTBIT g128 1-bit, needs the custom Intel GPU plugin'),
  ('ptq1_0', 'PTQ1_0', 2, 'GGUF ternary (PrismML PTQ1_0, 1.75 bits/weight), fork-only packing')
on conflict (id) do update set label = excluded.label, bits = excluded.bits, format = excluded.format;

insert into public.models (id, name, family, params, architecture, active_params, source_url, logo_url, brand_color) values
  ('bonsai-2-27b', 'Bonsai 2 27B', 'Bonsai 2', '27B', 'dense', null, 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf', null, '#4e9e5c'),
  ('bonsai-27b', 'Bonsai 27B', 'Bonsai', '27B', 'dense', null, 'https://huggingface.co/prism-ml/Bonsai-27B-gguf', null, '#4e9e5c')
on conflict (id) do update set name = excluded.name, family = excluded.family, params = excluded.params, architecture = excluded.architecture, active_params = excluded.active_params, source_url = excluded.source_url, logo_url = excluded.logo_url, brand_color = excluded.brand_color;

insert into public.model_quants (model_id, quant_id) values
  ('bonsai-2-27b', 'ptq1_0'),
  ('bonsai-27b', 'u1')
on conflict (model_id, quant_id) do nothing;

commit;
