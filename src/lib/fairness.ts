import type { Player, PlayerStats, TeamAssignment } from '../types/models'

/**
 * How the four picked players get divided into two teams.
 * - `fair`   — minimize repeat pairings, so everyone partners with everyone.
 * - `record` — stack strongest with strongest by win/loss record.
 *
 * Note this only governs the *split*. Who plays next is always the court-time
 * ranking below: letting records decide that would hand the winners more court
 * time, which is the opposite of what the app is for.
 */
export type PairingMode = 'fair' | 'record'

export interface FairnessEntry {
  playerId: string
  priority: number
  factors: {
    gamesPlayed: number
    courtTimeMs: number
    lastPlayedAt: number | null
  }
  /** Shuffle key, used only to separate players who are level on every factor above. */
  tiebreak: number
}

/**
 * A stable pseudo-random ordering key for a player.
 *
 * Before anyone has played, every player is level on all three fairness factors, so a
 * stable sort hands back the roster in storage order and the app picks the top four of
 * the Players tab at the start of every session — which reads as favoritism even though
 * it is just a tie. This breaks that tie by hash instead.
 *
 * A hash rather than `Math.random()` so the suggestion holds still between renders; and
 * seeded on the standings-session start so that resetting standings for a new day deals
 * a genuinely new order rather than the same one forever.
 */
function shuffleKey(playerId: string, seed: number): number {
  // FNV-1a over the id, then mixed with the seed. The seed cannot go into FNV's initial
  // state: multiplication only carries low bits upward, so a seed difference survives as
  // the same additive offset on every player's hash and merely rotates the order rather
  // than re-dealing it. The finalizer's right-shifts carry high bits back down, which is
  // what makes one changed seed move everybody independently.
  let h = 0x811c9dc5
  for (let i = 0; i < playerId.length; i++) {
    h ^= playerId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  let x = (h ^ seed) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  return x / 0x1_0000_0000
}

/**
 * Lower gamesPlayed/courtTime and older lastPlayedAt => higher priority to play next.
 * `seed` reshuffles players who are level on all three (see `shuffleKey`); pass the
 * current standings-session start so a reset re-deals the queue.
 */
export function rankByFairness(
  players: Player[],
  stats: Record<string, PlayerStats>,
  seed = 0,
): FairnessEntry[] {
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
        tiebreak: shuffleKey(p.id, seed),
      }
    })

  entries.sort((a, b) => {
    if (a.factors.gamesPlayed !== b.factors.gamesPlayed) return a.factors.gamesPlayed - b.factors.gamesPlayed
    if (a.factors.courtTimeMs !== b.factors.courtTimeMs) return a.factors.courtTimeMs - b.factors.courtTimeMs
    const aLast = a.factors.lastPlayedAt ?? -Infinity
    const bLast = b.factors.lastPlayedAt ?? -Infinity
    // Compared, not subtracted: two players who have never played are both -Infinity,
    // and the difference would be NaN, which silently swallows the tiebreak below.
    if (aLast !== bLast) return aLast - bLast
    return a.tiebreak - b.tiebreak
  })

  entries.forEach((e, i) => {
    e.priority = entries.length - i
  })

  return entries
}

/** Picks the next `count` players most deserving of court time. */
export function pickNextPlayers(
  players: Player[],
  stats: Record<string, PlayerStats>,
  count = 4,
  seed = 0,
): string[] {
  return rankByFairness(players, stats, seed)
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
  return validSplits(fourPlayerIds, lockedPairs)
    .map((split) => ({ split, repeatScore: splitRepeatScore(split, stats) }))
    .sort((a, b) => a.repeatScore - b.repeatScore)
    .map((s) => s.split)
}

/**
 * The same four players, split strongest-with-strongest instead — the open-play
 * "winners' court" idea, for a group that would rather play a stacked match than
 * a fresh pairing.
 *
 * Ordered from most stacked to most balanced, so "try another pairing" walks the
 * match back toward even. Strength is the plain win/loss differential, which means
 * four level players produce three equally-stacked splits and the repeat-pairing
 * score breaks the tie — a session with no finished games behaves exactly like
 * `fair` rather than inventing a hierarchy out of nothing.
 */
export function stackedTeamSplits(
  fourPlayerIds: string[],
  stats: Record<string, PlayerStats>,
  lockedPairs: [string, string][] = [],
): TeamAssignment[] {
  return validSplits(fourPlayerIds, lockedPairs)
    .map((split) => {
      const strengthA = teamStrength(split.teamA, stats)
      const strengthB = teamStrength(split.teamB, stats)
      return {
        // Put the stronger pair on team A so the left column of the matchup is
        // always the favored side and the stacking is legible at a glance.
        split: strengthB > strengthA ? { teamA: split.teamB, teamB: split.teamA } : split,
        gap: Math.abs(strengthA - strengthB),
        repeatScore: splitRepeatScore(split, stats),
      }
    })
    .sort((a, b) => b.gap - a.gap || a.repeatScore - b.repeatScore)
    .map((s) => s.split)
}

/** Team splits for a pairing mode. */
export function teamSplitsFor(
  mode: PairingMode,
  fourPlayerIds: string[],
  stats: Record<string, PlayerStats>,
  lockedPairs: [string, string][] = [],
): TeamAssignment[] {
  return mode === 'record'
    ? stackedTeamSplits(fourPlayerIds, stats, lockedPairs)
    : rankedTeamSplits(fourPlayerIds, stats, lockedPairs)
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

/** The three ways to split four players, minus any that break a locked pair. */
function validSplits(fourPlayerIds: string[], lockedPairs: [string, string][]): TeamAssignment[] {
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
  if (!locked) return splits

  return splits.filter(
    (s) =>
      (s.teamA.includes(locked[0]) && s.teamA.includes(locked[1])) ||
      (s.teamB.includes(locked[0]) && s.teamB.includes(locked[1])),
  )
}

function splitRepeatScore(split: TeamAssignment, stats: Record<string, PlayerStats>): number {
  return pairScore(split.teamA, stats) + pairScore(split.teamB, stats)
}

function pairScore(pair: [string, string], stats: Record<string, PlayerStats>): number {
  const [x, y] = pair
  return stats[x]?.partnerCounts[y] ?? 0
}

/** Win/loss differential — 0 for a player with no finished games, so they sit between. */
export function recordStrength(stats: Record<string, PlayerStats>, playerId: string): number {
  const s = stats[playerId]
  return (s?.wins ?? 0) - (s?.losses ?? 0)
}

function teamStrength(pair: [string, string], stats: Record<string, PlayerStats>): number {
  return recordStrength(stats, pair[0]) + recordStrength(stats, pair[1])
}
