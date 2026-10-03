begin;

-- Keep the Muse Glimmer 30B INT4 board in sync with the frontend catalog.
insert into public.model_quants (model_id, quant_id) values
  ('muse-glimmer-30b', 'int4')
on conflict (model_id, quant_id) do nothing;

commit;
