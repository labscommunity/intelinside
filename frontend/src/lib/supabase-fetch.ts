// PostgREST can briefly reject valid tokens when its cached clock is stale.
// Retry reads with the same credentials; refreshing the token can repeat the race.
export function createSupabaseFetch(
  supabaseUrl: string,
  fetchRequest: typeof fetch = (...args) => globalThis.fetch(...args),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): typeof fetch {
  const origin = new URL(supabaseUrl).origin
  const delays = [250, 750, 1500]

  return async (input, init) => {
    const request = input instanceof Request ? input : undefined
    const url = new URL(request?.url ?? String(input))
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const signal = init?.signal ?? request?.signal
    const canRetry = method === 'GET' && url.origin === origin && url.pathname.startsWith('/rest/v1/')

    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      const response = await fetchRequest(input, init)
      if (!canRetry || response.status !== 401 || attempt === delays.length) return response

      // Inspect a clone so callers can still read the original error response.
      const error = await response.clone().json().catch(() => null)
      if (error?.code !== 'PGRST303' || error?.message !== 'JWT issued at future') return response
      await wait(delays[attempt])
    }
  }
}
