import { useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { computeStats, sessionGames } from '../lib/stats'

/**
 * "Who's winning" — the counterpart to the Court time ledger, and deliberately its own
 * screen rather than a second list below it. The two answer different questions and are
 * ordered oppositely (court time ascending, wins descending); stacked on one screen the
 * reversal reads as an inconsistency instead of a distinction.
 *
 * It is a sub-screen of the Ledger tab, opened from the Results heading, so it carries
 * its own way back — the nav cannot return you from a screen it has no button for.
 */
export function Standings({ onBack }: { onBack: () => void }) {
  const players = useAppStore((s) => s.players)
  const games = useAppStore((s) => s.games)
  const seasonStartedAt = useAppStore((s) => s.seasonStartedAt)
  const resetStandings = useAppStore((s) => s.resetStandings)

  const relevantGames = useMemo(() => sessionGames(games, seasonStartedAt), [games, seasonStartedAt])
  const stats = useMemo(() => computeStats(players, relevantGames), [players, relevantGames])

  // Only players who have actually finished a game, since a leaderboard padded with
  // 0-0 rows buries the result it exists to show.
  const standings = useMemo(() => {
    const rows = players
      .map((p) => ({
        id: p.id,
        name: p.name,
        wins: stats[p.id]?.wins ?? 0,
        losses: stats[p.id]?.losses ?? 0,
      }))
      .filter((r) => r.wins + r.losses > 0)
      .sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins
        // Same wins: fewer losses is the better record.
        if (a.losses !== b.losses) return a.losses - b.losses
        return a.name.localeCompare(b.name)
      })
    const maxWins = Math.max(1, ...rows.map((r) => r.wins))
    // Competition ranking: an identical record shares a place rather than inventing
    // an order out of the tiebreakers.
    const ranked: (typeof rows[number] & { place: number; pct: number })[] = []
    rows.forEach((r, i) => {
      const prev = rows[i - 1]
      const tied = prev && prev.wins === r.wins && prev.losses === r.losses
      ranked.push({ ...r, place: tied ? ranked[i - 1].place : i + 1, pct: (r.wins / maxWins) * 100 })
    })
    return ranked
  }, [players, stats])

  // The same action the Court time header offers — one reset clears both — but a screen
  // named Standings is where someone goes looking to reset the standings.
  const handleReset = () => {
    if (
      !window.confirm(
        'Start a fresh standing? Past games stay saved, but court time and win/loss counts start back at zero.',
      )
    )
      return
    resetStandings()
  }

  return (
    <section aria-labelledby="standings-heading" className="flex flex-col pt-1">
      <button
        type="button"
        onClick={onBack}
        className="label text-[0.6rem] text-muted flex items-center gap-1 min-h-11 -mt-2 self-start"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Results
      </button>

      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 id="standings-heading" className="readout text-xl font-semibold">
          Standings
        </h2>
        <button type="button" onClick={handleReset} className="label text-[0.6rem] text-muted">
          Reset
        </button>
      </div>
      <p className="text-xs text-muted mb-4">
        {seasonStartedAt ? `Since ${new Date(seasonStartedAt).toLocaleString()}` : 'All games so far'}
      </p>

      {standings.length === 0 ? (
        <p className="text-sm text-muted">Finish a game to start the win column.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {standings.map((r) => {
            const leading = r.place === 1
            return (
              <li key={r.id}>
                <div className="flex items-baseline gap-2.5 mb-1.5">
                  <span
                    className={`readout text-xs w-4 shrink-0 ${leading ? 'text-court font-semibold' : 'text-faint'}`}
                  >
                    {r.place}
                  </span>
                  <span className={`text-sm truncate flex-1 ${leading ? 'font-semibold text-ink' : 'text-muted'}`}>
                    {r.name}
                  </span>
                  <span className="readout text-xs shrink-0">
                    <span className={leading ? 'text-ink font-semibold' : 'text-ink'}>{r.wins}</span>
                    <span className="text-faint">–{r.losses}</span>
                  </span>
                </div>
                <div className="ml-6.5 h-2 rounded-full bg-sunken">
                  <div
                    className={`h-full rounded-full ${leading ? 'bg-court' : 'bg-court/55'}`}
                    style={{ width: `${r.pct}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
