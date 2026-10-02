// Writes the merged catalog to production through the sync_catalog database function. Runs only from the trusted
// default branch (.github/workflows/sync-catalog.yml); see docs/SUPABASE.md. `--dry-run` reports without writing.
import { appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { catalogSnapshot, loadCatalog } from './catalog-snapshot.mjs'

export const TABLES = ['quants', 'models', 'model_quants', 'runtimes', 'hardware']

export function report({ source_sha: sha, dry_run: dryRun, tables }) {
  const lines = [
    `### Catalog sync ${dryRun ? '(dry run, nothing written)' : ''}`.trim(), '',
    `Source: \`${sha}\``, '',
    '| Table | Inserted | Updated | Unchanged |', '| --- | ---: | ---: | ---: |',
    ...TABLES.map((t) => `| ${t} | ${tables[t].inserted} | ${tables[t].updated} | ${tables[t].unchanged} |`),
  ]
  const stale = TABLES.filter((t) => tables[t].not_in_catalog.length)
  if (stale.length) {
    lines.push('', 'In the database but not the catalog. Sync never deletes these; retire them with a reviewed migration if intended:')
    for (const t of stale) lines.push(`- ${t}: ${tables[t].not_in_catalog.join(', ')}`)
  }
  return lines.join('\n')
}

export const changes = ({ tables }) => TABLES.reduce((n, t) => n + tables[t].inserted + tables[t].updated, 0)

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Maintainer setup required: configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and apply the catalog sync migration.')
  }
  // The checked-out commit, not the triggering event: a rerun of an old run syncs current main.
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const snapshot = catalogSnapshot(await loadCatalog())
  const database = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const sync = async (p_dry_run) => {
    const { data, error } = await database.rpc('sync_catalog', { p_snapshot: snapshot, p_source_sha: sha, p_dry_run })
    if (error) throw new Error(`Catalog sync failed: ${error.message}`)
    return data
  }
  const result = await sync(dryRun)
  const body = report(result)
  console.log(body)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)
  // Verify: the database now matches the catalog, so a second pass has nothing left to change.
  if (!dryRun && changes(await sync(true))) throw new Error('Catalog sync verification failed: the database still differs from the catalog.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Catalog sync failed\n\n${error.message}\n\nNothing was written. Fix the cause, then rerun the **Sync the catalog to Supabase** workflow.\n`)
    process.exitCode = 1
  })
}
