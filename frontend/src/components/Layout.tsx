import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Boxes, Menu } from 'lucide-react'

import { ProgressBar } from '@/components/ProgressBar'
import { SyncStatus } from '@/components/SyncStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useProgressContext } from '@/context/ProgressContext'
import { cn } from '@/lib/utils'

/** Total SKUs in scope (Forage active set) — used when live data is absent. */
const TOTAL_FALLBACK = 460

const NAV_LINKS = [
  { to: '/', label: 'Capture', end: true },
  { to: '/progress', label: 'Progress', end: false },
  { to: '/review', label: 'Review', end: false },
] as const

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-secondary text-secondary-foreground'
      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
  )
}

function ProgressBadge() {
  const { progress } = useProgressContext()
  const captured = progress ? progress.captured : '—'
  const total = progress ? progress.total : TOTAL_FALLBACK
  return (
    <Badge variant="outline" className="tabular-nums" aria-label="capture progress">
      {captured}/{total}
    </Badge>
  )
}

function HeaderProgressBar() {
  const { progress } = useProgressContext()
  return (
    <ProgressBar
      captured={progress?.captured ?? 0}
      total={progress?.total ?? TOTAL_FALLBACK}
    />
  )
}

export function Layout() {
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <Boxes className="size-5 text-primary" />
            <span className="hidden sm:inline">Dim Capture</span>
          </NavLink>

          {/* Desktop nav */}
          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navLinkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <SyncStatus />
            <ProgressBadge />

            {/* Mobile nav */}
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Boxes className="size-5 text-primary" />
                    Dim Capture
                  </SheetTitle>
                </SheetHeader>
                <nav className="mt-4 flex flex-col gap-1">
                  {NAV_LINKS.map((link) => (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      end={link.end}
                      className={navLinkClass}
                      onClick={() => setNavOpen(false)}
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
        <HeaderProgressBar />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
