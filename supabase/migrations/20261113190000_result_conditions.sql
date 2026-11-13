begin;

-- Step 3 of issue #130: record the conditions behind a result, so results measured differently can be told apart.
-- Every field is optional; existing results keep null ("conditions not recorded"). context_length and batch_size stay
-- as they are: their meaning was ambiguous, so nothing is converted into the new fields.
alter table public.results
  add column input_tokens integer,     -- prompt tokens actually sent, after the chat template
  add column output_tokens integer,    -- tokens actually generated
  add column concurrency integer,      -- simultaneous requests
  add column decode_scope text,        -- with concurrency > 1: decode_tps is per request or total throughput
  add column decode_method text,       -- how decode was timed
  add column repeats integer,          -- measured runs behind the number
  add column prompt_cache boolean,     -- a cached prompt was reused
  add column thinking boolean,         -- reasoning mode on
  add column speculative text,         -- speculative decoding: none, lossless (output unchanged) or lossy
  add constraint results_input_tokens_positive check (input_tokens is null or input_tokens > 0),
  add constraint results_output_tokens_positive check (output_tokens is null or output_tokens > 0),
  add constraint results_concurrency_positive check (concurrency is null or concurrency > 0),
  add constraint results_repeats_positive check (repeats is null or repeats > 0),
  add constraint results_decode_scope_valid check (decode_scope is null or decode_scope in ('per_request', 'total')),
  add constraint results_decode_method_valid check (decode_method is null or decode_method in ('streamed', 'engine', 'llama_bench', 'wall')),
  add constraint results_speculative_valid check (speculative is null or speculative in ('none', 'lossless', 'lossy')),
  -- Per request vs total only means something when several requests ran at once.
  add constraint results_decode_scope_needs_concurrency check (decode_scope is null or coalesce(concurrency, 0) > 1);

-- The exact engine commit matters for stock builds too: engines change week to week.
alter table public.results drop constraint results_revision_needs_build;

grant insert (input_tokens, output_tokens, concurrency, decode_scope, decode_method, repeats, prompt_cache, thinking, speculative),
      update (input_tokens, output_tokens, concurrency, decode_scope, decode_method, repeats, prompt_cache, thinking, speculative)
on public.results to authenticated;

-- Changing a condition changes what was measured, so it resets verification like every other measured field.
drop trigger reset_result_verification_before_edit on public.results;
create trigger reset_result_verification_before_edit
before update of model_id, quant_id, runtime_id, runtime_version, rig_id, component_id, component_quantity,
  decode_tps, prompt_tps, ttft_ms, context_length, batch_size, notes, repo_url, run_date,
  runtime_flags, custom_runtime_id, revision,
  input_tokens, output_tokens, concurrency, decode_scope, decode_method, repeats, prompt_cache, thinking, speculative
on public.results
for each row execute function private.touch_result_and_reset_verification();

-- PR ingestion writes the new fields. Otherwise identical to 20260930120000.
create or replace function public.ingest_pr_results(
  p_repository text, p_pr_number bigint, p_github_id text,
  p_files jsonb, p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  owner_uuid uuid;
  item jsonb;
  f jsonb;
  receipt private.pr_result_imports%rowtype;
  registration private.pr_custom_runtime_imports%rowtype;
  candidates text;
  rig bigint;
  build bigint;
  matches integer;
  result_id bigint;
  answer jsonb := '[]'::jsonb;
  source_pr text;
begin
  if p_repository is distinct from 'labscommunity/intelinside'
    or p_pr_number is null or p_pr_number <= 0
    or p_github_id is null or p_github_id !~ '^[0-9]+$'
    or p_dry_run is null then
    raise exception 'Invalid PR provenance';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 100 then
    raise exception 'Submit between 1 and 100 submission files';
  end if;

  select p.id into owner_uuid
  from auth.identities i join public.profiles p on p.auth_user_id = i.user_id
  where i.provider = 'github' and i.provider_id = p_github_id;
  if owner_uuid is null then
    raise exception 'No site account is linked to the PR author. Sign up on the site with the same GitHub account, then rerun this check.';
  end if;
  source_pr := 'https://github.com/' || p_repository || '/pull/' || p_pr_number;
  -- Serialize imports of a repository, including simultaneous retries of the same PR.
  perform pg_advisory_xact_lock(hashtextextended('pr-results:' || p_repository, 0));
  -- Also serialize against UI/API writes while checking existing sources.
  if exists (select 1 from jsonb_array_elements(p_files) where value ->> 'path' like 'custom-runtimes/%') then
    lock table public.custom_runtimes in share row exclusive mode;
  end if;
  if (select count(distinct value ->> 'path') from jsonb_array_elements(p_files)) <> jsonb_array_length(p_files) then
    raise exception 'Duplicate or missing submission paths';
  end if;
  begin
    for item in select value from jsonb_array_elements(p_files) where value ->> 'path' like 'custom-runtimes/%' loop
      f := item -> 'file';
      if item ->> 'path' !~ '^custom-runtimes/[a-zA-Z0-9-]+/[a-zA-Z0-9][a-zA-Z0-9._-]*[.]json$'
        or jsonb_typeof(f) is distinct from 'object' then raise exception 'Invalid registration file'; end if;
      if exists (select 1 from jsonb_object_keys(f) k where k not in ('runtime','name','repoUrl','summary','notes')) then
        raise exception 'Unknown registration field';
      end if;
      if exists (select 1 from unnest(array['runtime','name','repoUrl','summary']) k
        where jsonb_typeof(f -> k) is distinct from 'string' or length(btrim(f ->> k)) = 0 or f ->> k <> btrim(f ->> k))
        or (f ? 'notes' and (jsonb_typeof(f -> 'notes') is distinct from 'string' or length(btrim(f ->> 'notes')) = 0))
        or f ->> 'repoUrl' !~* '^https?://[^[:space:]/?#@\\]+([/?#][^[:space:]\\]*)?$' then
        raise exception 'Registration fields must be trimmed nonempty text and repoUrl a full HTTP(S) URL without credentials';
      end if;
      select * into registration from private.pr_custom_runtime_imports
        where repository = p_repository and path = item ->> 'path';
      if found then
        if registration.pr_number <> p_pr_number or registration.github_id <> p_github_id or registration.payload <> f then
          raise exception 'Registration file % was already imported. Reuse its ID or edit the live registration on the site.', item ->> 'path';
        end if;
        answer := answer || jsonb_build_array(jsonb_build_object('path', item ->> 'path', 'status', 'already_imported', 'id', registration.runtime_id::text));
        continue;
      end if;
      select string_agg(id::text, ', ' order by id) into candidates from public.custom_runtimes
        where runtime_id = f ->> 'runtime' and private.pr_runtime_source(repo_url) = private.pr_runtime_source(f ->> 'repoUrl');
      if candidates is not null then
        raise exception 'File %: source/base runtime already registered as IDs %. Reuse an ID or ask a maintainer to resolve the duplicate.', item ->> 'path', candidates;
      end if;
      insert into public.custom_runtimes(owner_id,runtime_id,name,repo_url,summary,notes,source_pr_url)
        values (owner_uuid,f ->> 'runtime',f ->> 'name',f ->> 'repoUrl',f ->> 'summary',f ->> 'notes',source_pr)
        returning id into build;
      insert into private.pr_custom_runtime_imports(repository,path,pr_number,github_id,payload,runtime_id)
        values (p_repository,item ->> 'path',p_pr_number,p_github_id,f,build);
      answer := answer || jsonb_build_array(jsonb_build_object('path',item ->> 'path',
        'status',case when p_dry_run then 'validated' else 'imported' end,
        'id',case when p_dry_run then null else build::text end));
    end loop;
    for item in select value from jsonb_array_elements(p_files) where value ->> 'path' not like 'custom-runtimes/%' loop
      f := item -> 'file';
      if (item ->> 'path') is null or (item ->> 'path') !~ '^results/[^/]+/[^/]+[.]json$'
        or jsonb_typeof(f) is distinct from 'object' then
        raise exception 'Invalid result file';
      end if;
      -- Exports of already-live results are archives, never an instruction to insert/update.
      if nullif(f ->> 'result', '') is not null then
        answer := answer || jsonb_build_array(jsonb_build_object('path', item ->> 'path', 'status', 'archive'));
        continue;
      end if;
      select * into receipt from private.pr_result_imports
      where repository = p_repository and path = item ->> 'path';
      if found then
        if receipt.pr_number <> p_pr_number or receipt.github_id <> p_github_id or receipt.payload <> f then
          raise exception 'File % was already imported. Edit the live result on the site; use a new filename for a new run.', item ->> 'path';
        end if;
        answer := answer || jsonb_build_array(jsonb_build_object('path', item ->> 'path', 'status', 'already_imported', 'id', receipt.result_id::text));
        continue;
      end if;

      select count(*), min(id) into matches, rig from public.rigs
      where owner_id = owner_uuid and
        (case when f ->> 'rig' ~ '^[0-9]+$' then id::text = f ->> 'rig' else name = f ->> 'rig' end);
      if matches <> 1 then
        raise exception 'File %: rig must identify exactly one rig owned by the PR author. Register the rig first or use its numeric ID.', item ->> 'path';
      end if;
      build := null;
      if f ? 'customRuntimeFile' then
        if f ? 'customRuntime' or f ->> 'customRuntimeFile' !~ '^custom-runtimes/[a-zA-Z0-9-]+/[a-zA-Z0-9][a-zA-Z0-9._-]*[.]json$'
          or jsonb_typeof(f -> 'customRuntimeFile') is distinct from 'string'
          or not exists (select 1 from jsonb_array_elements(p_files) x where x ->> 'path' = f ->> 'customRuntimeFile') then
          raise exception 'customRuntimeFile must reference a registration in this batch and cannot accompany customRuntime';
        end if;
        select c.id into build from private.pr_custom_runtime_imports i join public.custom_runtimes c on c.id = i.runtime_id
          where i.repository = p_repository and i.path = f ->> 'customRuntimeFile' and c.runtime_id = f ->> 'runtime';
        if build is null then raise exception 'customRuntimeFile refers to a deleted registration or mismatched runtime'; end if;
      elsif nullif(f ->> 'customRuntime', '') is not null then
        select count(*), min(id) into matches, build from public.custom_runtimes
        where runtime_id = f ->> 'runtime' and
          (case when f ->> 'customRuntime' ~ '^[0-9]+$' then id::text = f ->> 'customRuntime' else name = f ->> 'customRuntime' end);
        if matches <> 1 then
          raise exception 'File %: customRuntime must identify exactly one registered build of the selected runtime; use its numeric ID.', item ->> 'path';
        end if;
      end if;
      if length(coalesce(f ->> 'notes', '')) > 5000 then
        raise exception 'Notes must be 5000 characters or fewer';
      end if;
      -- A previous submission through the legacy prefill form must not be imported again.
      if exists (select 1 from public.results r where (r.repo_url = source_pr or r.source_pr_url = source_pr)
        and not exists (select 1 from private.pr_result_imports i where i.result_id = r.id)) then
        raise exception 'This PR already has a result submitted through the site. Add its result URL to the JSON to archive it without creating a duplicate.';
      end if;
      insert into public.results (
        submitter_id, rig_id, component_id, component_quantity, model_id, quant_id,
        runtime_id, runtime_version, runtime_flags, custom_runtime_id, revision,
        decode_tps, prompt_tps, ttft_ms, context_length, batch_size, run_date, notes, repo_url, source_pr_url,
        input_tokens, output_tokens, concurrency, decode_scope, decode_method, repeats, prompt_cache, thinking, speculative
      ) values (
        owner_uuid, rig, f ->> 'component',
        case when f ->> 'component' is not null then coalesce((f ->> 'componentQuantity')::smallint, 1) end,
        f ->> 'model', f ->> 'quant', f ->> 'runtime', f ->> 'runtimeVersion',
        f ->> 'runtimeFlags', build, f ->> 'revision',
        (f ->> 'decodeTps')::numeric, (f ->> 'promptTps')::numeric, (f ->> 'ttftMs')::numeric,
        (f ->> 'contextLength')::integer, (f ->> 'batchSize')::integer,
        (f ->> 'runDate')::date, f ->> 'notes', nullif(btrim(f ->> 'evidenceUrl'), ''), source_pr,
        (f ->> 'inputTokens')::integer, (f ->> 'outputTokens')::integer, (f ->> 'concurrency')::integer,
        f ->> 'decodeScope', f ->> 'decodeMethod', (f ->> 'repeats')::integer,
        (f ->> 'promptCache')::boolean, (f ->> 'thinking')::boolean, f ->> 'speculative'
      ) returning id into result_id;
      insert into private.pr_result_imports(repository, path, pr_number, github_id, payload, result_id)
      values (p_repository, item ->> 'path', p_pr_number, p_github_id, f, result_id);
      answer := answer || jsonb_build_array(jsonb_build_object('path', item ->> 'path',
        'status', case when p_dry_run then 'validated' else 'imported' end,
        'id', case when p_dry_run then null else result_id::text end));
    end loop;
    if p_dry_run then raise exception using errcode = 'PT001', message = 'Rollback validation'; end if;
  exception when sqlstate 'PT001' then null;
  end;
  return answer;
end;
$$;
revoke all on function public.ingest_pr_results(text, bigint, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.ingest_pr_results(text, bigint, text, jsonb, boolean) to service_role;

-- The HTTP API accepts the new fields, and clearing a custom build no longer clears the revision.
-- Otherwise identical to 20261003120000.
create or replace function private.agent_dispatch(p_action text, p_params jsonb)
returns jsonb language plpgsql security definer set search_path = '' set row_security = on as $$
declare
  actor uuid := auth.uid();
  body jsonb := coalesce(p_params->'body', '{}');
  query jsonb := coalesce(p_params->'query', '{}');
  resource text := split_part(p_action, '.', 1);
  operation text := split_part(p_action, '.', 2);
  record_id bigint := (p_params->>'id')::bigint;
  record jsonb; current_record jsonb; item jsonb; output jsonb := '[]';
  allowed text[]; fields text; values_sql text; updates text; owner_column text;
  page_limit integer := least(100, greatest(1, coalesce((query->>'limit')::integer, 25)));
  entry record;
begin
  if actor is null then raise exception using errcode = '42501', message = 'Missing user identity'; end if;
  if p_action = 'me' or p_action = 'users.get' then
    select jsonb_build_object('id', id, 'handle', handle, 'name', name, 'avatar_url', avatar_url, 'bio', bio, 'created_at', created_at)
      into record from public.profiles where (p_action = 'me' and id = actor) or (p_action = 'users.get' and handle = p_params->>'handle');
    if record is null then raise exception using errcode = 'P0002', message = 'User not found'; end if;
    return record;
  end if;
  if p_action = 'uploads.prepare' then
    record := jsonb_build_object('photo_path', actor::text || '/' || gen_random_uuid()::text ||
      case body->>'content_type' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' when 'image/webp' then '.webp' when 'image/gif' then '.gif' else '' end);
    insert into private.agent_uploads(photo_path, owner_id, content_type, size)
      values(record->>'photo_path', actor, body->>'content_type', (body->>'size')::integer);
    return record;
  end if;
  if p_action = 'uploads.complete' then
    -- Storage metadata is read by a narrowly scoped helper, never by the dispatcher.
    if not private.agent_upload_exists(body->>'photo_path', actor) then
      raise exception using errcode = '23514', message = 'Upload is missing, belongs to another user, or does not match its declared type and size';
    end if;
    update private.agent_uploads set completed_at = coalesce(completed_at, now()) where photo_path = body->>'photo_path';
    return jsonb_build_object('photo_path', body->>'photo_path');
  end if;
  if p_action = 'results.batch' then
    for item in select jsonb_array_elements(body->'items') loop
      output := output || jsonb_build_array(private.agent_dispatch('results.create', jsonb_build_object('body', item)));
    end loop;
    return jsonb_build_object('items', output);
  end if;
  if resource in ('confirmations','flags') then
    perform 1 from public.results where id = record_id and submitter_id <> actor and not hidden;
    if not found and operation = 'set' then raise exception using errcode = '42501', message = 'Choose another user''s visible result'; end if;
    if resource = 'confirmations' then
      if operation = 'set' then
        insert into public.result_confirmations(result_id,user_id) values(record_id,actor) on conflict do nothing;
      else delete from public.result_confirmations where result_id = record_id and user_id = actor; end if;
    else
      if operation = 'set' then
        insert into public.result_flags(result_id,user_id,reason,note) values(record_id,actor,body->>'reason',body->>'note')
          on conflict(result_id,user_id) do update set reason = excluded.reason, note = excluded.note;
      else delete from public.result_flags where result_id = record_id and user_id = actor; end if;
    end if;
    return jsonb_build_object('result_id', record_id::text, 'active', operation = 'set');
  end if;
  if resource not in ('rigs','results','custom_runtimes') then raise exception using errcode = '22023', message = 'Unknown operation'; end if;
  owner_column := case when resource = 'results' then 'submitter_id' else 'owner_id' end;
  if operation = 'get' then return private.agent_record(resource,record_id); end if;
  if operation = 'list' then
    for entry in execute format($query$
      select id from public.%I t where
        ($1->>'cursor' is null or id < ($1->>'cursor')::bigint)
        and ($1->>'owner' is null or to_jsonb(t)->>%L = case when $1->>'owner' = 'me' then $2::text else $1->>'owner' end)
        and ($1->>'q' is null or coalesce(to_jsonb(t)->>'name',to_jsonb(t)->>'notes','') ilike '%%' || ($1->>'q') || '%%')
        and ($1->>'rig' is null or to_jsonb(t)->>'rig_id' = $1->>'rig')
        and ($1->>'model' is null or to_jsonb(t)->>'model_id' = $1->>'model')
        and ($1->>'runtime' is null or to_jsonb(t)->>'runtime_id' = $1->>'runtime')
        and ($1->>'hardware' is null or ($3 = 'rigs' and exists(select 1 from public.rig_components c where c.rig_id=t.id and c.hardware_id=$1->>'hardware')) or ($3 = 'results' and to_jsonb(t)->>'component_id'=$1->>'hardware'))
      order by id desc limit $4
    $query$,resource,owner_column) using query,actor,resource,page_limit+1 loop
      output := output || jsonb_build_array(private.agent_record(resource,entry.id));
    end loop;
    if jsonb_array_length(output) > page_limit then
      output := output - page_limit;
      return jsonb_build_object('items',output,'next_cursor',output->(page_limit-1)->>'id');
    end if;
    return jsonb_build_object('items',output);
  end if;
  if operation in ('update','delete') then
    execute format('select to_jsonb(t) from public.%I t where id=$1 and %I=$2 for update',resource,owner_column)
      into current_record using record_id,actor;
    if current_record is null then raise exception using errcode = 'P0002', message = 'Record not found or not owned by you'; end if;
    if (p_params->>'expected_updated_at')::timestamptz is distinct from (current_record->>'updated_at')::timestamptz then
      raise exception using errcode = 'PT412', message = 'Record changed. Read it again before retrying your edit';
    end if;
  end if;
  if operation = 'delete' then
    if resource = 'rigs' and exists(select 1 from public.results where rig_id=record_id) and coalesce(query->>'cascade','false') <> 'true' then
      raise exception using errcode = 'PT409', message = 'This rig has results. Set cascade=true to explicitly delete them too';
    end if;
    execute format('delete from public.%I where id=$1',resource) using record_id;
    return jsonb_build_object('id',record_id::text,'deleted',true);
  end if;
  if operation not in ('create','update') then raise exception using errcode = '22023', message = 'Unknown operation'; end if;
  if resource = 'rigs' then
    if operation = 'create' then
      record_id := public.create_rig(btrim(body->>'name'),coalesce(btrim(body->>'os'),''),body->>'photo_path',body->>'notes',body->'components');
    else
      body := current_record || body;
      if not body ? 'components' then body := body || jsonb_build_object('components',private.agent_record('rigs',record_id)->'components'); end if;
      perform public.update_rig(record_id,btrim(body->>'name'),btrim(body->>'os'),body->>'photo_path',body->>'notes',body->'components');
    end if;
  else
    if resource = 'custom_runtimes' then
      allowed := array['runtime_id','name','repo_url','summary','notes'];
      if operation = 'update' and body ? 'runtime_id' and body->>'runtime_id' <> current_record->>'runtime_id'
        and private.agent_build_in_use(record_id) then
        raise exception using errcode = 'PT409', message = 'Cannot change the base runtime of a build with results';
      end if;
    else
      allowed := array['rig_id','model_id','quant_id','runtime_id','runtime_version','runtime_flags','custom_runtime_id','revision','component_id','component_quantity','decode_tps','prompt_tps','ttft_ms','context_length','batch_size','notes','repo_url','run_date',
        'input_tokens','output_tokens','concurrency','decode_scope','decode_method','repeats','prompt_cache','thinking','speculative'];
      record := coalesce(current_record,'{}') || body;
      if not exists(select 1 from public.rigs where id=(record->>'rig_id')::bigint and owner_id=actor) then
        raise exception using errcode = '42501', message = 'Result rig must belong to you';
      end if;
      if record->>'component_id' is not null and record->>'component_quantity' is null then body := body || '{"component_quantity":1}'; end if;
      if body ? 'component_id' and body->>'component_id' is null then body := body || '{"component_quantity":null}'; end if;
      if record->>'custom_runtime_id' is not null and not exists(select 1 from public.custom_runtimes where id=(record->>'custom_runtime_id')::bigint and runtime_id=record->>'runtime_id') then
        raise exception using errcode = '23514', message = 'Custom runtime must use the result''s base runtime';
      end if;
    end if;
    -- Identifier lists come exclusively from the allowlist above, never user SQL.
    select string_agg(format('%I',key),','), string_agg(format('v.%I',key),','), string_agg(format('%I=v.%I',key,key),',')
      into fields, values_sql, updates from jsonb_object_keys(body) key where key=any(allowed);
    if fields is null then raise exception using errcode = '22023', message = 'Provide at least one field to update'; end if;
    if operation = 'create' then
      execute format('insert into public.%I(%I,%s) select $2,%s from jsonb_populate_record(null::public.%I,$1) v returning id',resource,owner_column,fields,values_sql,resource)
        into record_id using body,actor;
    else
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 returning t.id',resource,updates,resource)
        into record_id using body,record_id;
    end if;
  end if;
  return private.agent_record(resource,record_id);
end;
$$;
-- Ownership is the RLS boundary. Never change this function to postgres/service_role.
grant create on schema private to intelinside_agent;
alter function private.agent_dispatch(text,jsonb) owner to intelinside_agent;
revoke create on schema private from intelinside_agent;
revoke all on function private.agent_dispatch(text,jsonb) from public, anon, authenticated;

commit;
