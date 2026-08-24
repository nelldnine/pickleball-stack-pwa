import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { PlayerRoster } from './components/PlayerRoster'
import { NextRoundPanel } from './components/NextRoundPanel'
import { Scoreboard } from './components/Scoreboard'
import { History } from './components/History'
import { useTheme, type ThemeMode } from './lib/theme'

type Tab = 'players' | 'teams' | 'game' | 'history'

function App() {
  const load = useAppStore((s) => s.load)
  const loaded = useAppStore((s) => s.loaded)
  const games = useAppStore((s) => s.games)
  const players = useAppStore((s) => s.players)
  const courtCount = useAppStore((s) => s.courtCount)

  const [tab, setTab] = useState<Tab>('players')

  const liveGames = useMemo(
    () => [...games].filter((g) => g.status === 'live').sort((a, b) => (a.court ?? 1) - (b.court ?? 1)),
    [games],
  )
  const availableCount = useMemo(() => {
    const busy = new Set(liveGames.flatMap((g) => g.playerIds))
    return players.filter((p) => p.active && !busy.has(p.id)).length
  }, [players, liveGames])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (liveGames.length > 0) setTab('game')
    // Only jump to the Game tab the moment a court goes live — don't fight manual navigation afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveGames.length])

  if (!loaded) {
    return (
      <div className="min-h-full flex items-center justify-center bg-paper">
        <p className="label text-xs text-muted">Loading</p>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col bg-paper text-ink">
      {/* A title bar that only repeats the app name earns nothing on a phone.
          This one reports the state of the session, and spends its left edge on a
          control rather than on the word "Stacking". */}
      <header className="px-5 pt-[max(0.7rem,env(safe-area-inset-top))] pb-2.5 flex items-center justify-between gap-3">
        <ThemeToggle />
        <span className="label text-[0.65rem] text-muted flex items-center gap-2.5">
          {liveGames.length > 0 && (
            <span className="flex items-center gap-1.5 text-flare">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-flare" />
              {liveGames.length} on court
            </span>
          )}
          <span>
            {availableCount} free
            {courtCount > 1 && ` · ${courtCount} courts`}
          </span>
        </span>
      </header>

      <main className="flex-1 overflow-y-auto px-5 pb-28">
        {tab === 'players' && <PlayerRoster />}
        {tab === 'teams' && <NextRoundPanel onGameStarted={() => setTab('game')} />}
        {tab === 'game' &&
          (liveGames.length > 0 ? (
            <div className="flex flex-col gap-9 pt-1">
              {liveGames.map((g) => (
                <Scoreboard
                  key={g.id}
                  gameId={g.id}
                  showCourtLabel={liveGames.length > 1}
                  onFinished={() => (liveGames.length <= 1 ? setTab('history') : undefined)}
                />
              ))}
            </div>
          ) : (
            <EmptyGame onGoToNext={() => setTab('teams')} />
          ))}
        {tab === 'history' && <History onGameStarted={() => setTab('game')} />}
      </main>

      <nav
        aria-label="Sections"
        className="fixed bottom-0 inset-x-0 grid grid-cols-4 border-t border-line bg-surface/92 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      >
        <TabButton label="Players" icon={<IconRoster />} active={tab === 'players'} onClick={() => setTab('players')} />
        <TabButton label="Next" icon={<IconShuffle />} active={tab === 'teams'} onClick={() => setTab('teams')} />
        <TabButton
          label="Game"
          icon={<IconCourt />}
          active={tab === 'game'}
          onClick={() => setTab('game')}
          live={liveGames.length > 0}
        />
        <TabButton label="Ledger" icon={<IconLedger />} active={tab === 'history'} onClick={() => setTab('history')} />
      </nav>
    </div>
  )
}

/**
 * Cycles system → light → dark. "System" is a real option, not an implementation
 * detail: most people want the app to follow their phone, and silently pinning a
 * theme the first time someone taps would take that away.
 */
const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark']
const THEME_COPY: Record<ThemeMode, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
}

function ThemeToggle() {
  const { mode, setTheme } = useTheme()
  const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length]

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Theme: ${THEME_COPY[mode]}`}
      aria-label={`Theme: ${THEME_COPY[mode]}. Switch to ${THEME_COPY[next].toLowerCase()}.`}
      className="-ml-1.5 h-8 w-8 rounded-lg flex items-center justify-center text-muted active:bg-sunken transition-colors"
    >
      {mode === 'system' ? <IconAuto /> : mode === 'light' ? <IconSun /> : <IconMoon />}
    </button>
  )
}

function IconSun() {
  return (
    <svg {...svg} width="17" height="17">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg {...svg} width="17" height="17">
      <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4a8.3 8.3 0 1 0 10.5 10.5z" />
    </svg>
  )
}

/* Half-filled disc: the app is taking its cue from the device. */
function IconAuto() {
  return (
    <svg {...svg} width="17" height="17">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function EmptyGame({ onGoToNext }: { onGoToNext: () => void }) {
  return (
    <div className="pt-16 flex flex-col items-center text-center gap-3">
      <p className="readout text-lg text-ink">No game on court</p>
      <p className="text-sm text-muted max-w-[16rem]">Pick the next four and start a game to begin scoring.</p>
      <button
        type="button"
        onClick={onGoToNext}
        className="mt-1 min-h-11 rounded-full bg-ink px-5 text-sm font-medium text-paper"
      >
        Set up next round
      </button>
    </div>
  )
}

function TabButton({
  label,
  icon,
  active,
  onClick,
  live,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  live?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative min-h-11 pt-2.5 pb-2 flex flex-col items-center justify-center gap-1 transition-colors ${
        active ? 'text-ink' : 'text-faint'
      }`}
    >
      <span className="relative">
        {icon}
        {live && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-1.5 h-1.5 w-1.5 rounded-full bg-flare ring-2 ring-surface"
          />
        )}
      </span>
      <span className="label text-[0.58rem]">{label}</span>
      {active && <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 rounded-full bg-flare" />}
    </button>
  )
}

const svg = {
  width: 21,
  height: 21,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function IconRoster() {
  return (
    <svg {...svg}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19.5c1-3 3.2-4.6 5.5-4.6s4.5 1.6 5.5 4.6" />
      <path d="M16.5 7.5h4M16.5 11.5h4" />
    </svg>
  )
}

/* Two paddles crossing — the "who pairs with whom" decision. */
function IconShuffle() {
  return (
    <svg {...svg}>
      <path d="M4 5h2.6c1.3 0 2 .6 2.7 1.7l4.4 6.6c.7 1.1 1.4 1.7 2.7 1.7H20" />
      <path d="M17.2 12.6 20 15l-2.8 2.4" />
      <path d="M4 19h2.6c1.3 0 2-.6 2.7-1.7l.6-.9" />
      <path d="M13.4 8.1l.6-.9C14.7 6.1 15.4 5.5 16.7 5.5H20" />
      <path d="M17.2 3.1 20 5.5l-2.8 2.4" />
    </svg>
  )
}

/* The court itself: centre line and non-volley zone. */
function IconCourt() {
  return (
    <svg {...svg}>
      <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
      <path d="M4 12h16" />
      <path d="M12 3.5v3.2M12 17.3v3.2" />
      <path d="M4 8.4h16M4 15.6h16" opacity="0.45" />
    </svg>
  )
}

/* Stacked bars — the fairness ledger this tab is named for. */
function IconLedger() {
  return (
    <svg {...svg}>
      <path d="M4 6.5h13M4 12h9M4 17.5h15" />
    </svg>
  )
}

export default App
