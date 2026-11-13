begin;

-- Step 2 of issue #130: any catalog quant is valid for any catalog model. model_quants stays as the suggested list
-- (the catalog sync still writes it and the submit form leads with it), but a result no longer has to match a row
-- in it. Each column now references its own catalog table. Every existing result already passed the stricter
-- pair key, so both new keys hold for current data.
alter table public.results drop constraint results_model_quant_fkey;
alter table public.results
  add constraint results_model_id_fkey foreign key (model_id) references public.models (id) on delete restrict,
  add constraint results_quant_id_fkey foreign key (quant_id) references public.quants (id) on delete restrict;

commit;
