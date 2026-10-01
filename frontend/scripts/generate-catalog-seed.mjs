// Prints the catalog as idempotent seed SQL, for a fresh database. Production syncs through the sync_catalog
// database function on merge instead (see docs/SUPABASE.md); both use the mapping in catalog-snapshot.mjs.
import { catalogSnapshot, loadCatalog } from './catalog-snapshot.mjs'

const quote = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`
const textArray = (values) => (values?.length ? `array[${values.map(quote).join(', ')}]::text[]` : `'{}'::text[]`)
const date = (value) => value ? `${quote(value)}::date` : 'null'
const literal = { bits: String, specs: json, release_date: date, integrated: textArray }
// `--only hardware` prints just the hardware upsert, for a migration that changes only that table.
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

function upsert(table, rows, key) {
  const columns = Object.keys(rows[0])
  const update = columns.filter((c) => !key.includes(c))
  return [
    `insert into public.${table} (${columns.join(', ')}) values`,
    rows.map((row) => `  (${columns.map((c) => (literal[c] ?? quote)(row[c])).join(', ')})`).join(',\n'),
    `on conflict (${key.join(', ')}) do ${update.length ? `update set ${update.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'nothing'};`,
  ]
}

const snapshot = catalogSnapshot(await loadCatalog())
const hardware = upsert('hardware', snapshot.hardware, ['id'])
const statements = only === 'hardware' ? [...hardware, ''] : [
  'begin;', '',
  ...upsert('quants', snapshot.quants, ['id']), '',
  ...upsert('models', snapshot.models, ['id']), '',
  ...upsert('model_quants', snapshot.model_quants, ['model_id', 'quant_id']), '',
  ...upsert('runtimes', snapshot.runtimes, ['id']), '',
  ...hardware, '',
  'commit;', '',
]
process.stdout.write(statements.join('\n'))
