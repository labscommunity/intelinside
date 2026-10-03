import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'

export const owner = '00000000-0000-0000-0000-000000000001'
export const other = '00000000-0000-0000-0000-000000000002'
export const migrations = new URL('../../../supabase/migrations/', import.meta.url)
export const bootstrap = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
  create table auth.identities(provider text, provider_id text, user_id uuid references auth.users(id), unique(provider, provider_id));
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
  $$;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text, metadata jsonb, unique(bucket_id,name));
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
`
export async function createDatabase(stopBefore) {
  const db = new PGlite()
  await db.exec(bootstrap)
  for (const name of readdirSync(migrations).sort()) {
    if (name === stopBefore) break
    try { await db.exec(readFileSync(new URL(name,migrations),'utf8')) }
    catch (error) { await db.close(); throw new Error(`${name}: ${error.message}`, { cause: error }) }
  }
  return db
}
export async function seedUsers(db) {
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ($1,'alice@example.test','{"user_name":"alice"}'), ($2,'bob@example.test','{"user_name":"bob"}')`, [owner,other])
}
