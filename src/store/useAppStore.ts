import { create } from 'zustand'
import { db } from '../lib/db'
import type { Game, Player, ServeState, TeamAssignment } from '../types/models'

const MAX_COURTS = 6

interface AppState {
  players: Player[]
  games: Game[]
  loaded: boolean
  courtCount: number
  seasonStartedAt: number | null

  load: () => Promise<void>

  addPlayer: (name: string, handedness: Player['handedness']) => Promise<void>
  setPlayerActive: (id: string, active: boolean) => Promise<void>
  removePlayer: (id: string) => Promise<void>

  setCourtCount: (count: number) => Promise<void>

  startGame: (
    teams: TeamAssignment,
    stackingEnabled: boolean,
    sides?: Record<string, Player['sidePreference']>,
    court?: number,
  ) => Promise<string>
  addPoint: (gameId: string, team: 'A' | 'B') => Promise<void>
  undoLastPoint: (gameId: string) => Promise<void>
  setServe: (gameId: string, serve: ServeState) => Promise<void>
  sideOut: (gameId: string) => Promise<void>
  switchServer: (gameId: string) => Promise<void>
  finishGame: (gameId: string) => Promise<void>
  cancelGame: (gameId: string) => Promise<void>

  resetStandings: () => Promise<void>
  clearHistory: () => Promise<void>

  exportData: () => { players: Player[]; games: Game[]; settings: { courtCount: number; seasonStartedAt: number | null } }
  importData: (data: {
    players: Player[]
    games: Game[]
    settings?: { courtCount?: number; seasonStartedAt?: number | null }
  }) => Promise<void>
}

function uid() {
  return crypto.randomUUID()
}

/** A serve with every field resolved. */
export type ResolvedServe = Required<ServeState>

/**
 * Serve for a game, with defaults for games saved before each part was tracked: team A's
 * 2nd server (the 0-0-2 start), the first-listed player of each team in the right-hand
 * court, and — lacking a recorded server — the player the old index-based display named,
 * so a game in progress across the update keeps showing who it showed.
 */
export function serveOf(game: Game): ResolvedServe {
  const base = game.serve ?? { team: 'A', server: 2 }
  const pair = base.team === 'A' ? game.teams.teamA : game.teams.teamB
  return {
    team: base.team,
    server: base.server,
    serverId: base.serverId && pair.includes(base.serverId) ? base.serverId : pair[base.server - 1],
    evenCourt: base.evenCourt ?? { A: game.teams.teamA[0], B: game.teams.teamB[0] },
  }
}

function partnerOf(pair: [string, string], id: string): string {
  return pair[0] === id ? pair[1] : pair[0]
}

/** Who stands in `team`'s right-hand court at `score`: partners swap on every point scored. */
function rightCourtPlayer(game: Game, team: 'A' | 'B', evenCourt: ResolvedServe['evenCourt'], score: number): string {
  const pair = team === 'A' ? game.teams.teamA : game.teams.teamB
  return score % 2 === 0 ? evenCourt[team] : partnerOf(pair, evenCourt[team])
}

/**
 * Who starts in the right-hand court. A partner who stacks to the deuce side, or a
 * first-listed player who stacks to the ad side, flips the default; otherwise it is the
 * first-listed player, and `switchServer` corrects it on the court.
 */
function startingEvenCourt(pair: [string, string], sides: Record<string, Player['sidePreference']>): string {
  return sides[pair[1]] === 'deuce' || sides[pair[0]] === 'ad' ? pair[1] : pair[0]
}

export const useAppStore = create<AppState>((set, get) => ({
  players: [],
  games: [],
  loaded: false,
  courtCount: 1,
  seasonStartedAt: null,

  load: async () => {
    const [players, games, courtCountRow, seasonRow] = await Promise.all([
      db.players.toArray(),
      db.games.toArray(),
      db.settings.get('courtCount'),
      db.settings.get('seasonStartedAt'),
    ])
    set({
      players,
      games,
      loaded: true,
      courtCount: courtCountRow?.value ?? 1,
      seasonStartedAt: seasonRow?.value ?? null,
    })
  },

  addPlayer: async (name, handedness) => {
    const player: Player = {
      id: uid(),
      name: name.trim(),
      handedness,
      sidePreference: 'flexible',
      active: true,
      createdAt: Date.now(),
    }
    await db.players.add(player)
    set({ players: [...get().players, player] })
  },

  setPlayerActive: async (id, active) => {
    await db.players.update(id, { active })
    set({ players: get().players.map((p) => (p.id === id ? { ...p, active } : p)) })
  },

  removePlayer: async (id) => {
    await db.players.delete(id)
    set({ players: get().players.filter((p) => p.id !== id) })
  },

  setCourtCount: async (count) => {
    const value = Math.max(1, Math.min(MAX_COURTS, Math.round(count)))
    await db.settings.put({ key: 'courtCount', value })
    set({ courtCount: value })
  },

  startGame: async (teams, stackingEnabled, sides = {}, court = 1) => {
    const stackedSides = stackingEnabled ? sides : {}
    const evenCourt = {
      A: startingEvenCourt(teams.teamA, stackedSides),
      B: startingEvenCourt(teams.teamB, stackedSides),
    }
    const game: Game = {
      id: uid(),
      createdAt: Date.now(),
      finishedAt: null,
      playerIds: [...teams.teamA, ...teams.teamB],
      teams,
      stacking: { enabled: stackingEnabled, sides },
      scoreA: 0,
      scoreB: 0,
      history: [],
      status: 'live',
      court,
      // 0-0-2: the side that serves first in a doubles game only gets one server
      // before the first side out, so it opens on the 2nd server — who is simply
      // whoever starts in the right-hand court.
      serve: { team: 'A', server: 2, serverId: evenCourt.A, evenCourt },
    }
    await db.games.add(game)
    set({ games: [...get().games, game] })
    return game.id
  },

  addPoint: async (gameId, team) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game) return
    const updated: Game = {
      ...game,
      scoreA: team === 'A' ? game.scoreA + 1 : game.scoreA,
      scoreB: team === 'B' ? game.scoreB + 1 : game.scoreB,
      history: [...game.history, { team, timestamp: Date.now() }],
    }
    await db.games.put(updated)
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
  },

  undoLastPoint: async (gameId) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game || game.history.length === 0) return
    const last = game.history[game.history.length - 1]
    const updated: Game = {
      ...game,
      scoreA: last.team === 'A' ? game.scoreA - 1 : game.scoreA,
      scoreB: last.team === 'B' ? game.scoreB - 1 : game.scoreB,
      history: game.history.slice(0, -1),
    }
    await db.games.put(updated)
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
  },

  setServe: async (gameId, serve) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game) return
    const updated: Game = { ...game, serve }
    await db.games.put(updated)
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
  },

  /**
   * Advances the serve one step through the doubles sequence: 1st server loses the
   * rally and it passes to their partner, 2nd server loses it and the whole side is
   * out, so the other team starts on their 1st server — whoever is standing in their
   * right-hand court at their current score.
   *
   * Points don't touch the serve: a server who wins the rally keeps serving, from the
   * other court, under the same number.
   */
  sideOut: async (gameId) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game) return
    const current = serveOf(game)
    let serve: ServeState
    if (current.server === 1) {
      const pair = current.team === 'A' ? game.teams.teamA : game.teams.teamB
      serve = { ...current, server: 2, serverId: partnerOf(pair, current.serverId) }
    } else {
      const team = current.team === 'A' ? 'B' : 'A'
      const score = team === 'A' ? game.scoreA : game.scoreB
      serve = { ...current, team, server: 1, serverId: rightCourtPlayer(game, team, current.evenCourt, score) }
    }
    const updated: Game = { ...game, serve }
    await db.games.put(updated)
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
  },

  /**
   * "It's the other one serving." The app can't see who stood where, so this is the
   * correction. The number stays — the call was right, only the name was wrong — and
   * since a wrong server can only come from having the serving team's courts backwards,
   * `evenCourt` flips with it, which keeps their next turn to serve right too.
   */
  switchServer: async (gameId) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game) return
    const current = serveOf(game)
    const pair = current.team === 'A' ? game.teams.teamA : game.teams.teamB
    const serve: ServeState = {
      ...current,
      serverId: partnerOf(pair, current.serverId),
      evenCourt: { ...current.evenCourt, [current.team]: partnerOf(pair, current.evenCourt[current.team]) },
    }
    const updated: Game = { ...game, serve }
    await db.games.put(updated)
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
  },

  finishGame: async (gameId) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game) return
    const updated: Game = { ...game, status: 'finished', finishedAt: Date.now() }
    await db.games.put(updated)
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
  },

  /**
   * A cancelled game is deleted outright rather than kept with a status, because the
   * point of cancelling is that it never happened: leaving a row behind would still
   * hand its players court time and a pairing in the ledger.
   */
  cancelGame: async (gameId) => {
    await db.games.delete(gameId)
    set({ games: get().games.filter((g) => g.id !== gameId) })
  },

  resetStandings: async () => {
    const value = Date.now()
    await db.settings.put({ key: 'seasonStartedAt', value })
    set({ seasonStartedAt: value })
  },

  clearHistory: async () => {
    const finishedIds = get().games.filter((g) => g.status === 'finished').map((g) => g.id)
    await Promise.all([db.games.bulkDelete(finishedIds), db.settings.delete('seasonStartedAt')])
    set({
      games: get().games.filter((g) => g.status !== 'finished'),
      seasonStartedAt: null,
    })
  },

  exportData: () => ({
    players: get().players,
    games: get().games,
    settings: { courtCount: get().courtCount, seasonStartedAt: get().seasonStartedAt },
  }),

  importData: async (data) => {
    await Promise.all([db.players.bulkPut(data.players), db.games.bulkPut(data.games)])
    // Distinguish "key absent" (older export — leave the local setting alone) from an
    // explicit value, so importing a backup whose standings were reset actually clears
    // the local boundary instead of silently keeping it.
    if (data.settings?.courtCount !== undefined) {
      await db.settings.put({ key: 'courtCount', value: data.settings.courtCount })
    }
    if (data.settings && 'seasonStartedAt' in data.settings) {
      const season = data.settings.seasonStartedAt
      if (season === null || season === undefined) await db.settings.delete('seasonStartedAt')
      else await db.settings.put({ key: 'seasonStartedAt', value: season })
    }
    const [players, games, courtCountRow, seasonRow] = await Promise.all([
      db.players.toArray(),
      db.games.toArray(),
      db.settings.get('courtCount'),
      db.settings.get('seasonStartedAt'),
    ])
    // The settings table was just reconciled above, so it is authoritative here.
    // Falling back to the previous in-memory value would resurrect a boundary the
    // import had deliberately cleared.
    set({
      players,
      games,
      courtCount: courtCountRow?.value ?? 1,
      seasonStartedAt: seasonRow?.value ?? null,
    })
  },
}))
