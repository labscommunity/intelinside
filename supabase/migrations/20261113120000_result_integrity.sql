begin;

-- Two integrity gaps from issue #130.
--
-- 1. Editing a result must reset its verification. runtime_flags, custom_runtime_id and revision became writable
--    after the reset trigger was written (20260918030922), so an update touching only those columns kept the old
--    confirmations. Changing the build or the flags changes what was measured, so they reset like every other field.
drop trigger if exists reset_result_verification_before_edit on public.results;
create trigger reset_result_verification_before_edit
before update of model_id, quant_id, runtime_id, runtime_version, rig_id, component_id, component_quantity,
  decode_tps, prompt_tps, ttft_ms, context_length, batch_size, notes, repo_url, run_date,
  runtime_flags, custom_runtime_id, revision
on public.results
for each row execute function private.touch_result_and_reset_verification();

-- 2. A result's custom build must be a build of the result's runtime. The HTTP API and PR ingestion already check
--    this, but the browser writes to the table directly and the plain foreign key only checks that the build exists.
--    A composite key enforces it for every writer. It also stops an owner from moving a build to another base
--    runtime while results still point at it, which would break the same rule from the other side.
--    MATCH SIMPLE (the default) skips the check when custom_runtime_id is null, so stock results are unaffected.
alter table public.custom_runtimes
  add constraint custom_runtimes_id_runtime_key unique (id, runtime_id);
alter table public.results
  add constraint results_custom_runtime_base_fkey
  foreign key (custom_runtime_id, runtime_id) references public.custom_runtimes (id, runtime_id)
  on update restrict on delete restrict;

commit;
