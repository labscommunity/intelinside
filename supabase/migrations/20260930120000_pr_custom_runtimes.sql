begin;

alter table public.custom_runtimes add column source_pr_url text
  check (source_pr_url ~ '^https://github[.]com/labscommunity/intelinside/pull/[1-9][0-9]*$');
-- Keep browser writes working without allowing clients to assert trusted provenance.
revoke insert, update on public.custom_runtimes from authenticated;
grant insert(owner_id,runtime_id,name,repo_url,summary,notes),
  update(runtime_id,name,repo_url,summary,notes) on public.custom_runtimes to authenticated;

create table private.pr_custom_runtime_imports (
  repository text not null,
  path text not null,
  pr_number bigint not null,
  github_id text not null,
  payload jsonb not null,
  runtime_id bigint references public.custom_runtimes(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(repository,path)
);
revoke all on private.pr_custom_runtime_imports from public, anon, authenticated;

-- Conservative source matching: lower-case scheme/authority, strip trailing slashes
-- and a terminal .git suffix. Preserve path case, query, fragment, and HTTP vs HTTPS.
create function private.pr_runtime_source(value text) returns text
language sql immutable strict set search_path = '' as $$
  select lower(parts[1]) || regexp_replace(regexp_replace(parts[2], '/+$', ''), '[.]git$', '') || parts[3]
  from regexp_match(btrim(value), '^(https?://[^/?#]+)([^?#]*)(.*)$', 'i') parts;
$$;
revoke all on function private.pr_runtime_source(text) from public, anon, authenticated;

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
        decode_tps, prompt_tps, ttft_ms, context_length, batch_size, run_date, notes, repo_url, source_pr_url
      ) values (
        owner_uuid, rig, f ->> 'component',
        case when f ->> 'component' is not null then coalesce((f ->> 'componentQuantity')::smallint, 1) end,
        f ->> 'model', f ->> 'quant', f ->> 'runtime', f ->> 'runtimeVersion',
        f ->> 'runtimeFlags', build, f ->> 'revision',
        (f ->> 'decodeTps')::numeric, (f ->> 'promptTps')::numeric, (f ->> 'ttftMs')::numeric,
        (f ->> 'contextLength')::integer, (f ->> 'batchSize')::integer,
        (f ->> 'runDate')::date, f ->> 'notes', nullif(btrim(f ->> 'evidenceUrl'), ''), source_pr
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

commit;
