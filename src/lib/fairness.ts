import type { Game, Player, PlayerStats, TeamAssignment } from '../types/models'

/**
 * How the next match is put together.
 * - `fair`   — the four most owed court time, split to minimize repeat pairings, so
 *              everyone partners with everyone.
 * - `record` — win/lose stacking: once a pair has played, they stay a team, and teams
 *              meet teams that had the same last result — winners play winners, losers
 *              play losers.
 *
 * Neither mode lets results decide *how much* anyone plays. `record` only chooses among
 * the teams that court time says are up, so winning never buys extra games.
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
 * A pair who played together in both players' most recent finished game, and so are
 * still a team under win/lose stacking.
 */
export interface StandingTeam {
  players: [string, string]
  result: 'won' | 'lost'
  /** The team they just played, so a same-result match can be preferred over a rematch. */
  lastOpponents: [string, string]
}

/**
 * Standing teams among `availableIds`, read from `games` (pass session games).
 *
 * A pair only counts when that game is the latest for *both* players — if either has
 * since played with someone else, the team has dissolved. A drawn game has no result
 * to stack on, so its pairs dissolve too, as does any pair whose partner is not free.
 */
export function standingTeams(games: Game[], availableIds: string[]): StandingTeam[] {
  const available = new Set(availableIds)
  const latest = new Map<string, Game>()
  const finished = games
    .filter((g) => g.status === 'finished')
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
  for (const g of finished) {
    for (const id of g.playerIds) {
      if (!latest.has(id)) latest.set(id, g)
    }
  }

  const teams: StandingTeam[] = []
  for (const g of new Set(latest.values())) {
    if (g.scoreA === g.scoreB) continue
    const sides = [
      { players: g.teams.teamA, won: g.scoreA > g.scoreB, other: g.teams.teamB },
      { players: g.teams.teamB, won: g.scoreB > g.scoreA, other: g.teams.teamA },
    ]
    for (const side of sides) {
      const intact = side.players.every((id) => available.has(id) && latest.get(id) === g)
      if (intact) {
        teams.push({ players: side.players, result: side.won ? 'won' : 'lost', lastOpponents: side.other })
      }
    }
  }
  return teams
}

/**
 * The next four under win/lose stacking, ordered team A then team B where both are
 * standing teams.
 *
 * Court time still decides who is up: every team and leftover single is ranked by its
 * players' place in the fairness order, and only units level with the most-owed one on
 * games played are considered. Among those, the most-owed team meets a team with the
 * same last result, then any team that isn't a rematch, then whoever is left. Seats a
 * whole team can't fill go to singles, and only then does a team get broken up.
 *
 * With no standing teams yet — the first round of a session — this is exactly
 * `pickNextPlayers`.
 */
export function pickNextByRecord(
  players: Player[],
  stats: Record<string, PlayerStats>,
  teams: StandingTeam[],
  seed = 0,
): string[] {
  const ranked = rankByFairness(players, stats, seed).map((e) => e.playerId)
  if (ranked.length < 4 || teams.length === 0) return ranked.slice(0, 4)

  const position = new Map(ranked.map((id, i) => [id, i]))
  const onTeam = new Set(teams.flatMap((t) => t.players))
  const mean = (ids: string[], f: (id: string) => number) => ids.reduce((sum, id) => sum + f(id), 0) / ids.length

  const units = [
    ...teams.map((team) => ({ ids: team.players as string[], team })),
    ...ranked.filter((id) => !onTeam.has(id)).map((id) => ({ ids: [id], team: null as StandingTeam | null })),
  ]
    .map((u) => ({
      ...u,
      rank: mean(u.ids, (id) => position.get(id) ?? Infinity),
      games: mean(u.ids, (id) => stats[id]?.gamesPlayed ?? 0),
    }))
    .sort((a, b) => a.rank - b.rank)

  const [first, ...rest] = units
  const tier = rest.filter((u) => u.games === first.games)

  if (first.team) {
    const lead = first.team
    const isRematch = (t: StandingTeam) => t.players.every((id) => lead.lastOpponents.includes(id))
    const tierTeams = tier.flatMap((u) => (u.team ? [u.team] : []))
    const opponent =
      tierTeams.find((t) => t.result === lead.result) ??
      tierTeams.find((t) => !isRematch(t)) ??
      tierTeams[0]
    if (opponent) return [...lead.players, ...opponent.players]
  }

  const four = [...first.ids]
  for (const u of tier) {
    if (four.length + u.ids.length <= 4) four.push(...u.ids)
  }
  for (const id of ranked) {
    if (four.length < 4 && !four.includes(id)) four.push(id)
  }
  return four
}

/**
 * The four players' splits under win/lose stacking: standing teams kept intact first,
 * then by fewest repeat pairings — so "try another pairing" still has somewhere to go,
 * and four players with no standing team split exactly like `fair`.
 */
export function recordTeamSplits(
  fourPlayerIds: string[],
  stats: Record<string, PlayerStats>,
  lockedPairs: [string, string][] = [],
  teams: StandingTeam[] = [],
): TeamAssignment[] {
  const isTeam = (pair: [string, string]) =>
    teams.some((t) => t.players.includes(pair[0]) && t.players.includes(pair[1]))
  return validSplits(fourPlayerIds, lockedPairs)
    .map((split) => ({
      split,
      intact: Number(isTeam(split.teamA)) + Number(isTeam(split.teamB)),
      repeatScore: splitRepeatScore(split, stats),
    }))
    .sort((a, b) => b.intact - a.intact || a.repeatScore - b.repeatScore)
    .map((s) => s.split)
}

/** Team splits for a pairing mode. */
export function teamSplitsFor(
  mode: PairingMode,
  fourPlayerIds: string[],
  stats: Record<string, PlayerStats>,
  lockedPairs: [string, string][] = [],
  teams: StandingTeam[] = [],
): TeamAssignment[] {
  return mode === 'record'
    ? recordTeamSplits(fourPlayerIds, stats, lockedPairs, teams)
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
