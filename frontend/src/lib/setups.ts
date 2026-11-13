import type { Conditions } from '@/lib/conditions'

/**
 * Named setups (issue #130, step 3, "option 2"). Each one is a fixed way of measuring, so results inside it can be
 * ranked against each other. A result only joins a setup when the conditions the setup checks are recorded and
 * match; anything not recorded never matches. "All results" keeps everything and stays the default until the
 * setups have filled up.
 */
export type SetupId = 'standard' | 'speculative' | 'long' | 'concurrent' | 'all'

export type Setup = {
  id: SetupId
  name: string
  /** The rules as short phrases, shown above the board. Empty for "All results". */
  rules: string[]
  match: (r: Partial<Conditions>) => boolean
}

// Decode timed after the first token. Wall clock includes prefill, so it reads lower and never joins a setup.
const timedAfterFirstToken = (r: Partial<Conditions>) => r.decodeMethod === 'streamed' || r.decodeMethod === 'engine' || r.decodeMethod === 'llama_bench'
const shortPrompt = (r: Partial<Conditions>) => r.inputTokens != null && r.inputTokens <= 1024
const enoughOutput = (r: Partial<Conditions>) => r.outputTokens != null && r.outputTokens >= 128

export const SETUPS: Setup[] = [
  {
    id: 'standard', name: 'Standard',
    rules: ['prompt ≤ 1k tokens', '≥ 128 out', '1 request', 'no speculation', 'timed after first token'],
    match: (r) => shortPrompt(r) && enoughOutput(r) && r.concurrency === 1 && r.speculative === 'none' && timedAfterFirstToken(r),
  },
  {
    id: 'speculative', name: 'Speculative',
    rules: ['prompt ≤ 1k tokens', '≥ 128 out', '1 request', 'speculation on', 'timed after first token'],
    match: (r) => shortPrompt(r) && enoughOutput(r) && r.concurrency === 1 && (r.speculative === 'lossless' || r.speculative === 'lossy') && timedAfterFirstToken(r),
  },
  {
    id: 'long', name: 'Long prompt',
    rules: ['prompt ≥ 16k tokens', '1 request', 'timed after first token'],
    match: (r) => r.inputTokens != null && r.inputTokens >= 16384 && r.concurrency === 1 && timedAfterFirstToken(r),
  },
  {
    id: 'concurrent', name: '4 requests',
    rules: ['prompt ≤ 1k tokens', '4 requests', 'per-request decode', 'timed after first token'],
    match: (r) => shortPrompt(r) && r.concurrency === 4 && r.decodeScope === 'per_request' && timedAfterFirstToken(r),
  },
  { id: 'all', name: 'All results', rules: [], match: () => true },
]

export const SETUP_BY_ID = Object.fromEntries(SETUPS.map((s) => [s.id, s])) as Record<SetupId, Setup>
export const isSetupId = (value: string | null | undefined): value is SetupId => !!value && value in SETUP_BY_ID
/** The default tab. Switch to 'standard' once that setup has enough results to be the headline. */
export const DEFAULT_SETUP: SetupId = 'all'

/** The named setup a result ranks in, if any. "All results" is not a setup a result belongs to. */
export const setupOf = (r: Partial<Conditions>): Setup | undefined => SETUPS.find((s) => s.id !== 'all' && s.match(r))
