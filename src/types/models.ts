export type Handedness = 'right' | 'left'
export type SidePreference = 'ad' | 'deuce' | 'flexible'

export interface Player {
  id: string
  name: string
  handedness: Handedness
  sidePreference: SidePreference
  active: boolean
  createdAt: number
}

export interface TeamAssignment {
  teamA: [string, string] // player ids
  teamB: [string, string]
}

export interface StackingConfig {
  enabled: boolean
  /** player id -> side they stack to */
  sides: Record<string, SidePreference>
}

export type PointEvent = {
  team: 'A' | 'B'
  timestamp: number
}

/**
 * Who is serving right now. `server` is the 1st/2nd server of that team, which is
 * the third number in a doubles call ("4-2-2"). Like `stacking`, this is tracked,
 * not inferred: the app does not model rally outcomes, so the players advance it.
 */
export interface ServeState {
  team: 'A' | 'B'
  server: 1 | 2
}

export interface Game {
  id: string
  createdAt: number
  finishedAt: number | null
  playerIds: string[] // all players involved (usually 4, supports rotation later)
  teams: TeamAssignment
  stacking: StackingConfig
  scoreA: number
  scoreB: number
  history: PointEvent[]
  status: 'setup' | 'live' | 'finished'
  notes?: string
  /** 1-indexed court this game is/was played on. Defaults to 1 when absent (pre-multi-court data). */
  court?: number
  /** Current serve. Absent on games recorded before serve tracking existed. */
  serve?: ServeState
}

export interface PlayerStats {
  playerId: string
  gamesPlayed: number
  totalPoints: number
  wins: number
  losses: number
  lastPlayedAt: number | null
  /** cumulative ms spent in live games */
  courtTimeMs: number
  /** map of partnerId -> times paired */
  partnerCounts: Record<string, number>
}
