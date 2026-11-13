import type { Api } from './api/types'
import { mockApi } from './api/mock'
import { supabaseApi } from './api/supabase'

// Supabase is the hosted backend. Without it, the app runs on generated mock data.
export const api: Api = import.meta.env.VITE_API_MODE === 'supabase' ? supabaseApi : mockApi
export * from './api/types'
