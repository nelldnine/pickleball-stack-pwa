import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { computeStats, sessionGames } from '../lib/stats'
import { pickNextPlayers, rankedTeamSplits } from '../lib/fairness'
import type { SidePreference } from '../types/models'

export function NextRoundPanel({
  heading = 'Next Round',
  onGameStarted,
}: {
  heading?: string
  onGameStarted: (gameId: string) => void
}) {
  const players = useAppStore((s) => s.players)
  const games = useAppStore((s) => s.games)
  const seasonStartedAt = useAppStore((s) => s.seasonStartedAt)
  const courtCount = useAppStore((s) => s.courtCount)
  const setCourtCount = useAppStore((s) => s.setCourtCount)
  const startGame = useAppStore((s) => s.startGame)

  const isPrimaryPanel = heading === 'Next Round'

  const liveGames = useMemo(() => games.filter((g) => g.status === 'live'), [games])
  const busyPlayerIds = useMemo(() => new Set(liveGames.flatMap((g) => g.playerIds)), [liveGames])
  const busyCourts = useMemo(() => new Set(liveGames.map((g) => g.court ?? 1)), [liveGames])
  const availableCourts = useMemo(
    () => Array.from({ length: courtCount }, (_, i) => i + 1).filter((c) => !busyCourts.has(c)),
    [courtCount, busyCourts],
  )

  const [selectedCourt, setSelectedCourt] = useState(1)
  useEffect(() => {
    if (!availableCourts.includes(selectedCourt)) {
      setSelectedCourt(availableCourts[0] ?? 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCourts.join(',')])

  const activePlayers = useMemo(
    () => players.filter((p) => p.active && !busyPlayerIds.has(p.id)),
    [players, busyPlayerIds],
  )
  const relevantGames = useMemo(() => sessionGames(games, seasonStartedAt), [games, seasonStartedAt])
  const stats = useMemo(() => computeStats(players, relevantGames), [players, relevantGames])

  const suggestedFour = useMemo(
    () => pickNextPlayers(activePlayers, stats, Math.min(4, activePlayers.length)),
    [activePlayers, stats],
  )

  const [selected, setSelected] = useState<string[]>(suggestedFour)
  const [stackingEnabled, setStackingEnabled] = useState(false)
  const [sides, setSides] = useState<Record<string, SidePreference>>({})
  const [lockedTogether, setLockedTogether] = useState<string[]>([])
  const [splitIndex, setSplitIndex] = useState(0)

  // Auto-populate with the fairness engine's pick the moment a fresh 4 becomes available.
  useEffect(() => {
    if (selected.length === 0 && suggestedFour.length === 4) {
      setSelected(suggestedFour)
    }
    // Only ever auto-fill an empty selection — never override a manual choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedFour])

  // Drop anyone from the selection who just got picked up onto another court.
  useEffect(() => {
    setSelected((cur) => cur.filter((id) => !busyPlayerIds.has(id)))
    setLockedTogether((cur) => cur.filter((id) => !busyPlayerIds.has(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyPlayerIds])

  const canPick = selected.length === 4

  const lockedPairs: [string, string][] =
    lockedTogether.length === 2 ? [[lockedTogether[0], lockedTogether[1]]] : []

  const splits = useMemo(
    () => (canPick ? rankedTeamSplits(selected, stats, lockedPairs) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canPick, selected.join(','), lockedTogether.join(','), stats],
  )

  const teams = splits[splitIndex % Math.max(splits.length, 1)] ?? null

  useEffect(() => {
    setSplitIndex(0)
  }, [selected.join(','), lockedTogether.join(',')])

  const toggleSelected = (id: string) => {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= 4) return cur
      return [...cur, id]
    })
    setLockedTogether((cur) => cur.filter((x) => x !== id))
  }

  const toggleLocked = (id: string) => {
    setLockedTogether((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= 2) return [cur[1], id]
      return [...cur, id]
    })
  }

  const swapPlayer = (playerId: string) => {
    if (!teams) return
    const onTeamA = teams.teamA.includes(playerId)
    const otherTeamPartner = onTeamA ? teams.teamB[0] : teams.teamA[0]
    // Lock this player with a player from the other team so the ranked split puts them together.
    setLockedTogether([playerId, otherTeamPartner])
    setSplitIndex(0)
  }

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?'

  const noCourtsFree = courtCount > 0 && availableCourts.length === 0

  const handleStart = async () => {
    if (!teams || noCourtsFree) return
    const id = await startGame(teams, stackingEnabled, sides, selectedCourt)
    onGameStarted(id)
  }

  return (
    <section aria-labelledby="teams-heading" className="flex flex-col gap-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="teams-heading" className="text-lg font-semibold text-text">
          {heading}
        </h2>
        {isPrimaryPanel && <CourtCountStepper count={courtCount} onChange={setCourtCount} />}
      </div>

      {courtCount > 1 && (
        <div>
          <p className="text-xs text-text-soft mb-2">Which court is this for?</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Court">
            {Array.from({ length: courtCount }, (_, i) => i + 1).map((court) => {
              const busy = busyCourts.has(court)
              return (
                <button
                  key={court}
                  type="button"
                  onClick={() => !busy && setSelectedCourt(court)}
                  disabled={busy}
                  aria-pressed={selectedCourt === court}
                  className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                    busy
                      ? 'border-border text-text-soft/40 line-through'
                      : selectedCourt === court
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-border text-text-soft'
                  }`}
                >
                  Court {court}
                  {busy && ' · in use'}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {noCourtsFree ? (
        <p className="text-sm text-text-soft">All courts are in use. Finish a game to free one up.</p>
      ) : activePlayers.length < 4 ? (
        <p className="text-sm text-text-soft">
          Mark at least 4 available players as "Playing" on the Players tab to start a game.
        </p>
      ) : (
        <>
          {teams && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-soft">Auto-picked to keep court time fair and avoid repeat pairings.</p>
              <div className="grid grid-cols-2 gap-3">
                <TeamCard label="Team A" playerIds={teams.teamA} nameOf={nameOf} onSwap={swapPlayer} />
                <TeamCard label="Team B" playerIds={teams.teamB} nameOf={nameOf} onSwap={swapPlayer} />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSplitIndex((i) => i + 1)}
                  disabled={splits.length < 2}
                  className="min-h-11 flex-1 rounded-lg border border-border px-4 text-sm font-medium text-text disabled:opacity-40"
                >
                  Try another pairing
                </button>
              </div>
              <p className="text-xs text-text-soft">Tap a player to swap them to the other team.</p>

              <label className="flex items-center gap-2 text-sm text-text-soft">
                <input
                  type="checkbox"
                  checked={stackingEnabled}
                  onChange={(e) => setStackingEnabled(e.target.checked)}
                  className="h-5 w-5 accent-accent"
                />
                Enable stacking
              </label>

              {stackingEnabled && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
                  {[...teams.teamA, ...teams.teamB].map((id) => (
                    <div key={id} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-text">{nameOf(id)}</span>
                      <select
                        value={sides[id] ?? 'flexible'}
                        onChange={(e) => setSides((cur) => ({ ...cur, [id]: e.target.value as SidePreference }))}
                        className="min-h-11 rounded-lg border border-border bg-surface-sunken px-2 text-sm text-text"
                      >
                        <option value="flexible">Flexible</option>
                        <option value="deuce">Deuce side</option>
                        <option value="ad">Ad side</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={handleStart}
                className="min-h-11 rounded-lg bg-accent px-4 text-base font-semibold text-accent-ink active:opacity-85"
              >
                Start Game{courtCount > 1 ? ` on Court ${selectedCourt}` : ''}
              </button>
            </div>
          )}

          <details className="text-sm text-text-soft">
            <summary className="cursor-pointer select-none py-2 font-medium text-text">Swap in different players</summary>
            <div className="flex flex-col gap-3 pt-2">
              <ul className="flex flex-wrap gap-2">
                {activePlayers.map((p) => {
                  const isSelected = selected.includes(p.id)
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => toggleSelected(p.id)}
                        aria-pressed={isSelected}
                        className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                          isSelected ? 'border-accent bg-accent text-accent-ink' : 'border-border text-text-soft'
                        }`}
                      >
                        {p.name}
                      </button>
                    </li>
                  )
                })}
              </ul>

              {canPick && (
                <div>
                  <p className="text-xs text-text-soft mb-2">
                    Optional: pick up to 2 players to keep on the same team (e.g. a couple).
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {selected.map((id) => {
                      const isLocked = lockedTogether.includes(id)
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => toggleLocked(id)}
                            aria-pressed={isLocked}
                            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                              isLocked ? 'border-text bg-text text-bg' : 'border-border text-text-soft'
                            }`}
                          >
                            {nameOf(id)}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  )
}

function CourtCountStepper({ count, onChange }: { count: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-border pl-3 pr-1 py-1" role="group" aria-label="Number of courts">
      <span className="text-xs text-text-soft">Courts</span>
      <button
        type="button"
        onClick={() => onChange(count - 1)}
        disabled={count <= 1}
        aria-label="Fewer courts"
        className="min-h-8 min-w-8 rounded-full text-text disabled:opacity-30 active:bg-surface-sunken"
      >
        −
      </button>
      <span className="w-4 text-center text-sm font-semibold tabular-nums text-text">{count}</span>
      <button
        type="button"
        onClick={() => onChange(count + 1)}
        disabled={count >= 6}
        aria-label="More courts"
        className="min-h-8 min-w-8 rounded-full text-text disabled:opacity-30 active:bg-surface-sunken"
      >
        +
      </button>
    </div>
  )
}

function TeamCard({
  label,
  playerIds,
  nameOf,
  onSwap,
}: {
  label: string
  playerIds: [string, string]
  nameOf: (id: string) => string
  onSwap: (id: string) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-soft mb-2">{label}</h3>
      <div className="flex flex-col gap-1">
        {playerIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onSwap(id)}
            className="min-h-11 rounded-md text-left px-2 text-base text-text active:bg-surface-sunken"
          >
            {nameOf(id)}
          </button>
        ))}
      </div>
    </div>
  )
}
