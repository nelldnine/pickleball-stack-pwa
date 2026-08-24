import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { PlayerRoster } from './components/PlayerRoster'
import { NextRoundPanel } from './components/NextRoundPanel'
import { Scoreboard } from './components/Scoreboard'
import { History } from './components/History'

type Tab = 'players' | 'teams' | 'game' | 'history'

function App() {
  const load = useAppStore((s) => s.load)
  const loaded = useAppStore((s) => s.loaded)
  const games = useAppStore((s) => s.games)

  const [tab, setTab] = useState<Tab>('players')

  const liveGames = useMemo(
    () => [...games].filter((g) => g.status === 'live').sort((a, b) => (a.court ?? 1) - (b.court ?? 1)),
    [games],
  )

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
      <div className="min-h-full flex items-center justify-center bg-bg">
        <p className="text-sm text-text-soft">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col bg-bg text-text">
      <header className="px-4 pt-[max(1.1rem,env(safe-area-inset-top))] pb-3">
        <h1 className="text-[0.9rem] font-semibold tracking-tight text-text">
          Pickleball <span className="text-text-soft font-normal">Stacking</span>
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-28">
        {tab === 'players' && <PlayerRoster />}
        {tab === 'teams' && <NextRoundPanel onGameStarted={() => setTab('game')} />}
        {tab === 'game' &&
          (liveGames.length > 0 ? (
            <div className="flex flex-col gap-8 pt-2">
              {liveGames.map((g) => (
                <div key={g.id} className="flex flex-col gap-3">
                  {liveGames.length > 1 && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-soft">Court {g.court ?? 1}</p>
                  )}
                  <Scoreboard gameId={g.id} onFinished={() => (liveGames.length <= 1 ? setTab('history') : undefined)} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-soft pt-2">No live game. Head to the Next Round tab to start one.</p>
          ))}
        {tab === 'history' && <History onGameStarted={() => setTab('game')} />}
      </main>

      <nav
        aria-label="Sections"
        className="fixed bottom-0 inset-x-0 grid grid-cols-4 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      >
        <TabButton label="Players" icon={<IconUser />} active={tab === 'players'} onClick={() => setTab('players')} />
        <TabButton label="Next Round" icon={<IconShuffle />} active={tab === 'teams'} onClick={() => setTab('teams')} />
        <TabButton
          label="Game"
          icon={<IconTarget />}
          active={tab === 'game'}
          onClick={() => setTab('game')}
          badge={liveGames.length > 0}
        />
        <TabButton label="History" icon={<IconClock />} active={tab === 'history'} onClick={() => setTab('history')} />
      </nav>
    </div>
  )
}

function TabButton({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  badge?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative min-h-11 py-2.5 flex flex-col items-center justify-center gap-1 text-[0.68rem] font-medium ${
        active ? 'text-accent' : 'text-text-soft'
      }`}
    >
      {icon}
      {label}
      {badge && <span aria-hidden="true" className="absolute top-1.5 right-1/2 translate-x-4 h-1.5 w-1.5 rounded-full bg-accent" />}
    </button>
  )
}

function iconProps() {
  return { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
}

function IconUser() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
    </svg>
  )
}

function IconShuffle() {
  return (
    <svg {...iconProps()}>
      <path d="M3 6h3.5c1.5 0 2.4.7 3.2 1.9l5 7.2c.8 1.2 1.7 1.9 3.2 1.9H21" />
      <path d="M17.5 5.5 21 6l-.5 3.5" />
      <path d="M3 18h3.5c1.5 0 2.4-.7 3.2-1.9" />
      <path d="M17.5 18.5 21 18l-.5-3.5" />
    </svg>
  )
}

function IconTarget() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

export default App
