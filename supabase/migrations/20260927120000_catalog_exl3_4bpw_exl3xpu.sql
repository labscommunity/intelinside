begin;

-- Keep the EXL3 4bpw quant, EXL3 XPU runtime and the Qwen3.8-27B board in sync
-- with the frontend catalog.
insert into public.runtimes (id, name, logo_url, repo_url, color) values
  ('exl3xpu', 'EXL3 XPU', '', 'https://github.com/0xSero/exl3xpu', '#e8875a')
on conflict (id) do update set name = excluded.name, repo_url = excluded.repo_url, color = excluded.color;

insert into public.quants (id, label, bits, format) values
  ('exl3-4bpw', 'EXL3 4bpw', 4, 'EXL3 trellis quantization (ExLlamaV3), ~4 bits per weight')
on conflict (id) do update set label = excluded.label, bits = excluded.bits, format = excluded.format;

insert into public.model_quants (model_id, quant_id) values
  ('qwen3-8-27b', 'exl3-4bpw')
on conflict (model_id, quant_id) do nothing;

commit;
