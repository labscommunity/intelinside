begin;

-- Only the server can resolve personal keys. The browser manages them through
-- session-authenticated HTTP routes; the plaintext secret never enters Postgres.
create table private.agent_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  prefix text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 3 and scopes <@ array['read','write','community']),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index agent_keys_owner_idx on private.agent_keys(owner_id);
create table private.agent_receipts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id, request_key)
);
create table private.agent_activity (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  key_id uuid not null references private.agent_keys(id) on delete cascade,
  action text not null,
  resource_id text,
  created_at timestamptz not null default now()
);
create index agent_activity_owner_idx on private.agent_activity(owner_id, id desc);
create table private.agent_limits (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null
);
create table private.agent_uploads (
  photo_path text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null,
  size integer not null check (size between 1 and 10485760),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
revoke all on private.agent_keys, private.agent_receipts, private.agent_activity, private.agent_limits, private.agent_uploads from public, anon, authenticated;

-- The dispatcher runs as a NOLOGIN, NOBYPASSRLS role with exactly the browser's
-- table privileges. The privileged entry point authenticates the key and sets a
-- transaction-local user identity before entering this role. No caller supplies
-- an owner ID, SQL, table name, or arbitrary JWT claims.
create role intelinside_agent nologin inherit nobypassrls;
-- Hosted postgres has CREATEROLE, not SUPERUSER. Explicit membership permits
-- transferring function ownership on PostgreSQL 16+.
grant intelinside_agent to current_user;
grant authenticated to intelinside_agent;
grant usage on schema public, private, auth to intelinside_agent;
grant execute on function auth.uid() to intelinside_agent;
grant select, insert on private.agent_uploads to intelinside_agent;
grant update(completed_at) on private.agent_uploads to intelinside_agent;
alter table private.agent_uploads enable row level security;
create policy agent_upload_owner on private.agent_uploads to intelinside_agent
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create function public.manage_agent_keys(p_user_id uuid, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; key_id uuid;
begin
  -- Serialize creation to enforce the per-account cap even across concurrent calls.
  perform 1 from public.profiles where id = p_user_id for no key update;
  if not found then raise exception using errcode = 'P0002', message = 'Account not found'; end if;
  if p_action = 'list' then
    select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(k) - 'token_hash' - 'owner_id' order by k.created_at desc), '[]'))
      into result from private.agent_keys k where owner_id = p_user_id;
    return result;
  elsif p_action = 'activity' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(a)) from (
      select a.id::text, a.key_id, a.action, a.resource_id, a.created_at from private.agent_activity a
      where a.owner_id = p_user_id order by a.id desc limit 50
    ) a), '[]'));
  elsif p_action = 'create' then
    if (select count(*) from private.agent_keys where owner_id = p_user_id and revoked_at is null and (expires_at is null or expires_at > now())) >= 20 then
      raise exception using errcode = '23514', message = 'Revoke an existing key before creating more than 20 active keys';
    end if;
    if (p_data->>'expires_at')::timestamptz <= now() then
      raise exception using errcode = '23514', message = 'Expiry must be in the future';
    end if;
    insert into private.agent_keys(owner_id, name, prefix, token_hash, scopes, expires_at)
    values(p_user_id, btrim(p_data->>'name'), p_data->>'prefix', p_data->>'token_hash',
      array(select jsonb_array_elements_text(p_data->'scopes')), (p_data->>'expires_at')::timestamptz)
    returning id into key_id;
    select to_jsonb(k) - 'token_hash' - 'owner_id' into result from private.agent_keys k where id = key_id;
    return result;
  elsif p_action = 'revoke' then
    update private.agent_keys set revoked_at = coalesce(revoked_at, now()) where id = (p_data->>'id')::uuid and owner_id = p_user_id;
    if not found then raise exception using errcode = 'P0002', message = 'Key not found'; end if;
    return jsonb_build_object('revoked', true);
  end if;
  raise exception using errcode = '22023', message = 'Unknown key operation';
end;
$$;
revoke all on function public.manage_agent_keys(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.manage_agent_keys(uuid,text,jsonb) to service_role;

create function private.agent_record(p_table text, p_id bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare record jsonb; field text;
begin
  if p_table not in ('rigs','results','custom_runtimes') then raise exception 'Invalid resource'; end if;
  execute format('select to_jsonb(t) - ''legacy_photo_url'' from public.%I t where id = $1', p_table) into record using p_id;
  if record is null then raise exception using errcode = 'P0002', message = 'Record not found or not accessible'; end if;
  foreach field in array array['id','rig_id','custom_runtime_id'] loop
    if record->>field is not null then record := jsonb_set(record, array[field], to_jsonb(record->>field)); end if;
  end loop;
  if p_table = 'rigs' then
    record := record || jsonb_build_object('components', coalesce((select jsonb_agg(jsonb_build_object('hardware_id', hardware_id, 'quantity', quantity) order by hardware_id) from public.rig_components where rig_id = p_id), '[]'), 'url', '/rigs/' || p_id);
  elsif p_table = 'results' then
    record := record || jsonb_build_object('url', '/results/' || p_id);
  else
    record := record || jsonb_build_object('url', '/runtimes/' || (record->>'runtime_id') || '/custom/' || p_id);
  end if;
  return record;
end;
$$;
revoke all on function private.agent_record(text,bigint) from public, anon, authenticated;
grant execute on function private.agent_record(text,bigint) to intelinside_agent;

-- A build may be referenced by another user's hidden result. Check references
-- without exposing the referencing rows to the API caller.
create function private.agent_build_in_use(p_id bigint)
returns boolean language sql security definer set search_path = '' as $$
  select exists(select 1 from public.results where custom_runtime_id=p_id);
$$;
revoke all on function private.agent_build_in_use(bigint) from public, anon, authenticated;
grant execute on function private.agent_build_in_use(bigint) to intelinside_agent;

create function private.agent_dispatch(p_action text, p_params jsonb)
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
      allowed := array['rig_id','model_id','quant_id','runtime_id','runtime_version','runtime_flags','custom_runtime_id','revision','component_id','component_quantity','decode_tps','prompt_tps','ttft_ms','context_length','batch_size','notes','repo_url','run_date'];
      record := coalesce(current_record,'{}') || body;
      if not exists(select 1 from public.rigs where id=(record->>'rig_id')::bigint and owner_id=actor) then
        raise exception using errcode = '42501', message = 'Result rig must belong to you';
      end if;
      if record->>'component_id' is not null and record->>'component_quantity' is null then body := body || '{"component_quantity":1}'; end if;
      if body ? 'component_id' and body->>'component_id' is null then body := body || '{"component_quantity":null}'; end if;
      if body ? 'custom_runtime_id' and body->>'custom_runtime_id' is null then body := body || '{"revision":null}'; end if;
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

create function private.agent_upload_exists(p_path text, p_owner uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists(select 1 from private.agent_uploads u join storage.objects o on o.bucket_id='rig-photos' and o.name=u.photo_path
    where u.photo_path=p_path and u.owner_id=p_owner
      and (o.metadata->>'size')::bigint=u.size and o.metadata->>'mimetype'=u.content_type);
$$;
revoke all on function private.agent_upload_exists(text,uuid) from public, anon, authenticated;
grant execute on function private.agent_upload_exists(text,uuid) to intelinside_agent;

-- Signed uploads made by the backend have no Storage owner_id. Their immutable,
-- randomly allocated path and completed receipt establish ownership instead.
create or replace function private.require_owned_rig_photo_path()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.photo_path is not null and (
    split_part(new.photo_path,'/',1) <> (select auth.uid())::text
    or new.photo_path ~ '(^|/)[.]{1,2}(/|$)'
    or not exists(select 1 from storage.objects o where o.bucket_id='rig-photos' and o.name=new.photo_path and (
      o.owner_id::text=(select auth.uid())::text or exists(select 1 from private.agent_uploads u
        where u.photo_path=o.name and u.owner_id=(select auth.uid()) and u.completed_at is not null)))
  ) then raise exception using errcode='23514', message='Rig photo must be an image you uploaded to rig-photos'; end if;
  return new;
end;
$$;

create function public.agent_request(p_token_hash text, p_action text, p_params jsonb default '{}', p_request_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  key private.agent_keys;
  needed text;
  read_only boolean := p_action in ('me','users.get') or p_action ~ '\.(list|get)$';
  request jsonb := jsonb_build_object('action',p_action,'params',p_params);
  receipt private.agent_receipts;
  result jsonb;
  response jsonb;
  old_claims text := current_setting('request.jwt.claims',true);
  used integer;
  status integer;
  error_code text;
begin
  select * into key from private.agent_keys where token_hash=p_token_hash for update;
  if key.id is null or key.revoked_at is not null or key.expires_at <= now() then
    return jsonb_build_object('status',401,'body',jsonb_build_object('error',jsonb_build_object('code','unauthorized','message','Invalid, expired, or revoked API key')));
  end if;
  needed := case when read_only then 'read' when p_action ~ '^(confirmations|flags)\.' then 'community' else 'write' end;
  if not needed=any(key.scopes) then
    return jsonb_build_object('status',403,'body',jsonb_build_object('error',jsonb_build_object('code','insufficient_scope','message','This key needs the ' || needed || ' permission')));
  end if;
  insert into private.agent_limits(owner_id,window_start,requests) values(key.owner_id,date_trunc('minute',now()),1)
    on conflict(owner_id) do update set window_start=excluded.window_start,
      requests=case when agent_limits.window_start=excluded.window_start then agent_limits.requests+1 else 1 end
    returning requests into used;
  if used > 120 then
    return jsonb_build_object('status',429,'body',jsonb_build_object('error',jsonb_build_object('code','rate_limited','message','Limit is 120 requests per account per minute')));
  end if;
  update private.agent_keys set last_used_at=now() where id=key.id;
  -- The account limit row serializes all keys for this user, including receipts.
  delete from private.agent_receipts where owner_id=key.owner_id and created_at < now()-interval '30 days';
  delete from private.agent_activity where owner_id=key.owner_id and created_at < now()-interval '90 days';
  if not read_only then
    if p_request_key is null or length(p_request_key) not between 1 and 128 then
      return jsonb_build_object('status',400,'body',jsonb_build_object('error',jsonb_build_object('code','idempotency_required','message','Provide an Idempotency-Key header of 1–128 characters')));
    end if;
    select * into receipt from private.agent_receipts where owner_id=key.owner_id and request_key=p_request_key;
    if found then
      if receipt.request=request then return receipt.response; end if;
      return jsonb_build_object('status',409,'body',jsonb_build_object('error',jsonb_build_object('code','idempotency_conflict','message','This Idempotency-Key was used for a different request')));
    end if;
  end if;
  -- Every mutation, its activity, and its retry receipt commit together. A batch
  -- error rolls back all its writes but still counts toward the request limit.
  begin
    perform set_config('request.jwt.claims',jsonb_build_object('sub',key.owner_id,'role','authenticated')::text,true);
    result := private.agent_dispatch(p_action,p_params);
    perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
    if p_action='me' then result := result || jsonb_build_object('key_id',key.id,'scopes',key.scopes); end if;
    status := case when p_action ~ '\.(create|batch|prepare)$' then 201 else 200 end;
    response := jsonb_build_object('status',status,'body',result);
    if not read_only then
      insert into private.agent_activity(owner_id,key_id,action,resource_id) values(key.owner_id,key.id,p_action,coalesce(result->>'id',p_params->>'id'));
      insert into private.agent_receipts(owner_id,request_key,request,response) values(key.owner_id,p_request_key,request,response);
    end if;
    return response;
  exception when others then
    status := case when sqlstate='P0002' then 404 when sqlstate='42501' then 403 when sqlstate='PT412' then 412 when sqlstate in ('PT409','23001','23503','23505') then 409 when sqlstate like '22%' or sqlstate='23514' or sqlstate='23502' then 400 else 500 end;
    error_code := case status when 404 then 'not_found' when 403 then 'forbidden' when 412 then 'version_conflict' when 409 then 'conflict' when 400 then 'validation' else 'internal_error' end;
    return jsonb_build_object('status',status,'body',jsonb_build_object('error',jsonb_build_object('code',error_code,'message',case when status=500 then 'The operation failed' else sqlerrm end)));
  end;
end;
$$;
revoke all on function public.agent_request(text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.agent_request(text,text,jsonb,text) to service_role;

commit;
