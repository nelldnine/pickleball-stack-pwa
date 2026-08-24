import type { Game, Player, PlayerStats } from '../types/models'

const AVG_POINT_MS = 25_000 // rough estimate used when a game has no explicit duration

/** Games that count toward the current standings: everything since the last reset, plus any game still live. */
export function sessionGames(games: Game[], seasonStartedAt: number | null): Game[] {
  if (!seasonStartedAt) return games
  return games.filter((g) => g.status === 'live' || g.createdAt >= seasonStartedAt)
}

export function computeStats(players: Player[], games: Game[]): Record<string, PlayerStats> {
  const stats: Record<string, PlayerStats> = {}
  for (const p of players) {
    stats[p.id] = {
      playerId: p.id,
      gamesPlayed: 0,
      totalPoints: 0,
      wins: 0,
      losses: 0,
      lastPlayedAt: null,
      courtTimeMs: 0,
      partnerCounts: {},
    }
  }

  for (const g of games) {
    if (g.status === 'setup') continue
    const [a1, a2] = g.teams.teamA
    const [b1, b2] = g.teams.teamB
    const teamAWon = g.status === 'finished' && g.scoreA > g.scoreB
    const teamBWon = g.status === 'finished' && g.scoreB > g.scoreA
    const durationMs = g.finishedAt ? g.finishedAt - g.createdAt : g.history.length * AVG_POINT_MS

    for (const id of g.playerIds) {
      const s = stats[id]
      if (!s) continue
      s.gamesPlayed += 1
      s.lastPlayedAt = Math.max(s.lastPlayedAt ?? 0, g.finishedAt ?? g.createdAt)
      s.courtTimeMs += durationMs
    }

    for (const id of [a1, a2]) {
      if (!stats[id]) continue
      stats[id].totalPoints += g.scoreA
      if (teamAWon) stats[id].wins += 1
      if (teamBWon) stats[id].losses += 1
    }
    for (const id of [b1, b2]) {
      if (!stats[id]) continue
      stats[id].totalPoints += g.scoreB
      if (teamBWon) stats[id].wins += 1
      if (teamAWon) stats[id].losses += 1
    }

    bumpPartner(stats, a1, a2)
    bumpPartner(stats, b1, b2)
  }

  return stats
}

function bumpPartner(stats: Record<string, PlayerStats>, x: string, y: string) {
  if (stats[x]) stats[x].partnerCounts[y] = (stats[x].partnerCounts[y] ?? 0) + 1
  if (stats[y]) stats[y].partnerCounts[x] = (stats[y].partnerCounts[x] ?? 0) + 1
}
