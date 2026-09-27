import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/agent-api/contract.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm' })
const { routes } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
const intro = readFileSync(new URL('../../docs/AGENTS_API_INTRO.md', import.meta.url), 'utf8')
let doc = intro + '\n\n## Routes\n\nAll paths below are relative to `/api/v1`. Every route except `/catalog` requires a personal API key.\n\n| Method | Path | Permission | Behavior |\n| --- | --- | --- | --- |\n'
for (const route of routes) doc += `| ${route.method} | \`${route.path}\` | ${route.scope} | ${route.description} |\n`
const describe = (schema) => {
  let result = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type
  if (schema.enum) result += ': ' + schema.enum.join(', ')
  if (schema.format) result += ` (${schema.format})`
  if (schema.maxLength) result += `; max ${schema.maxLength} characters`
  if (schema.minimum !== undefined) result += `; minimum ${schema.minimum}`
  if (schema.exclusiveMinimum !== undefined) result += `; greater than ${schema.exclusiveMinimum}`
  if (schema.maximum !== undefined) result += `; maximum ${schema.maximum}`
  if (schema.type === 'array') result += `; ${schema.minItems}–${schema.maxItems} items`
  return result
}
for (const route of routes.filter((route) => route.schema && route.method !== 'PATCH')) {
  doc += `\n### Input: ${route.method} ${route.path}\n\nUnknown fields are rejected. PATCH accepts the same fields as POST, all optional.\n\n| Field | Required on create | Type and limits |\n| --- | --- | --- |\n`
  for (const [name, schema] of Object.entries(route.schema.properties)) doc += `| \`${name}\` | ${route.schema.required?.includes(name) ? 'Yes' : 'No'} | ${describe(schema)} |\n`
  if (route.action === 'rigs.create') doc += '\nEach component is `{ "hardwareId": "<catalog ID>", "quantity": 11 }`; quantity is an integer from 1 to 32767.\n'
  if (route.action === 'results.batch') doc += '\nEach item uses the POST /results fields below.\n'
}
const dest = new URL('../public/docs/agents.md', import.meta.url)
if (process.argv.includes('--check')) {
  if (readFileSync(dest, 'utf8') !== doc) throw new Error('Agent docs are stale. Run npm run agents:docs.')
  console.log('Agent docs match the route schemas.')
} else { writeFileSync(dest, doc); console.log('Generated public/docs/agents.md') }
