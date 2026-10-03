import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { LogOut, Menu, Plus, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { GitHubMark } from '@/components/GitHubMark'
import { UserAvatar } from '@/components/UserAvatar'
import { useSession } from '@/hooks/useSession'
import { frame, gutter, inset } from '@/components/frame'
import { BRAND_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'

const LINKS = [
  { to: '/models', label: 'Models' },
  { to: '/hardware', label: 'Hardware' },
  { to: '/runtimes', label: 'Runtimes' },
  { to: '/rigs', label: 'Rigs' },
]

function navClass({ isActive }: { isActive: boolean }) {
  return cn('rounded-md px-2.5 py-1.5 text-sm transition-colors hover:text-foreground', isActive ? 'text-foreground bg-muted' : 'text-muted-foreground')
}

export function TopNav() {
  const { user, loading, signOut, requestSignIn } = useSession()
  const [open, setOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => {
    if (!accountOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountOpen])

  async function handleSignOut() {
    setAccountOpen(false)
    try {
      await signOut()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out.')
    }
  }

  const submit = user ? (
    <Button render={<Link to="/submit" />} nativeButton={false}>
      <Plus data-icon="inline-start" /> Submit result
    </Button>
  ) : (
    <Button onClick={() => requestSignIn('/submit')}>
      <Plus data-icon="inline-start" /> Submit result
    </Button>
  )

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className={gutter}>
      <div className={cn(frame, inset, 'flex h-14 items-center gap-3')}>
        <Link to="/" className="flex items-center">
          <img src="/logos/intelinside-lockup.svg" alt={`${BRAND_NAME}.ai`} width={365} height={60} className="h-5 w-auto" />
        </Link>
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={navClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:flex">{submit}</div>
          {loading ? (
            <Skeleton className="size-8 rounded-full" />
          ) : user ? (
            <div className="relative flex" ref={accountMenuRef}>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((value) => !value)}
              >
                <UserAvatar user={user} />
              </Button>
              {accountOpen ? (
                <div
                  role="menu"
                  aria-label="Account"
                  className="absolute top-full right-0 z-50 mt-1 w-52 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
                >
                  <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
                  <div className="text-sm">{user.name ?? user.handle}</div>
                  <div className="text-xs font-normal text-muted-foreground">@{user.handle}</div>
                  </div>
                  <div className="-mx-1 my-1 h-px bg-border" />
                  <Link role="menuitem" to={`/u/${user.handle}`} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-accent" onClick={() => setAccountOpen(false)}>
                    <User className="size-4" /> Profile
                  </Link>
                  <Link role="menuitem" to={`/u/${user.handle}?tab=rigs`} className="flex rounded-md px-1.5 py-1 text-sm hover:bg-accent" onClick={() => setAccountOpen(false)}>My rigs</Link>
                  <Link role="menuitem" to={`/u/${user.handle}?tab=results`} className="flex rounded-md px-1.5 py-1 text-sm hover:bg-accent" onClick={() => setAccountOpen(false)}>My results</Link>
                  <Link role="menuitem" to="/settings/api-keys" className="flex rounded-md px-1.5 py-1 text-sm hover:bg-accent" onClick={() => setAccountOpen(false)}>API keys</Link>
                  <div className="-mx-1 my-1 h-px bg-border" />
                  <button role="menuitem" type="button" className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent" onClick={() => void handleSignOut()}>
                    <LogOut className="size-4" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Button variant="outline" onClick={() => requestSignIn(location.pathname)}>
              <GitHubMark data-icon="inline-start" className="size-4" /> Sign in
            </Button>
          )}
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
        </div>
      </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72">
          <SheetHeader>
            <SheetTitle>
              <img src="/logos/intelinside-lockup.svg" alt={`${BRAND_NAME}.ai`} width={365} height={60} className="h-5 w-auto" />
            </SheetTitle>
          </SheetHeader>
          <nav aria-label="Primary, mobile" className="flex flex-col gap-1 px-4">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} className={navClass} onClick={() => setOpen(false)}>
                {l.label}
              </NavLink>
            ))}
            <div className="mt-3" onClick={() => setOpen(false)}>
              {submit}
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  )
}
