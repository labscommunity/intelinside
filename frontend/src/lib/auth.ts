import { createClient, type User as SupabaseUser } from '@supabase/supabase-js'
import type { User } from '@/lib/api/types'
import { createSupabaseFetch } from './supabase-fetch'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const RETURN_TO_KEY = 'intelinside.auth.returnTo'

export const usesSupabaseAuth = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase = usesSupabaseAuth
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      global: { fetch: createSupabaseFetch(supabaseUrl!) },
      auth: {
        detectSessionInUrl: true,
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

function metadataString(user: SupabaseUser, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = user.user_metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
}

export function toAppUser(user: SupabaseUser): User {
  // The auth trigger stores profile handles lowercase (profiles_handle_format), while GitHub's
  // user_name keeps its original casing. Handles are compared exactly everywhere (profile routes,
  // owner filters), so the session handle must be derived the same way the trigger does.
  const handle = (metadataString(user, 'user_name', 'preferred_username') ?? user.email?.split('@')[0] ?? user.id).toLowerCase()

  return {
    id: user.id,
    handle,
    name: metadataString(user, 'full_name', 'name'),
    avatarUrl: metadataString(user, 'avatar_url') ?? '',
    bio: metadataString(user, 'bio'),
    createdAt: user.created_at,
  }
}

function safeReturnTo(value: string | null | undefined): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export async function getSupabaseUser(): Promise<User | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    if (error.name === 'AuthSessionMissingError') return null
    throw error
  }
  return data.user ? toAppUser(data.user) : null
}

export async function signInWithGitHub(returnTo?: string): Promise<void> {
  if (!supabase) throw new Error('Supabase Auth is not configured.')

  sessionStorage.setItem(RETURN_TO_KEY, safeReturnTo(returnTo))
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      scopes: 'read:user',
    },
  })
  if (error) throw error
}

export function takeAuthReturnTo(): string {
  const returnTo = safeReturnTo(sessionStorage.getItem(RETURN_TO_KEY))
  sessionStorage.removeItem(RETURN_TO_KEY)
  return returnTo
}

export async function signOutSupabase(): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
