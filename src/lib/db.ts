import Dexie, { type Table } from 'dexie'
import type { Game, Player } from '../types/models'

export interface Setting {
  key: string
  value: number
}

export class AppDB extends Dexie {
  players!: Table<Player, string>
  games!: Table<Game, string>
  settings!: Table<Setting, string>

  constructor() {
    super('pickleball-stacking')
    this.version(1).stores({
      players: 'id, name, active, createdAt',
      games: 'id, status, createdAt, finishedAt',
    })
    this.version(2).stores({
      settings: 'key',
    })
  }
}

export const db = new AppDB()
