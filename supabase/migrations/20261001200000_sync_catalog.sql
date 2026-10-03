begin;

-- Upserts one catalog table from a JSON array of rows and reports what changed. Only sync_catalog calls this; the
-- table, columns, types, and key are fixed literals there, never caller input.
create function private.sync_catalog_table(
  p_table text, p_rows jsonb, p_columns text[], p_types text[], p_key text[]
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  definition text;
  columns text;
  key text;
  updates text[];
  conflict text;
  bad boolean;
  total integer;
  inserted integer;
  updated integer;
  missing jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 10000 then
    raise exception 'The catalog snapshot needs between 1 and 10000 % rows', p_table;
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r.value) is distinct from 'object') then
    raise exception 'Every % row must be an object', p_table;
  end if;
  -- Unknown fields mean the snapshot mapping and this schema disagree; fail rather than drop data silently.
  if exists (select 1 from jsonb_array_elements(p_rows) r, jsonb_object_keys(r.value) k where k <> all (p_columns)) then
    raise exception 'A % row has a field this database does not sync', p_table;
  end if;

  select string_agg(format('%I %s', c, t), ', ' order by i), string_agg(format('%I', c), ', ' order by i)
  into definition, columns from unnest(p_columns, p_types) with ordinality as x(c, t, i);
  select string_agg(format('%I', c), ', ') into key from unnest(p_key) c;
  execute format('select count(*) <> count(distinct (%s)) from jsonb_to_recordset($1) as x(%s)', key, definition)
  into bad using p_rows;
  if bad then raise exception 'The catalog snapshot repeats a % key', p_table; end if;

  select array_agg(c order by i) into updates from unnest(p_columns) with ordinality as x(c, i) where c <> all (p_key);
  conflict := case when updates is null then 'do nothing' else format(
    'do update set %s where (%s) is distinct from (%s)',
    (select string_agg(format('%I = excluded.%I', c, c), ', ') from unnest(updates) c),
    (select string_agg(format('t.%I', c), ', ') from unnest(updates) c),
    (select string_agg(format('excluded.%I', c), ', ') from unnest(updates) c)) end;
  -- Unchanged rows are skipped by the conflict filter, so only real changes are written and counted.
  -- xmax = 0 marks a freshly inserted row in RETURNING.
  execute format(
    'with input as (select * from jsonb_to_recordset($1) as x(%1$s)),
       changed as (insert into public.%2$I as t (%3$s) select %3$s from input on conflict (%4$s) %5$s
         returning (t.xmax = 0) as inserted)
     select (select count(*) from input)::integer, (count(*) filter (where inserted))::integer,
       (count(*) filter (where not inserted))::integer from changed',
    definition, p_table, columns, key, conflict)
  into total, inserted, updated using p_rows;

  -- Rows the catalog no longer lists are reported, never deleted: results may still reference them.
  execute format(
    'select coalesce(jsonb_agg(concat_ws(''/'', %1$s) order by concat_ws(''/'', %1$s)), ''[]'') from public.%2$I t
     where not exists (select 1 from jsonb_to_recordset($1) as x(%3$s) where (%4$s) = (%5$s))',
    (select string_agg(format('t.%I', c), ', ') from unnest(p_key) c), p_table, definition,
    (select string_agg(format('x.%I', c), ', ') from unnest(p_key) c),
    (select string_agg(format('t.%I', c), ', ') from unnest(p_key) c))
  into missing using p_rows;

  return jsonb_build_object('inserted', inserted, 'updated', updated, 'unchanged', total - inserted - updated,
    'not_in_catalog', missing);
end;
$$;
revoke all on function private.sync_catalog_table(text, jsonb, text[], text[], text[]) from public, anon, authenticated;

-- Writes the merged catalog (frontend/src/catalog/index.ts) to the catalog tables in one transaction, so catalog
-- additions and metadata edits need no per-change migration. Called by .github/workflows/sync-catalog.yml with
-- trusted default-branch code only. Adds and updates; never deletes. Dry runs roll back and report the same counts.
create function public.sync_catalog(p_snapshot jsonb, p_source_sha text, p_dry_run boolean default true)
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
    raise exception 'The catalog snapshot must be an object of quants, models, model_quants, runtimes, and hardware';
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
      'model_quants', private.sync_catalog_table('model_quants', p_snapshot -> 'model_quants',
        array['model_id', 'quant_id'], array['text', 'text'], array['model_id', 'quant_id']),
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

commit;
