import type { Player, PlayerStats, TeamAssignment } from '../types/models'

export interface FairnessEntry {
  playerId: string
  priority: number
  factors: {
    gamesPlayed: number
    courtTimeMs: number
    lastPlayedAt: number | null
  }
}

/** Lower gamesPlayed/courtTime and older lastPlayedAt => higher priority to play next. */
export function rankByFairness(players: Player[], stats: Record<string, PlayerStats>): FairnessEntry[] {
  const entries = players
    .filter((p) => p.active)
    .map((p) => {
      const s = stats[p.id]
      return {
        playerId: p.id,
        priority: 0,
        factors: {
          gamesPlayed: s?.gamesPlayed ?? 0,
          courtTimeMs: s?.courtTimeMs ?? 0,
          lastPlayedAt: s?.lastPlayedAt ?? null,
        },
      }
    })

  entries.sort((a, b) => {
    if (a.factors.gamesPlayed !== b.factors.gamesPlayed) return a.factors.gamesPlayed - b.factors.gamesPlayed
    if (a.factors.courtTimeMs !== b.factors.courtTimeMs) return a.factors.courtTimeMs - b.factors.courtTimeMs
    const aLast = a.factors.lastPlayedAt ?? -Infinity
    const bLast = b.factors.lastPlayedAt ?? -Infinity
    return aLast - bLast
  })

  entries.forEach((e, i) => {
    e.priority = entries.length - i
  })

  return entries
}

/** Picks the next `count` players most deserving of court time. */
export function pickNextPlayers(players: Player[], stats: Record<string, PlayerStats>, count = 4): string[] {
  return rankByFairness(players, stats)
    .slice(0, count)
    .map((e) => e.playerId)
}

/**
 * Given exactly 4 players, returns every valid team split (honoring locked pairs),
 * sorted from least to most repeated pairing.
 */
export function rankedTeamSplits(
  fourPlayerIds: string[],
  stats: Record<string, PlayerStats>,
  lockedPairs: [string, string][] = [],
): TeamAssignment[] {
  if (fourPlayerIds.length !== 4) {
    throw new Error('rankedTeamSplits requires exactly 4 players')
  }
  const [p1, p2, p3, p4] = fourPlayerIds

  const splits: TeamAssignment[] = [
    { teamA: [p1, p2], teamB: [p3, p4] },
    { teamA: [p1, p3], teamB: [p2, p4] },
    { teamA: [p1, p4], teamB: [p2, p3] },
  ]

  const locked = lockedPairs.find(
    ([x, y]) => fourPlayerIds.includes(x) && fourPlayerIds.includes(y),
  )

  const valid = locked
    ? splits.filter(
        (s) =>
          (s.teamA.includes(locked[0]) && s.teamA.includes(locked[1])) ||
          (s.teamB.includes(locked[0]) && s.teamB.includes(locked[1])),
      )
    : splits

  return valid
    .map((split) => ({
      split,
      repeatScore: pairScore(split.teamA, stats) + pairScore(split.teamB, stats),
    }))
    .sort((a, b) => a.repeatScore - b.repeatScore)
    .map((s) => s.split)
}

/**
 * Given exactly 4 players, choose the team split that minimizes repeat pairings,
 * honoring any locked pairs (players who must stay together).
 */
export function suggestTeams(
  fourPlayerIds: string[],
  stats: Record<string, PlayerStats>,
  lockedPairs: [string, string][] = [],
): TeamAssignment {
  return rankedTeamSplits(fourPlayerIds, stats, lockedPairs)[0]
}

function pairScore(pair: [string, string], stats: Record<string, PlayerStats>): number {
  const [x, y] = pair
  return stats[x]?.partnerCounts[y] ?? 0
}
