import type { Game, SidePreference } from '../types/models'

export type CourtSide = 'right' | 'left' // right = "even"/deuce side, left = "odd"/ad side
export type PlayerRole = 'server' | 'receiver' | 'partner'

export interface CourtPosition {
  playerId: string
  team: 'A' | 'B'
  role: PlayerRole
  /** Where the rules require this player to stand right now (only meaningful for server + receiver). */
  requiredSide: CourtSide | null
  /** Where stacking preference would move them once the ball is live. */
  stackedSide: CourtSide
}

function opposite(side: CourtSide): CourtSide {
  return side === 'right' ? 'left' : 'right'
}

/**
 * Determines mandatory serve/receive positions from the score, and overlays
 * stacking preferences for the two players who are free to move once the
 * ball is in play. This intentionally does not attempt to model server
 * rotation (1st/2nd server) — teams track that themselves like on paper.
 */
export function courtPositionsForScore(
  teams: Game['teams'],
  stacking: Game['stacking'],
  servingTeam: 'A' | 'B',
  serverId: string,
  servingTeamScore: number,
): CourtPosition[] {
  const requiredServerSide: CourtSide = servingTeamScore % 2 === 0 ? 'right' : 'left'
  // Receiver stands diagonally opposite the server.
  const requiredReceiverSide: CourtSide = opposite(requiredServerSide)

  const serverTeamPlayers = servingTeam === 'A' ? teams.teamA : teams.teamB
  const receivingTeamPlayers = servingTeam === 'A' ? teams.teamB : teams.teamA
  const receiverId = pickReceiver(receivingTeamPlayers, requiredReceiverSide, stacking)

  const positions: CourtPosition[] = []

  positions.push(
    ...placeTeam(serverTeamPlayers, servingTeam, serverId, 'server', requiredServerSide, stacking),
  )
  positions.push(
    ...placeTeam(
      receivingTeamPlayers,
      servingTeam === 'A' ? 'B' : 'A',
      receiverId,
      'receiver',
      requiredReceiverSide,
      stacking,
    ),
  )

  return positions
}

/**
 * Places a team's two players. The anchored player (server or receiver) is pinned to the
 * side the rules require; the partner takes their preferred side, but is forced to the
 * opposite side when that preference would collide — two players cannot stand in the same
 * service court, and the court diagram renders one player per quadrant.
 */
function placeTeam(
  teamPlayers: [string, string],
  team: 'A' | 'B',
  anchoredId: string,
  anchoredRole: 'server' | 'receiver',
  anchoredSide: CourtSide,
  stacking: Game['stacking'],
): CourtPosition[] {
  return teamPlayers.map((pid) => {
    const isAnchored = pid === anchoredId
    const preferred = sideFor(stacking, pid, opposite(anchoredSide))
    return {
      playerId: pid,
      team,
      role: isAnchored ? anchoredRole : 'partner',
      requiredSide: isAnchored ? anchoredSide : null,
      stackedSide: isAnchored ? anchoredSide : preferred === anchoredSide ? opposite(anchoredSide) : preferred,
    }
  })
}

function pickReceiver(
  receivingTeam: [string, string],
  requiredSide: CourtSide,
  stacking: Game['stacking'],
): string {
  // The receiver is whichever of the two is currently assigned to the required side;
  // default to the first player if no explicit preference is set (typical for a fresh game).
  const [p1, p2] = receivingTeam
  const p1Side = sideFor(stacking, p1, null)
  if (p1Side === requiredSide) return p1
  const p2Side = sideFor(stacking, p2, null)
  if (p2Side === requiredSide) return p2
  return p1
}

/** Resolves a player's preferred side, falling back to `fallback` (or 'right') when unset/flexible. */
function sideFor(stacking: Game['stacking'], playerId: string, fallback: CourtSide | null): CourtSide {
  const pref: SidePreference | undefined = stacking.enabled ? stacking.sides[playerId] : undefined
  if (pref === 'ad') return 'left'
  if (pref === 'deuce') return 'right'
  return fallback ?? 'right'
}
