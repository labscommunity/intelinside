import { useEffect, useState, type FormEvent } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { SignInGate } from '@/components/SignInGate'
import { Block, Section } from '@/components/frame'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/hooks/useSession'
import { usePageTitle } from '@/hooks/usePageTitle'
import { supabase } from '@/lib/auth'

type Key = { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null }
type Activity = { id: string; keyId: string; action: string; resourceId: string | null; createdAt: string }
const actionLabels: Record<string, string> = {
  'rigs.create': 'Created rig', 'rigs.update': 'Updated rig', 'rigs.delete': 'Deleted rig',
  'custom_runtimes.create': 'Registered custom runtime', 'custom_runtimes.update': 'Updated custom runtime', 'custom_runtimes.delete': 'Deleted custom runtime',
  'results.create': 'Submitted result', 'results.update': 'Updated result', 'results.delete': 'Deleted result', 'results.batch': 'Submitted result batch',
  'confirmations.set': 'Confirmed result', 'confirmations.delete': 'Removed confirmation', 'flags.set': 'Flagged result', 'flags.delete': 'Removed flag',
  'uploads.prepare': 'Started photo upload', 'uploads.complete': 'Completed photo upload',
}
const accessLabel = (scopes: string[]) => scopes.includes('community') ? 'Full user access' : scopes.includes('write') ? 'Manage content' : 'Read only'
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never'
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { data } = await supabase!.auth.getSession()
  if (!data.session) throw new Error('Sign in to manage API keys.')
  const response = await fetch(path, {
    method, headers: { authorization: `Bearer ${data.session.access_token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.message ?? 'Could not manage API keys.')
  return result as T
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); toast.success('Copied.') }
  catch { toast.error('Could not copy. Select and copy the text manually.') }
}
function KeysPanel() {
  const [keys, setKeys] = useState<Key[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [name, setName] = useState('')
  const [access, setAccess] = useState('full')
  const [expiry, setExpiry] = useState('')
  const [secret, setSecret] = useState<{ id: string; key: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revokeId, setRevokeId] = useState<string | null>(null)
  async function refresh() {
    const [list, log] = await Promise.all([request<{ items: Key[] }>('/api/keys'), request<{ items: Activity[] }>('/api/keys/activity')])
    setKeys(list.items); setActivity(log.items)
  }
  useEffect(() => { void refresh().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)) }, [])
  async function create(event: FormEvent) {
    event.preventDefault(); setPending(true); setError('')
    try {
      const created = await request<Key & { key: string }>('/api/keys', 'POST', {
        name, scopes: access === 'read' ? ['read'] : access === 'content' ? ['read', 'write'] : ['read', 'write', 'community'],
        expiresAt: expiry ? new Date(Number(expiry) * 86400000 + Date.now()).toISOString() : null,
      })
      setSecret({ id: created.id, key: created.key }); setName(''); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create key.') }
    finally { setPending(false) }
  }
  async function revoke(id: string) {
    setPending(true); setError('')
    try {
      await request(`/api/keys/${id}`, 'DELETE'); setRevokeId(null)
      if (secret?.id === id) setSecret(null)
      await refresh(); toast.success('Key revoked.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not revoke key.') }
    finally { setPending(false) }
  }
  const instructions = `Read ${window.location.origin}/docs/agents.md. Use the API key configured in INTELINSIDE_API_KEY to act on my behalf. Never print or commit the key. Use existing records when appropriate, submit only measured results, and return the resulting page URLs.`
  return <>
    <Section label="Connect your agent"><Block className="max-w-3xl space-y-5">
      <p className="text-sm text-muted-foreground">Create a key, save it as <code>INTELINSIDE_API_KEY</code> in your agent’s environment or secret settings, then give your agent the instructions below.</p>
      <div className="rounded-md border bg-muted/30 p-4 text-sm break-words">{instructions}</div>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" onClick={() => void copy(instructions)}><Copy /> Copy agent instructions</Button>
        <a className="text-sm underline underline-offset-4" href="/docs/agents.md">Agent documentation</a>
        <a className="text-sm underline underline-offset-4" href="/api/openapi.json">API reference</a>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {secret ? <div className="space-y-3 rounded-md border border-primary p-4" aria-label="New API key">
        <h2 className="font-semibold">Save your key now</h2>
        <p className="text-sm text-muted-foreground">This is the only time it will be shown. Keep it out of chat messages, source control, and public logs.</p>
        <code className="block break-all rounded bg-muted p-3 text-sm" data-testid="new-api-key">{secret.key}</code>
        <div className="flex flex-wrap gap-3"><Button onClick={() => void copy(secret.key)}><Copy /> Copy key</Button><Button variant="outline" onClick={() => setSecret(null)}>I’ve saved it</Button></div>
      </div> : <form onSubmit={(event) => void create(event)} className="space-y-4">
        <div className="space-y-2"><label htmlFor="key-name" className="text-sm font-medium">Key name</label><Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="My coding agent" /></div>
        <div className="space-y-2"><label htmlFor="key-access" className="text-sm font-medium">Access</label>
          <select id="key-access" className="block w-full rounded-md border bg-background p-2 text-sm" value={access} onChange={(event) => setAccess(event.target.value)}>
            <option value="full">Full user access</option><option value="content">Manage my rigs, runtimes, and results</option><option value="read">Read only</option>
          </select>
          <p className="text-xs text-muted-foreground">{access === 'full' ? 'Read data; create, edit, and delete your content; confirm and flag results. Keys cannot manage other keys.' : access === 'content' ? 'Read data and create, edit, and delete your rigs, runtimes, results, and photos.' : 'Read data and your profile. Cannot make changes.'}</p>
        </div>
        <details><summary className="cursor-pointer text-sm">Optional expiry</summary><label className="mt-3 block text-sm" htmlFor="key-expiry">Expires after</label>
          <select id="key-expiry" className="mt-2 rounded-md border bg-background p-2 text-sm" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
            <option value="">No expiry</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
          </select>
        </details>
        <Button type="submit" disabled={pending || loading || !name.trim()}><KeyRound /> {pending ? 'Creating…' : 'Create key'}</Button>
      </form>}
    </Block></Section>
    <Section label="Your API keys"><Block>
      {loading ? <Skeleton className="h-24" /> : !keys.length ? <p className="text-sm text-muted-foreground">No API keys yet.</p> : <div className="divide-y">
        {keys.map((key) => {
          const expired = !!key.expiresAt && Date.parse(key.expiresAt) <= Date.now()
          return <div key={key.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="font-medium break-words">{key.name} {key.revokedAt ? '· Revoked' : expired ? '· Expired' : ''}</p>
              <p className="mt-1 text-xs text-muted-foreground"><code>{key.prefix}…</code> · {accessLabel(key.scopes)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Last used: {date(key.lastUsedAt)} · Expires: {date(key.expiresAt)}</p>
            </div>
            {!key.revokedAt && (revokeId === key.id ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm">Revoke access?</span><Button variant="destructive" disabled={pending} onClick={() => void revoke(key.id)}>Confirm revoke</Button><Button variant="ghost" onClick={() => setRevokeId(null)}>Cancel</Button></div> : <Button variant="outline" onClick={() => setRevokeId(key.id)} aria-label={`Revoke ${key.name}`}>Revoke</Button>)}
          </div>
        })}
      </div>}
    </Block></Section>
    <Section label="Recent agent activity"><Block>
      {!activity.length ? <p className="text-sm text-muted-foreground">Agent changes will appear here.</p> : <ul className="space-y-3 text-sm">{activity.map((item) => <li key={item.id} className="break-words"><span className="font-medium">{keys.find((key) => key.id === item.keyId)?.name ?? 'API key'}</span> · {actionLabels[item.action] ?? item.action}{item.resourceId ? ` #${item.resourceId}` : ''}<span className="block text-xs text-muted-foreground">{date(item.createdAt)}</span></li>)}</ul>}
    </Block></Section>
  </>
}
export default function ApiKeys() {
  usePageTitle('API keys')
  const { user, loading } = useSession()
  if (loading) return <Block><Skeleton className="h-64" /></Block>
  if (!user) return <SignInGate what="manage your API keys" />
  return <div><PageHeader eyebrow="Settings" title="API keys" description="Let your agent manage your Intelinside content. You can revoke access at any time." />
    {supabase ? <KeysPanel key={user.id} /> : <Block>API keys require a connected Intelinside account. They are unavailable in the offline demo.</Block>}
  </div>
}
