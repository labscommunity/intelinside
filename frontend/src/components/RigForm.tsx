import { useState } from 'react'
import { Minus, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { HardwareTypeIcon } from '@/components/HardwareTypeIcon'
import { VendorMark } from '@/components/VendorMark'
import { PillTabs } from '@/components/frame'
import { keySpec } from '@/components/cards'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { ApiError, type HardwareItem, type HardwareType, type Rig, type RigInput } from '@/lib/api/types'
import { UNIT_LABEL, integratedParts, nestParts } from '@/lib/hardware'
import { rigSummaryLine } from '@/lib/rig-summary'
import { cn } from '@/lib/utils'
import { HARDWARE_TYPE_LABEL, HARDWARE_TYPES } from '@/catalog'

type Picked = { hardware: HardwareItem; quantity: number }
type TypeFilter = 'all' | HardwareType
const OS_SUGGESTIONS = ['Windows 11', 'Ubuntu 24.04', 'Ubuntu 22.04', 'Fedora 42', 'macOS 15', 'Arch Linux']

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}

type Props = {
  initial?: Rig
  submitLabel?: string
  onSaved: (rig: Rig) => void
  onCancel?: () => void
  /** Render a div instead of a form, for use inside another form. */
  inline?: boolean
}

/** Create or edit a rig: name, OS, notes, photo, and the parts list picked from the catalog. */
export function RigForm({ initial, submitLabel = 'Save rig', onSaved, onCancel, inline = false }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [os, setOs] = useState(initial?.os ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(initial?.photoUrl)
  const [picked, setPicked] = useState<Picked[]>(() =>
    (initial?.components ?? []).filter((c) => c.hardware).map((c) => ({ hardware: c.hardware!, quantity: c.quantity })),
  )
  const [q, setQ] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const search = useAsync(() => api.hardware({ q: q || undefined, type: type === 'all' ? undefined : type, limit: 100 }), [q, type])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const pickedIds = new Set(picked.map((p) => p.hardware.id))
  const Root = inline ? 'div' : 'form'

  /** Adding a CPU brings the iGPU and NPU on its package along, so a run on any of the three can be recorded as its own part. */
  const add = (h: HardwareItem) => {
    const carried = integratedParts(h).filter((part) => !pickedIds.has(part.id))
    setPicked((p) => {
      if (p.some((x) => x.hardware.id === h.id)) return p
      const next = [...p, { hardware: h, quantity: 1 }]
      for (const part of carried) if (!next.some((x) => x.hardware.id === part.id)) next.push({ hardware: part, quantity: 1 })
      return next
    })
    if (carried.length) {
      const names = carried.map((part) => part.name).join(' and ')
      toast(carried.length > 1 ? `${names} come on the ${h.name} package, so they were added too.` : `${names} comes on the ${h.name} package, so it was added too.`)
    }
  }
  const setQty = (id: string, qty: number) => setPicked((p) => p.map((x) => (x.hardware.id === id ? { ...x, quantity: Math.max(1, Math.min(64, qty)) } : x)))
  /** Removing a CPU also removes the integrated parts it brought, unless another picked CPU carries them. */
  const remove = (id: string) =>
    setPicked((p) => {
      const rest = p.filter((x) => x.hardware.id !== id)
      const orphaned = new Set(integratedParts(p.find((x) => x.hardware.id === id)?.hardware).map((part) => part.id))
      for (const x of rest) for (const part of integratedParts(x.hardware)) orphaned.delete(part.id)
      return rest.filter((x) => !orphaned.has(x.hardware.id))
    })
  const nested = nestParts(picked.map((p) => ({ ...p, hardwareId: p.hardware.id })))
  const components = nested.map(({ part, host }) => ({
    hardwareId: part.hardware.id,
    // Keep the preview and saved quantities aligned with the CPU carrying each integrated part.
    quantity: host ? picked.find((p) => p.hardware.id === host.id)?.quantity ?? part.quantity : part.quantity,
  }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Give the rig a name.'
    if (!picked.length) e.components = 'Add at least one component.'
    return e
  }

  const submit = async (ev: { preventDefault(): void }) => {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const input: RigInput = {
        name: name.trim(),
        os: os.trim(),
        notes: notes.trim() || undefined,
        photoUrl,
        components,
      }
      const rig = initial ? await api.updateRig(initial.id, input) : await api.createRig(input)
      toast.success(initial ? 'Rig updated.' : 'Rig created.')
      onSaved(rig)
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields)
      toast.error(err instanceof ApiError ? err.message : 'Could not save the rig.')
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file?: File) => {
    if (!file) return
    try {
      const { url } = await api.upload(file)
      setPhotoUrl(url)
    } catch {
      toast.error('Could not upload the photo.')
    }
  }

  return (
    <Root {...(inline ? {} : { onSubmit: submit, noValidate: true })} className="space-y-6">
      {/* content-start on both: an error under Name makes the row taller, and stretched rows would stop the two
          inputs lining up. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="rig-name">Name</Label>
          <Input id="rig-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Quad B70 workstation" aria-invalid={!!errors.name} />
          <FieldError message={errors.name} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="rig-os">Operating system</Label>
          <Input id="rig-os" list="rig-os-suggestions" value={os} onChange={(e) => setOs(e.target.value)} placeholder="Ubuntu 24.04" />
          <datalist id="rig-os-suggestions">
            {OS_SUGGESTIONS.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rig-notes">Notes</Label>
        <Textarea id="rig-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cooling, drivers, anything that affects the numbers." rows={3} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rig-photo">Photo</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input id="rig-photo" type="file" accept="image/*" onChange={(e) => void upload(e.target.files?.[0])} className="max-w-xs" />
          {photoUrl ? <img src={photoUrl} alt="" className="h-10 w-16 rounded-md object-cover" /> : null}
          {photoUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setPhotoUrl(undefined)}>
              Remove photo
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-medium uppercase tracking-label text-muted-foreground">Components</div>
        {picked.length ? (
          <ul className="divide-y rounded-lg border">
            {nested.map(({ part: p, host }) => (
              <li key={p.hardware.id} className={cn('flex items-center gap-3 px-3 py-2 text-sm', host && 'pl-9')}>
                <HardwareTypeIcon type={p.hardware.type} className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.hardware.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {host ? `${UNIT_LABEL[p.hardware.type]} on the ${host.name} package` : HARDWARE_TYPE_LABEL[p.hardware.type]} · {keySpec(p.hardware)}
                  </div>
                </div>
                {host ? null : (
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" size="icon-sm" aria-label={`Fewer ${p.hardware.name}`} onClick={() => setQty(p.hardware.id, p.quantity - 1)}>
                      <Minus />
                    </Button>
                    <span className="w-8 text-center font-mono text-sm tnum" aria-live="polite">
                      {p.quantity}
                    </span>
                    <Button type="button" variant="outline" size="icon-sm" aria-label={`More ${p.hardware.name}`} onClick={() => setQty(p.hardware.id, p.quantity + 1)}>
                      <Plus />
                    </Button>
                  </div>
                )}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${p.hardware.name}`} onClick={() => remove(p.hardware.id)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No components yet. Search the catalog and add what is in the machine.</p>
        )}
        <FieldError message={errors.components} />
        {picked.length ? <p className="text-xs text-muted-foreground">Summary line: {rigSummaryLine(components)}</p> : null}
        <div className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-2 border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog" aria-label="Search hardware" className="w-56 pl-8" />
            </div>
            <PillTabs<TypeFilter>
              value={type}
              onChange={setType}
              items={[{ value: 'all', label: 'All' }, ...HARDWARE_TYPES.map((t) => ({ value: t, label: HARDWARE_TYPE_LABEL[t] }))]}
            />
          </div>
          <ul className="max-h-64 divide-y overflow-y-auto" aria-label="Catalog results">
            {(search.data?.items ?? []).map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  disabled={pickedIds.has(h.id)}
                  onClick={() => add(h)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-card disabled:cursor-default disabled:opacity-40"
                >
                  <HardwareTypeIcon type={h.type} className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{h.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{keySpec(h)}</span>
                  </span>
                  <VendorMark vendor={h.vendor} size="sm" className="text-muted-foreground" />
                  <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
            {search.data && search.data.items.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">Nothing matches. Missing parts are added to the catalog by pull request.</li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type={inline ? 'button' : 'submit'} disabled={busy} onClick={inline ? (e) => void submit(e) : undefined}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </Root>
  )
}
