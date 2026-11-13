/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'mock' | 'supabase'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Mock mode only: 'true' starts with no rigs or results, so every empty state is reachable. */
  readonly VITE_MOCK_EMPTY?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
