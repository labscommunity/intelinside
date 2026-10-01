import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

export const migrations = new URL('../../../supabase/migrations/', import.meta.url)

// An isolated PostgreSQL with the application migrations applied, up to (not including) `stopBefore`.
export async function createDatabase(stopBefore) {
  const db = new PGlite()
  // Minimal hosted Auth contract; application tables/functions come from the real migrations.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
    create table auth.identities(provider text, provider_id text, user_id uuid references auth.users(id), unique(provider, provider_id));
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
  for (const name of readdirSync(migrations).sort()) {
    if (name === stopBefore) break
    if (name.includes('storage') || name.includes('photo_paths')) continue
    await db.exec(readFileSync(new URL(name, migrations), 'utf8'))
  }
  return db
}
