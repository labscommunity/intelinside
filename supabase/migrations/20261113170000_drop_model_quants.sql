begin;

-- Retire model_quants (issue #130, after 20261113150000_global_quants). Results no longer reference it, and nothing
-- reads it: the site, the submit form and the API take each model's suggested quants from the bundled catalog
-- (frontend/src/catalog/index.ts). The catalog sync was its only writer.
--
-- sync_catalog stops writing it first, so the table can go. A snapshot that still carries a model_quants key (a sync
-- run from code older than this change) is accepted and the key is ignored, so the merge and this migration can land
-- in either order without breaking a sync.
create or replace function public.sync_catalog(p_snapshot jsonb, p_source_sha text, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  answer jsonb := '{}'::jsonb;
  dangling text;
begin
  if p_source_sha is null or p_source_sha !~ '^[0-9a-f]{40}$' or p_dry_run is null then
    raise exception 'Invalid catalog provenance';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or exists (select 1 from jsonb_object_keys(p_snapshot) k
    where k not in ('quants', 'models', 'model_quants', 'runtimes', 'hardware')) then
    raise exception 'The catalog snapshot must be an object of quants, models, runtimes, and hardware';
  end if;
  -- One catalog writer at a time, including overlapping workflow runs and retries.
  perform pg_advisory_xact_lock(hashtextextended('catalog-sync', 0));
  begin
    answer := jsonb_build_object(
      'quants', private.sync_catalog_table('quants', p_snapshot -> 'quants',
        array['id', 'label', 'bits', 'format'], array['text', 'text', 'integer', 'text'], array['id']),
      'models', private.sync_catalog_table('models', p_snapshot -> 'models',
        array['id', 'name', 'family', 'params', 'architecture', 'active_params', 'source_url', 'logo_url', 'brand_color'],
        array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text'], array['id']));
    answer := answer || jsonb_build_object(
      'runtimes', private.sync_catalog_table('runtimes', p_snapshot -> 'runtimes',
        array['id', 'name', 'logo_url', 'repo_url', 'color'], array['text', 'text', 'text', 'text', 'text'], array['id']),
      'hardware', private.sync_catalog_table('hardware', p_snapshot -> 'hardware',
        array['id', 'type', 'vendor', 'name', 'series', 'specs', 'release_date', 'image_url', 'source', 'integrated'],
        array['text', 'text', 'text', 'text', 'text', 'jsonb', 'date', 'text', 'text', 'text[]'], array['id']));
    -- `integrated` has no foreign key; resolve it against the synced table.
    select h.id || ' -> ' || i into dangling from public.hardware h, unnest(h.integrated) i
    where not exists (select 1 from public.hardware p where p.id = i) limit 1;
    if dangling is not null then raise exception 'Integrated hardware does not exist: %', dangling; end if;
    if p_dry_run then raise exception using errcode = 'PT002', message = 'Rollback catalog dry run'; end if;
  exception when sqlstate 'PT002' then null;
  end;
  return jsonb_build_object('source_sha', p_source_sha, 'dry_run', p_dry_run, 'tables', answer);
end;
$$;
revoke all on function public.sync_catalog(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.sync_catalog(jsonb, text, boolean) to service_role;

drop table public.model_quants;

commit;
