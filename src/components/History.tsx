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

  const [importMessage, setImportMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?'

  const handleResetStandings = () => {
    if (!window.confirm('Start a fresh standing? Past games stay saved, but court time and win/loss counts start back at zero.')) return
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
    <section aria-labelledby="history-heading" className="flex flex-col gap-6 pt-2">
      {liveGames.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <NextRoundPanel heading="Up Next" onGameStarted={onGameStarted} />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 id="history-heading" className="text-lg font-semibold text-text">
            Court time
          </h2>
          <button type="button" onClick={handleResetStandings} className="text-xs font-medium text-text-soft underline underline-offset-2">
            Reset standings
          </button>
        </div>
        {seasonStartedAt && (
          <p className="text-xs text-text-soft mb-2">Since {new Date(seasonStartedAt).toLocaleString()}</p>
        )}
        <ul className="flex flex-col gap-1">
          {players
            .filter((p) => p.active)
            .map((p) => (
              <li key={p.id} className="flex justify-between text-sm text-text">
                <span>{p.name}</span>
                <span className="tabular-nums text-text-soft">
                  {stats[p.id]?.gamesPlayed ?? 0} games · {Math.round((stats[p.id]?.courtTimeMs ?? 0) / 60000)} min
                </span>
              </li>
            ))}
        </ul>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-text mb-2">Past games</h2>
        {finished.length === 0 && <p className="text-sm text-text-soft">No finished games yet.</p>}
        <ul className="flex flex-col gap-2">
          {finished.map((g) => (
            <li key={g.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text">
              <div className="flex justify-between font-medium">
                <span>
                  {nameOf(g.teams.teamA[0])} / {nameOf(g.teams.teamA[1])}
                </span>
                <span className="tabular-nums">{g.scoreA}</span>
              </div>
              <div className="flex justify-between text-text-soft">
                <span>
                  {nameOf(g.teams.teamB[0])} / {nameOf(g.teams.teamB[1])}
                </span>
                <span className="tabular-nums">{g.scoreB}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-text mb-2">Backup</h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleExport}
            className="min-h-11 flex-1 rounded-lg border border-border px-4 text-sm font-medium text-text"
          >
            Export as JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-11 flex-1 rounded-lg border border-border px-4 text-sm font-medium text-text"
          >
            Import JSON
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
        {importMessage && <p className="mt-2 text-sm text-text-soft">{importMessage}</p>}

        {hasAnyFinishedGames && (
          <button
            type="button"
            onClick={handleClearHistory}
            className="min-h-11 mt-3 w-full rounded-lg border border-danger/30 px-4 text-sm font-medium text-danger"
          >
            Clear all history
          </button>
        )}
      </div>
    </section>
  )
}
