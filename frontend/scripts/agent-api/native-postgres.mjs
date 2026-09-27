// Optional local check against a fresh native PostgreSQL cluster. Never connects
// to an existing database. PG_BINDIR can point at a PostgreSQL installation.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { bootstrap, migrations, owner } from './database.mjs'
const bin = process.env.PG_BINDIR ?? '/opt/homebrew/opt/postgresql@17/bin'
const directory = mkdtempSync(join(tmpdir(), 'intelinside-native-pg-'))
const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
let started = false
try {
  execFileSync(join(bin, 'initdb'), ['-D', directory, '-U', 'postgres', '--auth=trust', '--no-locale'], { stdio: 'pipe' })
  execFileSync(join(bin, 'pg_ctl'), ['-D', directory, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory} -F`, '-w', 'start'], { stdio: 'pipe' }); started = true
  const sql = bootstrap + `
    create role migration_owner login createrole bypassrls;
    grant anon, authenticated, service_role to migration_owner with admin option;
    grant create on database postgres to migration_owner;
    grant all on schema public,auth,storage to migration_owner;
    grant all on all tables in schema auth,storage to migration_owner;
    alter table storage.objects owner to migration_owner;
    alter table storage.buckets owner to migration_owner;
    set role migration_owner;
  ` + readdirSync(migrations).sort().map(name => readFileSync(new URL(name, migrations), 'utf8')).join('\n') + `
    insert into auth.users(id,email,raw_user_meta_data) values ('${owner}','alice@example.test','{"user_name":"alice"}');
    set role service_role;
    select public.manage_agent_keys('${owner}','create','{"name":"native-test","prefix":"ii_test","token_hash":"${'a'.repeat(64)}","scopes":["read","write"]}');
    do $$ declare response jsonb; begin
      response := public.agent_request('${'a'.repeat(64)}','rigs.create','{"body":{"name":"Native Postgres rig","components":[{"hardware_id":"intel-core-ultra-x7-358h","quantity":11}]}}','native-rig');
      if response->>'status' <> '201' or response->'body'->>'owner_id' <> '${owner}' then raise exception 'Native request failed: %',response; end if;
      response := public.agent_request('${'a'.repeat(64)}','rigs.create','{"body":{"name":"Native Postgres rig","components":[{"hardware_id":"intel-core-ultra-x7-358h","quantity":11}]}}','native-rig');
      if response->>'status' <> '201' then raise exception 'Native retry failed: %',response; end if;
    end $$;
    reset role;
    do $$ begin
      if (select count(*) from public.rigs) <> 1 then raise exception 'Duplicate rig'; end if;
      if (select rolbypassrls from pg_roles where rolname='intelinside_agent') then raise exception 'Executor bypasses RLS'; end if;
      if (select rolsuper from pg_roles where rolname='migration_owner') then raise exception 'Migration was run as superuser'; end if;
    end $$;
    set role authenticated;
    do $$ begin
      begin perform public.agent_request('${'a'.repeat(64)}','me'); raise exception 'RPC exposed';
      exception when insufficient_privilege then null; end;
    end $$;
  `
  execFileSync(join(bin, 'psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 })
  console.log('Native PostgreSQL: all migrations as a non-superuser, RLS executor, HTTP-RPC contract, idempotency, and browser denial passed.')
} catch (error) {
  console.error(error.stderr?.toString() ?? error.message); process.exitCode = 1
} finally {
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', directory, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' })
  rmSync(directory, { recursive: true, force: true })
}
