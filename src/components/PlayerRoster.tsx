import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { Handedness } from '../types/models'

export function PlayerRoster() {
  const players = useAppStore((s) => s.players)
  const addPlayer = useAppStore((s) => s.addPlayer)
  const setPlayerActive = useAppStore((s) => s.setPlayerActive)
  const removePlayer = useAppStore((s) => s.removePlayer)

  const [name, setName] = useState('')
  const [handedness, setHandedness] = useState<Handedness>('right')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    addPlayer(name, handedness)
    setName('')
  }

  return (
    <section aria-labelledby="roster-heading" className="flex flex-col gap-4 pt-2">
      <h2 id="roster-heading" className="text-lg font-semibold text-text">
        Players
      </h2>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="player-name" className="block text-sm text-text-soft mb-1">
            Name
          </label>
          <input
            id="player-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add a player"
            className="w-full min-h-11 rounded-lg border border-border bg-surface px-3 text-base text-text placeholder:text-text-soft focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="player-hand" className="block text-sm text-text-soft mb-1">
            Hand
          </label>
          <select
            id="player-hand"
            value={handedness}
            onChange={(e) => setHandedness(e.target.value as Handedness)}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-base text-text focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
          >
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </div>
        <button
          type="submit"
          className="min-h-11 min-w-11 rounded-lg bg-accent px-4 text-base font-medium text-accent-ink active:opacity-85"
        >
          Add
        </button>
      </form>

      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface overflow-hidden">
        {players.length === 0 && <li className="px-3 py-3 text-sm text-text-soft">No players yet — add your group above.</li>}
        {players.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-text truncate">{p.name}</span>
              <span className="text-xs text-text-soft shrink-0">{p.handedness}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-2 text-sm text-text-soft">
                <input
                  type="checkbox"
                  checked={p.active}
                  onChange={(e) => setPlayerActive(p.id, e.target.checked)}
                  className="h-5 w-5 accent-accent"
                  aria-label={`${p.name} available to play`}
                />
                Playing
              </label>
              <button
                type="button"
                onClick={() => removePlayer(p.id)}
                aria-label={`Remove ${p.name}`}
                className="min-h-11 min-w-11 rounded-lg text-danger active:bg-danger/10 text-sm"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
