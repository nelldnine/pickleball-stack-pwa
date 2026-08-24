import { useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { Handedness } from '../types/models'

export function PlayerRoster() {
  const players = useAppStore((s) => s.players)
  const games = useAppStore((s) => s.games)
  const addPlayer = useAppStore((s) => s.addPlayer)
  const setPlayerActive = useAppStore((s) => s.setPlayerActive)
  const removePlayer = useAppStore((s) => s.removePlayer)

  const [name, setName] = useState('')
  const [handedness, setHandedness] = useState<Handedness>('right')

  // Removing someone who is mid-game would leave their scoreboard showing "?",
  // so those rows are locked until the game finishes.
  const playingNowIds = useMemo(
    () => new Set(games.filter((g) => g.status === 'live').flatMap((g) => g.playerIds)),
    [games],
  )

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    addPlayer(name, handedness)
    setName('')
    setHandedness('right')
  }

  const activeCount = players.filter((p) => p.active).length

  return (
    <section aria-labelledby="roster-heading" className="flex flex-col gap-5 pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="roster-heading" className="readout text-xl font-semibold">
          Players
        </h2>
        {players.length > 0 && (
          <span className="label text-[0.6rem] text-muted">
            {activeCount} of {players.length} in
          </span>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          <input
            id="player-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add a player"
            aria-label="Player name"
            className="flex-1 min-w-0 min-h-11 rounded-xl border border-line bg-surface px-3.5 text-base placeholder:text-faint focus:outline-none focus:border-court"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="min-h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-paper disabled:opacity-25"
          >
            Add
          </button>
        </div>
        {/* Handedness only matters for stacking, so it stays a quiet secondary control. */}
        <div className="flex items-center gap-2">
          <span className="label text-[0.58rem] text-faint">Paddle hand</span>
          <div className="flex rounded-lg border border-line overflow-hidden">
            {(['right', 'left'] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHandedness(h)}
                aria-pressed={handedness === h}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  handedness === h ? 'bg-ink text-paper' : 'bg-surface text-muted'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </form>

      {players.length === 0 ? (
        <p className="text-sm text-muted">No players yet — add your group above.</p>
      ) : (
        <ul className="flex flex-col">
          {players.map((p) => {
            const onCourt = playingNowIds.has(p.id)
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 border-b border-line py-2 last:border-0"
              >
                {/* The row itself toggles availability — the biggest target for the most common action. */}
                <button
                  type="button"
                  onClick={() => setPlayerActive(p.id, !p.active)}
                  aria-pressed={p.active}
                  className="flex flex-1 min-w-0 items-center gap-3 min-h-11 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={`h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                      p.active ? 'bg-court border-court' : 'border-line-strong'
                    }`}
                  >
                    {p.active && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={`truncate ${p.active ? 'font-medium text-ink' : 'text-faint'}`}>{p.name}</span>
                    {/* Right-handed is the default — printing it on every row is noise.
                        Only the exception is worth ink, because only it changes stacking. */}
                    {p.handedness === 'left' && (
                      <span className="label text-[0.55rem] text-court shrink-0">Lefty</span>
                    )}
                    {onCourt && <span className="label text-[0.55rem] text-flare shrink-0">On court</span>}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => removePlayer(p.id)}
                  disabled={onCourt}
                  aria-label={onCourt ? `${p.name} is in a live game and cannot be removed` : `Remove ${p.name}`}
                  className="min-h-11 w-9 shrink-0 rounded-lg text-faint active:text-danger disabled:opacity-20 flex items-center justify-center"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
