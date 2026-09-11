import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { computeStats, sessionGames } from '../lib/stats'
import { pickNextPlayers, teamSplitsFor, type PairingMode } from '../lib/fairness'
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
  const availableCourtsKey = availableCourts.join(',')
  useEffect(() => {
    if (!availableCourts.includes(selectedCourt)) {
      setSelectedCourt(availableCourts[0] ?? 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCourtsKey])

  const activePlayers = useMemo(
    () => players.filter((p) => p.active && !busyPlayerIds.has(p.id)),
    [players, busyPlayerIds],
  )
  const relevantGames = useMemo(() => sessionGames(games, seasonStartedAt), [games, seasonStartedAt])
  const stats = useMemo(() => computeStats(players, relevantGames), [players, relevantGames])

  // Seeded on the standings boundary so a level roster is dealt in a different order
  // each new session, instead of always starting from the top of the Players tab.
  const suggestedFour = useMemo(
    () => pickNextPlayers(activePlayers, stats, Math.min(4, activePlayers.length), seasonStartedAt ?? 0),
    [activePlayers, stats, seasonStartedAt],
  )

  const [selected, setSelected] = useState<string[]>(suggestedFour)
  const [pairingMode, setPairingMode] = useState<PairingMode>('fair')
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

  // Compare these lists by value, not by array identity — they are rebuilt on every render.
  const selectedKey = selected.join(',')
  const lockedKey = lockedTogether.join(',')

  const splits = useMemo(
    () => (canPick ? teamSplitsFor(pairingMode, selected, stats, lockedPairs) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canPick, selectedKey, lockedKey, stats, pairingMode],
  )

  const teams = splits[splitIndex % Math.max(splits.length, 1)] ?? null

  useEffect(() => {
    setSplitIndex(0)
  }, [selectedKey, lockedKey, pairingMode])

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

  // An auto-pick people can't interrogate is an auto-pick people override — so mark who
  // is most owed a game. But only when it actually distinguishes someone: if all four are
  // level, the same badge on every row explains nothing and is just noise. The line under
  // the matchup already states the general rule.
  const gamesSpread = useMemo(() => {
    const counts = selected.map((id) => stats[id]?.gamesPlayed ?? 0)
    if (counts.length === 0) return null
    const min = Math.min(...counts)
    return Math.max(...counts) > min ? { min } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, stats])

  // Stacking by record can only mean something once somebody has a record. Until then
  // every split is equally stacked, the repeat-pairing score picks one, and printing
  // "0-0" four times would dress that up as a ranking it isn't.
  const hasRecords = useMemo(
    () => selected.some((id) => (stats[id]?.wins ?? 0) + (stats[id]?.losses ?? 0) > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKey, stats],
  )

  const metaOf = (id: string): { text: string; accent: boolean } | null => {
    if (pairingMode === 'record') {
      if (!hasRecords) return null
      const s = stats[id]
      return { text: `${s?.wins ?? 0}-${s?.losses ?? 0}`, accent: false }
    }
    if (!gamesSpread) return null
    return (stats[id]?.gamesPlayed ?? 0) === gamesSpread.min ? { text: 'most owed', accent: true } : null
  }

  const noCourtsFree = courtCount > 0 && availableCourts.length === 0

  const handleStart = async () => {
    if (!teams || noCourtsFree) return
    const id = await startGame(teams, stackingEnabled, sides, selectedCourt)
    onGameStarted(id)
  }


  return (
    <section aria-labelledby="teams-heading" className="flex flex-col gap-5 pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="teams-heading" className="readout text-xl font-semibold">
          {heading}
        </h2>
        {isPrimaryPanel && <CourtCountStepper count={courtCount} onChange={setCourtCount} />}
      </div>

      {courtCount > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Court">
          {Array.from({ length: courtCount }, (_, i) => i + 1).map((court) => {
            const busy = busyCourts.has(court)
            const isSelected = selectedCourt === court && !busy
            return (
              <button
                key={court}
                type="button"
                onClick={() => !busy && setSelectedCourt(court)}
                disabled={busy}
                aria-pressed={isSelected}
                className={`min-h-9 rounded-lg border px-3 label text-[0.58rem] transition-colors ${
                  busy
                    ? 'border-line text-faint'
                    : isSelected
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line bg-surface text-muted'
                }`}
              >
                Court {court}
                {busy && ' · busy'}
              </button>
            )
          })}
        </div>
      )}

      {noCourtsFree ? (
        <p className="text-sm text-muted">All courts are in use. Finish a game to free one up.</p>
      ) : activePlayers.length < 4 ? (
        <p className="text-sm text-muted">
          Mark at least four available players as in on the Players tab to start a game.
        </p>
      ) : (
        <>
          {teams && (
            <div className="flex flex-col gap-4">
              <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="How to split the teams">
                {([
                  ['fair', 'Fair rotation'],
                  ['record', 'By record'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPairingMode(mode)}
                    aria-pressed={pairingMode === mode}
                    className={`flex-1 min-h-9 rounded-md label text-[0.58rem] transition-colors ${
                      pairingMode === mode ? 'bg-ink text-paper' : 'text-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* The matchup, not two unrelated cards: one panel split by a hairline
                  with the versus mark sitting on the seam. */}
              <div className="rounded-2xl border border-line bg-surface overflow-hidden">
                <div className="relative grid grid-cols-2">
                  <TeamColumn playerIds={teams.teamA} nameOf={nameOf} metaOf={metaOf} onSwap={swapPlayer} align="left" />
                  <span aria-hidden="true" className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-line" />
                  <span
                    aria-hidden="true"
                    className="label absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface px-1.5 py-0.5 text-[0.5rem] text-faint"
                  >
                    vs
                  </span>
                  <TeamColumn playerIds={teams.teamB} nameOf={nameOf} metaOf={metaOf} onSwap={swapPlayer} align="right" />
                </div>
                <button
                  type="button"
                  onClick={() => setSplitIndex((i) => i + 1)}
                  disabled={splits.length < 2}
                  className="w-full min-h-11 border-t border-line label text-[0.58rem] text-muted disabled:opacity-30"
                >
                  Try another pairing
                </button>
              </div>

              <p className="text-xs text-muted -mt-1">
                {pairingMode === 'record'
                  ? hasRecords
                    ? 'Still the four most owed court time, split strongest with strongest. Tap a name to move them across.'
                    : 'No finished games yet, so this splits the same as fair rotation. Tap a name to move them across.'
                  : 'Picked to even out court time. Tap a name to move them across.'}
              </p>

              <div>
                <label className="flex items-center gap-2.5 min-h-11 text-sm">
                  <input
                    type="checkbox"
                    checked={stackingEnabled}
                    onChange={(e) => setStackingEnabled(e.target.checked)}
                    className="h-4.5 w-4.5 accent-court"
                  />
                  <span className="text-muted">Stack sides</span>
                </label>

                {stackingEnabled && (
                  <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface mt-1">
                    {[...teams.teamA, ...teams.teamB].map((id) => (
                      <div key={id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="text-sm truncate">{nameOf(id)}</span>
                        <select
                          value={sides[id] ?? 'flexible'}
                          onChange={(e) => setSides((cur) => ({ ...cur, [id]: e.target.value as SidePreference }))}
                          aria-label={`Preferred side for ${nameOf(id)}`}
                          className="min-h-9 rounded-lg border border-line bg-paper px-2 text-xs"
                        >
                          <option value="flexible">Flexible</option>
                          <option value="deuce">Deuce</option>
                          <option value="ad">Ad</option>
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleStart}
                className="min-h-13 rounded-xl bg-flare px-4 py-3.5 text-base font-semibold text-flare-ink active:opacity-90 transition-opacity"
              >
                Start game{courtCount > 1 ? ` · court ${selectedCourt}` : ''}
              </button>
            </div>
          )}

          <details className="group">
            <summary className="cursor-pointer select-none list-none min-h-11 flex items-center label text-[0.58rem] text-muted">
              Change who's playing
            </summary>
            <div className="flex flex-col gap-4 pt-1">
              <div>
                <p className="text-xs text-muted mb-2">Pick any four. Longest waiting are suggested first.</p>
                <ul className="flex flex-wrap gap-1.5">
                  {activePlayers.map((p) => {
                    const isSelected = selected.includes(p.id)
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => toggleSelected(p.id)}
                          aria-pressed={isSelected}
                          className={`min-h-10 rounded-full border px-3.5 text-sm transition-colors ${
                            isSelected
                              ? 'border-court bg-court text-white font-medium'
                              : 'border-line bg-surface text-muted'
                          }`}
                        >
                          {p.name}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {canPick && (
                <div>
                  <p className="text-xs text-muted mb-2">
                    Keep two together on the same team — partners, or a couple.
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {selected.map((id) => {
                      const isLocked = lockedTogether.includes(id)
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => toggleLocked(id)}
                            aria-pressed={isLocked}
                            className={`min-h-10 rounded-full border px-3.5 text-sm transition-colors ${
                              isLocked ? 'border-ink bg-ink text-paper font-medium' : 'border-line bg-surface text-muted'
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
    <div className="flex items-center gap-1.5" role="group" aria-label="Number of courts">
      <span className="label text-[0.55rem] text-faint">Courts</span>
      <div className="flex items-center rounded-lg border border-line bg-surface px-0.5">
        <button
          type="button"
          onClick={() => onChange(count - 1)}
          disabled={count <= 1}
          aria-label="Fewer courts"
          className="h-8 w-7 text-muted disabled:opacity-25"
        >
          −
        </button>
        <span className="readout w-4 text-center text-xs font-semibold">{count}</span>
        <button
          type="button"
          onClick={() => onChange(count + 1)}
          disabled={count >= 6}
          aria-label="More courts"
          className="h-8 w-7 text-muted disabled:opacity-25"
        >
          +
        </button>
      </div>
    </div>
  )
}

function TeamColumn({
  playerIds,
  nameOf,
  metaOf,
  onSwap,
  align,
}: {
  playerIds: [string, string]
  nameOf: (id: string) => string
  metaOf: (id: string) => { text: string; accent: boolean } | null
  onSwap: (id: string) => void
  align: 'left' | 'right'
}) {
  return (
    <div className={`flex flex-col py-1 ${align === 'right' ? 'items-end text-right' : 'items-start text-left'}`}>
      {playerIds.map((id) => {
        const meta = metaOf(id)
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSwap(id)}
            aria-label={`Move ${nameOf(id)} to the other team`}
            className={`w-full min-h-13 px-3.5 py-2 active:bg-sunken transition-colors ${
              align === 'right' ? 'text-right' : 'text-left'
            }`}
          >
            <span className="block truncate font-medium">{nameOf(id)}</span>
            {/* Surfacing why the engine chose this player builds trust in the auto-pick.
                Flare is reserved for "do this next", so a record reads as plain data. */}
            {meta && (
              <span className={`label block text-[0.5rem] mt-0.5 ${meta.accent ? 'text-flare' : 'text-muted'}`}>
                {meta.text}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
