begin;

-- Keep the Q4_K_L quant and Qwen3.8-27B board in sync with the frontend catalog.
insert into public.quants (id, label, bits, format) values
  ('q4_k_l', 'Q4_K_L', 4, 'GGUF')
on conflict (id) do update set label = excluded.label, bits = excluded.bits, format = excluded.format;

insert into public.model_quants (model_id, quant_id) values
  ('qwen3-8-27b', 'q4_k_l')
on conflict (model_id, quant_id) do nothing;

commit;
