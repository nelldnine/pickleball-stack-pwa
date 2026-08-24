import { useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { computeStats, sessionGames } from '../lib/stats'
import { NextRoundPanel } from './NextRoundPanel'

export function History({ onGameStarted }: { onGameStarted: (gameId: string) => void }) {
  const players = useAppStore((s) => s.players)
  const games = useAppStore((s) => s.games)
  const seasonStartedAt = useAppStore((s) => s.seasonStartedAt)
  const liveGames = useMemo(() => games.filter((g) => g.status === 'live'), [games])
  const resetStandings = useAppStore((s) => s.resetStandings)
  const clearHistory = useAppStore((s) => s.clearHistory)
  const exportData = useAppStore((s) => s.exportData)
  const importData = useAppStore((s) => s.importData)

  const relevantGames = useMemo(() => sessionGames(games, seasonStartedAt), [games, seasonStartedAt])
  const stats = useMemo(() => computeStats(players, relevantGames), [players, relevantGames])
  const finished = useMemo(
    () =>
      [...relevantGames]
        .filter((g) => g.status === 'finished')
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    [relevantGames],
  )
  const hasAnyFinishedGames = useMemo(() => games.some((g) => g.status === 'finished'), [games])

  // The whole point of the app is dividing court time evenly, so show the spread
  // rather than a column of numbers: each bar is relative to the busiest player,
  // with the group average marked so an unfair gap is visible at a glance.
  const ledger = useMemo(() => {
    const rows = players
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        name: p.name,
        games: stats[p.id]?.gamesPlayed ?? 0,
        minutes: Math.round((stats[p.id]?.courtTimeMs ?? 0) / 60000),
      }))
      // Least court time first: the top of this list is the answer to "who's owed a game".
      .sort((a, b) => a.games - b.games || a.minutes - b.minutes)
    const maxGames = Math.max(1, ...rows.map((r) => r.games))
    const avgGames = rows.length ? rows.reduce((sum, r) => sum + r.games, 0) / rows.length : 0
    return { rows, maxGames, avgGames }
  }, [players, stats])

  const [importMessage, setImportMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?'

  const handleResetStandings = () => {
    if (
      !window.confirm(
        'Start a fresh standing? Past games stay saved, but court time and win/loss counts start back at zero.',
      )
    )
      return
    resetStandings()
  }

  const handleClearHistory = () => {
    if (!window.confirm('Permanently delete all finished games? This cannot be undone.')) return
    clearHistory()
  }

  const handleExport = () => {
    const data = exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pickleball-stacking-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!Array.isArray(data.players) || !Array.isArray(data.games)) {
        throw new Error('File does not look like a Pickleball Stacking export.')
      }
      await importData(data)
      setImportMessage(`Imported ${data.players.length} players and ${data.games.length} games.`)
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-9 pt-1">
      {liveGames.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <NextRoundPanel heading="Up next" onGameStarted={onGameStarted} />
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 id="history-heading" className="readout text-xl font-semibold">
            Court time
          </h2>
          <button type="button" onClick={handleResetStandings} className="label text-[0.6rem] text-muted">
            Reset
          </button>
        </div>
        <p className="text-xs text-muted mb-4">
          {seasonStartedAt ? `Since ${new Date(seasonStartedAt).toLocaleString()}` : 'All games so far'}
        </p>

        {ledger.rows.length === 0 ? (
          <p className="text-sm text-muted">Mark players as playing to track their court time.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ledger.rows.map((r) => {
              const pct = (r.games / ledger.maxGames) * 100
              const avgPct = (ledger.avgGames / ledger.maxGames) * 100
              const behind = r.games < ledger.avgGames
              return (
                <li key={r.id}>
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <span className={`text-sm truncate ${behind ? 'font-semibold text-ink' : 'text-muted'}`}>
                      {r.name}
                    </span>
                    <span className="readout text-xs shrink-0">
                      <span className={behind ? 'text-flare font-semibold' : 'text-muted'}>{r.games}</span>
                      <span className="text-faint"> · {r.minutes}m</span>
                    </span>
                  </div>
                  <div className="relative h-2 rounded-full bg-sunken">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${behind ? 'bg-flare' : 'bg-court/55'}`}
                      style={{ width: `${pct}%` }}
                    />
                    {/* Average marker overlays the track, so the gap to it is the thing you read. */}
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full bg-line-strong"
                      style={{ left: `${avgPct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {ledger.rows.length > 1 && (
          <p className="text-[0.7rem] text-faint mt-4 flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-flare" /> owed court time
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-0.5 h-2.5 rounded-full bg-line-strong" /> group average
            </span>
          </p>
        )}
      </div>

      <div>
        <h2 className="readout text-xl font-semibold mb-3">Results</h2>
        {finished.length === 0 && <p className="text-sm text-muted">No finished games yet.</p>}
        <ul className="flex flex-col">
          {finished.map((g) => {
            const aWon = g.scoreA > g.scoreB
            const bWon = g.scoreB > g.scoreA
            return (
              <li key={g.id} className="border-b border-line py-3 last:border-0">
                <ResultRow
                  names={`${nameOf(g.teams.teamA[0])} / ${nameOf(g.teams.teamA[1])}`}
                  score={g.scoreA}
                  won={aWon}
                />
                <ResultRow
                  names={`${nameOf(g.teams.teamB[0])} / ${nameOf(g.teams.teamB[1])}`}
                  score={g.scoreB}
                  won={bWon}
                />
                <p className="label text-[0.55rem] text-faint mt-1.5">
                  {g.court && g.court > 1 ? `Court ${g.court} · ` : ''}
                  {g.finishedAt
                    ? new Date(g.finishedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                    : ''}
                </p>
              </li>
            )
          })}
        </ul>
      </div>

      <div>
        <h2 className="readout text-xl font-semibold mb-3">Backup</h2>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={handleExport}
            className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-4 text-sm font-medium"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-4 text-sm font-medium"
          >
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImportFile(file)
              e.target.value = ''
            }}
          />
        </div>
        {importMessage && <p className="mt-2 text-sm text-muted">{importMessage}</p>}

        {hasAnyFinishedGames && (
          <button
            type="button"
            onClick={handleClearHistory}
            className="min-h-11 mt-2.5 w-full rounded-xl px-4 text-sm font-medium text-danger"
          >
            Clear all history
          </button>
        )}
      </div>
    </section>
  )
}

function ResultRow({ names, score, won }: { names: string; score: number; won: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${won ? 'text-ink' : 'text-muted'}`}>
      <span className={`text-sm truncate ${won ? 'font-semibold' : ''}`}>{names}</span>
      <span className="readout text-sm shrink-0 flex items-center gap-2">
        {won && <span aria-hidden="true" className="h-1 w-1 rounded-full bg-court" />}
        {score}
      </span>
    </div>
  )
}
