// Runs only from the trusted default branch. PR contents are JSON data, never checked out.
import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'

const marker = '<!-- intelinside-results -->'
const context = 'Result ingestion'
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })
const maxBytes = 64 * 1024

// Compile the shared parser without starting a dev server or loading the application's Vite config.
export async function loadResultParser() {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/lib/pr.ts', import.meta.url))],
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  })
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
  return Object.assign(module.parseResultFile, { parseCustomRuntimeFile: module.parseCustomRuntimeFile })
}

export function prepareFile(path, status, raw, author, parseResultFile) {
  if (path.startsWith('custom-runtimes/')) {
    const location = path.match(/^custom-runtimes\/([a-z0-9-]+)\/[a-z0-9][a-z0-9._-]*\.json$/i)
    if (!location || location[1].toLowerCase() !== author.toLowerCase()) throw new Error(`${path}: put the file under custom-runtimes/${author}/.`)
    if (status !== 'added') throw new Error(`${path}: Only new files register runtimes. Edit existing registrations on the site.`)
    const { file, problems } = parseResultFile.parseCustomRuntimeFile(raw)
    for (const field of ['name', 'summary', 'notes']) {
      if (file[field] && matcher.hasMatch(file[field])) problems.push(`${field}: please remove offensive or profane language.`)
    }
    if (problems.length) throw new Error(`${path}: ${problems.join(' ')}`)
    return { path, file }
  }
  const location = path.match(/^results\/([^/]+)\/[^/]+\.json$/)
  if (!location || location[1].toLowerCase() !== author.toLowerCase()) {
    throw new Error(`${path}: put the file under results/${author}/.`)
  }
  const { file, problems } = parseResultFile(raw)
  if (status !== 'added' && !file.result) problems.push('Only new files can submit runs. Use a new filename; edit existing live results on the site.')
  for (const [field, limit] of [['runtimeVersion', 80], ['runtimeFlags', 200], ['revision', 80], ['notes', 5000]]) {
    if (file[field]?.length > limit) problems.push(`${field} must be ${limit} characters or fewer.`)
    if (file[field] && matcher.hasMatch(file[field])) problems.push(`${field}: please remove offensive or profane language.`)
  }
  if (file.runDate && (Number.isNaN(Date.parse(file.runDate)) || new Date(file.runDate).toISOString().slice(0, 10) !== file.runDate)) {
    problems.push('runDate must be a real calendar date in YYYY-MM-DD format.')
  }
  if (problems.length) throw new Error(`${path}: ${problems.join(' ')}`)
  return { path, file }
}

export async function collectFiles(github, repository, pr, parseResultFile, { landed = false } = {}) {
  const changed = []
  // GitHub caps this endpoint at 3,000 files. Refuse truncated submissions.
  if (pr.changed_files > 3000) throw new Error('This PR has too many changed files. Submit in a smaller PR.')
  for (let page = 1; page <= 30; page++) {
    const files = await github(`/repos/${repository}/pulls/${pr.number}/files?per_page=100&page=${page}`)
    changed.push(...files)
    if (files.length < 100) break
  }
  if (changed.length !== pr.changed_files) throw new Error('GitHub returned an incomplete or changing file list. Rerun this check.')
  const candidates = changed.filter((f) => f.status !== 'removed' && (f.filename.startsWith('results/') || f.filename.startsWith('custom-runtimes/')) && f.filename.endsWith('.json') && f.filename !== 'results/schema.json' && f.filename !== 'custom-runtimes/schema.json')
  if (candidates.length > 100) throw new Error('Submit at most 100 submission files per PR.')
  const files = []
  if (!candidates.length) return files
  const sha = pr.merged ? pr.merge_commit_sha : pr.head.sha
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('GitHub did not return an immutable submission revision.')
  const sourceRepo = pr.merged || landed ? repository : pr.head.repo?.full_name
  if (!sourceRepo) throw new Error('The PR source repository is unavailable.')
  for (const candidate of candidates) {
    const path = candidate.filename.split('/').map(encodeURIComponent).join('/')
    const blob = await github(`/repos/${sourceRepo}/contents/${path}?ref=${sha}`)
    if (blob.type !== 'file' || blob.encoding !== 'base64' || blob.size > maxBytes || typeof blob.content !== 'string') {
      throw new Error(`${candidate.filename}: expected a regular JSON file no larger than 64 KiB.`)
    }
    const text = Buffer.from(blob.content, 'base64')
    if (text.length > maxBytes) throw new Error(`${candidate.filename}: file is too large.`)
    let raw
    try { raw = JSON.parse(text.toString('utf8')) } catch { throw new Error(`${candidate.filename}: invalid JSON.`) }
    files.push(prepareFile(candidate.filename, candidate.status, raw, pr.user.login, parseResultFile))
  }
  return files
}

// A merge can land on the default branch while GitHub leaves the PR unmerged (e.g. after a 504 mid-merge).
async function headLanded(github, repository, pr, defaultBranch) {
  try {
    const { status } = await github(`/repos/${repository}/compare/${pr.head.sha}...${defaultBranch}`)
    return status === 'ahead' || status === 'identical'
  } catch { return false }
}

export async function processPr({ github, database, repository, number, defaultBranch, parseResultFile, expectedHead, allowLanded = false }) {
  const pr = await github(`/repos/${repository}/pulls/${number}`)
  if (expectedHead && pr.head.sha !== expectedHead) throw new Error('The PR changed before validation. Rerun this check.')
  if (pr.base.repo.full_name !== repository || pr.base.ref !== defaultBranch) throw new Error('Submissions must target the default branch.')
  const landed = pr.state === 'closed' && !pr.merged && allowLanded && await headLanded(github, repository, pr, defaultBranch)
  if (pr.state === 'closed' && !pr.merged && !landed) return { pr, lines: ['Closed without merging; no submissions imported.'] }
  const merged = pr.merged || landed
  const files = await collectFiles(github, repository, pr, parseResultFile, { landed })
  if (!files.length) return { pr, lines: ['No submission files to import.'] }
  if (pr.user.type !== 'User') throw new Error('Open this PR using the GitHub account you used to sign up on the site. Bot-authored submissions cannot be attributed to a user.')
  if (!database) throw new Error('Maintainer setup required: configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and apply the PR ingestion migration.')
  const current = await github(`/repos/${repository}/pulls/${number}`)
  if (current.head.sha !== pr.head.sha || current.merged !== pr.merged || current.state !== pr.state
    || current.merge_commit_sha !== pr.merge_commit_sha || current.changed_files !== pr.changed_files || current.user.id !== pr.user.id || current.user.login !== pr.user.login || current.user.type !== pr.user.type
    || current.base.ref !== pr.base.ref || current.base.repo.full_name !== repository) {
    throw new Error('The PR changed during validation. Rerun the check on its latest revision.')
  }
  const { data, error } = await database.rpc('ingest_pr_results', {
    p_repository: repository, p_pr_number: pr.number, p_github_id: String(pr.user.id),
    p_files: files, p_dry_run: !merged,
  })
  if (error) throw new Error(error.message)
  const site = (process.env.SITE_URL || 'https://intelinside-blond.vercel.app').replace(/\/$/, '')
  const lines = data.map((entry) => {
    const registration = files.find((f) => f.path === entry.path && f.path.startsWith('custom-runtimes/'))
    const url = entry.id ? `${site}/${registration ? `runtimes/${registration.file.runtime}/custom` : 'results'}/${entry.id}` : null
    return `- ${entry.path}: ${entry.status}${url ? ` (${url})` : ''}`
  })
  lines.push(merged
    ? 'Merge ingestion completed. Rerunning this workflow will not duplicate these submissions.'
    : 'Ready for merge: the author has a linked GitHub account and the database accepted the submissions in a rolled-back validation transaction. Merging submits them automatically; no web form is needed.')
  return { pr, lines }
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const repository = process.env.GITHUB_REPOSITORY
  if (repository !== 'labscommunity/intelinside') throw new Error('Result ingestion is configured only for labscommunity/intelinside.')
  const number = Number(event.pull_request?.number ?? event.inputs?.pr_number)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('A valid PR number is required.')
  const github = async (path, method = 'GET', body) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method, headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`)
    return response.status === 204 ? null : response.json()
  }
  const pr = await github(`/repos/${repository}/pulls/${number}`)
  const statusPath = `/repos/${repository}/statuses/${pr.head.sha}`
  const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
  await github(statusPath, 'POST', { state: 'pending', context, description: 'Checking result submission', target_url: runUrl })
  let lines
  let succeeded = false
  try {
    const parseResultFile = await loadResultParser()
    const database = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null
    const result = await processPr({ github, database, repository, number, defaultBranch: event.repository.default_branch, parseResultFile, expectedHead: pr.head.sha,
      allowLanded: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' })
    lines = result.lines
    succeeded = true
  } catch (error) {
    lines = [`Result submission failed: ${error.message}`, 'Fix the problem, then push an update or ask a maintainer to rerun this workflow. No partial batch is committed.']
    process.exitCode = 1
  }
  const safe = lines.join('\n').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const site = process.env.SITE_URL || 'https://intelinside-blond.vercel.app'
  const body = `${marker}\n<pre>${safe}</pre>\n[Site / sign up](${site}) · [Workflow details and retry](${runUrl})`
  console.log(lines.join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body)
  await github(statusPath, 'POST', { state: succeeded ? 'success' : 'failure', context,
    description: succeeded ? 'Result submission checks passed' : 'Result submission needs attention', target_url: runUrl })
  try {
    let existing
    for (let page = 1; ; page++) {
      const comments = await github(`/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`)
      existing = comments.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.startsWith(marker))
      if (existing || comments.length < 100) break
    }
    await github(existing ? `/repos/${repository}/issues/comments/${existing.id}` : `/repos/${repository}/issues/${number}/comments`, existing ? 'PATCH' : 'POST', { body })
  } catch { console.warn('Could not post a PR comment; see the commit status and workflow summary.') }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
