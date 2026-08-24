import { create } from 'zustand'
import { db } from '../lib/db'
import type { Game, Player, TeamAssignment } from '../types/models'

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
  finishGame: (gameId: string) => Promise<void>

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

  finishGame: async (gameId) => {
    const game = get().games.find((g) => g.id === gameId)
    if (!game) return
    const updated: Game = { ...game, status: 'finished', finishedAt: Date.now() }
    await db.games.put(updated)
    set({ games: get().games.map((g) => (g.id === gameId ? updated : g)) })
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
    if (data.settings?.courtCount) {
      await db.settings.put({ key: 'courtCount', value: data.settings.courtCount })
    }
    if (data.settings?.seasonStartedAt) {
      await db.settings.put({ key: 'seasonStartedAt', value: data.settings.seasonStartedAt })
    }
    const [players, games, courtCountRow, seasonRow] = await Promise.all([
      db.players.toArray(),
      db.games.toArray(),
      db.settings.get('courtCount'),
      db.settings.get('seasonStartedAt'),
    ])
    set({
      players,
      games,
      courtCount: courtCountRow?.value ?? get().courtCount,
      seasonStartedAt: seasonRow?.value ?? get().seasonStartedAt,
    })
  },
}))
