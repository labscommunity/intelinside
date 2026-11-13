import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { syncMockSession } from '@/lib/api/mock'
import { getSupabaseUser, signInWithGitHub, signOutSupabase, supabase, toAppUser, usesSupabaseAuth } from '@/lib/auth'
import type { User } from '@/lib/api/types'

type Session = {
  user: User | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  /** Opens the offline account picker, or redirects to GitHub when Auth is configured. */
  requestSignIn: (returnTo?: string) => void
  signInOpen: boolean
  setSignInOpen: (open: boolean) => void
  mockSignIn: (handle: string) => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signInOpen, setSignInOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const nextUser = usesSupabaseAuth ? await getSupabaseUser() : await api.me()
      setUser(api.mode === 'mock' && usesSupabaseAuth ? syncMockSession(nextUser) : nextUser)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()

    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ? toAppUser(session.user) : null
      setUser(api.mode === 'mock' ? syncMockSession(nextUser) : nextUser)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [refresh])

  const signOut = useCallback(async () => {
    if (usesSupabaseAuth) {
      await signOutSupabase()
      if (api.mode === 'mock') syncMockSession(null)
    } else {
      await api.signOut()
    }
    setUser(null)
  }, [])

  const requestSignIn = useCallback((returnTo?: string) => {
    if (usesSupabaseAuth) {
      void signInWithGitHub(returnTo ?? window.location.pathname).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Could not start GitHub sign-in.')
      })
    } else {
      setSignInOpen(true)
    }
  }, [])

  const mockSignIn = useCallback(async (handle: string) => {
    if (!api.mockSignIn) return
    setUser(await api.mockSignIn(handle))
    setSignInOpen(false)
  }, [])

  const value = useMemo<Session>(
    () => ({ user, loading, refresh, signOut, requestSignIn, signInOpen, setSignInOpen, mockSignIn }),
    [user, loading, refresh, signOut, requestSignIn, signInOpen, mockSignIn],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
