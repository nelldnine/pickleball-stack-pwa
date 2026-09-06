import { useMemo, useState } from 'react'
import { courtPositionsForScore } from '../lib/stacking'
import { serveOf } from '../store/useAppStore'
import type { Game } from '../types/models'

export function CourtVisualizer({
  game,
  nameOf,
}: {
  game: Game
  nameOf: (id: string) => string
}) {
  // The serve lives on the game now, controlled from the scoreboard above — the diagram
  // reads it rather than keeping a second, silently disagreeing copy.
  const serve = serveOf(game)
  const servingTeam = serve.team
  const servingPair = servingTeam === 'A' ? game.teams.teamA : game.teams.teamB
  const serverId = servingPair[serve.server - 1]
  const servingScore = servingTeam === 'A' ? game.scoreA : game.scoreB

  const positions = useMemo(
    () => courtPositionsForScore(game.teams, game.stacking, servingTeam, serverId, servingScore),
    [game.teams, game.stacking, servingTeam, serverId, servingScore],
  )

  const cell = (team: 'A' | 'B', side: 'left' | 'right') => {
    const pos = positions.find((p) => p.team === team && p.stackedSide === side)
    return pos
  }

  const [signals, setSignals] = useState<Record<'A' | 'B', 'stay' | 'switch'>>({ A: 'stay', B: 'stay' })
  const setSignal = (team: 'A' | 'B', signal: 'stay' | 'switch') =>
    setSignals((cur) => ({ ...cur, [team]: signal }))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="label text-[0.58rem] text-muted">Court positions</h3>
        <p className="label text-[0.55rem] text-flare flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-flare" />
          Team {servingTeam} serving
        </p>
      </div>

      <svg
        role="img"
        aria-label={`Court diagram: ${nameOf(serverId)} serving, players positioned by stacking preference.`}
        viewBox="0 0 300 200"
        className="w-full rounded-xl border border-line bg-court-soft"
      >
        {/* Centre line, then the net across the middle — court markings, drawn like court markings. */}
        <line x1="150" y1="0" x2="150" y2="200" stroke="currentColor" strokeWidth="1.5" className="text-court/35" />
        <line x1="0" y1="100" x2="300" y2="100" stroke="currentColor" strokeWidth="2" className="text-court/55" />

        <Quadrant x={0} y={0} label="B · left" pos={cell('B', 'left')} nameOf={nameOf} />
        <Quadrant x={150} y={0} label="B · right" pos={cell('B', 'right')} nameOf={nameOf} />
        <Quadrant x={0} y={100} label="A · left" pos={cell('A', 'left')} nameOf={nameOf} />
        <Quadrant x={150} y={100} label="A · right" pos={cell('A', 'right')} nameOf={nameOf} />
      </svg>

      <div className="grid grid-cols-2 gap-3">
        <HandSignal team="A" label={`Team A (${nameOf(game.teams.teamA[0])} / ${nameOf(game.teams.teamA[1])})`} signal={signals.A} onChange={(s) => setSignal('A', s)} />
        <HandSignal team="B" label={`Team B (${nameOf(game.teams.teamB[0])} / ${nameOf(game.teams.teamB[1])})`} signal={signals.B} onChange={(s) => setSignal('B', s)} />
      </div>

      <ul className="text-xs text-muted flex flex-col gap-1.5">
        {positions.map((p) => (
          <li key={p.playerId} className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${p.role === 'partner' ? 'bg-faint' : 'bg-court'}`}
              aria-hidden="true"
            />
            <span>
              {nameOf(p.playerId)} — {p.role}
              {p.requiredSide ? ` (must stand ${p.requiredSide})` : ' (free to stack)'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function HandSignal({
  team,
  label,
  signal,
  onChange,
}: {
  team: 'A' | 'B'
  label: string
  signal: 'stay' | 'switch'
  onChange: (signal: 'stay' | 'switch') => void
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2">
      <p className="label text-[0.5rem] text-faint mb-1 truncate">{label}</p>
      <div className="flex gap-2" role="group" aria-label={`Hand signal for ${label}`}>
        <button
          type="button"
          onClick={() => onChange('stay')}
          aria-pressed={signal === 'stay'}
          aria-label={`Team ${team} signal: stay (closed fist)`}
          className={`min-h-11 flex-1 rounded-lg text-2xl ${signal === 'stay' ? 'bg-court-soft ring-2 ring-court' : 'bg-sunken'}`}
        >
          ✊
        </button>
        <button
          type="button"
          onClick={() => onChange('switch')}
          aria-pressed={signal === 'switch'}
          aria-label={`Team ${team} signal: switch (open hand)`}
          className={`min-h-11 flex-1 rounded-lg text-2xl ${signal === 'switch' ? 'bg-court-soft ring-2 ring-court' : 'bg-sunken'}`}
        >
          ✋
        </button>
      </div>
    </div>
  )
}

function Quadrant({
  x,
  y,
  label,
  pos,
  nameOf,
}: {
  x: number
  y: number
  label: string
  pos: ReturnType<typeof courtPositionsForScore>[number] | undefined
  nameOf: (id: string) => string
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <text x={75} y={16} textAnchor="middle" className="fill-current text-muted text-[7px]">
        {label}
      </text>
      {pos && (
        <>
          <circle cx={75} cy={60} r={22} className={pos.role === 'partner' ? 'fill-faint' : 'fill-court'} />
          <text x={75} y={64} textAnchor="middle" className="fill-white text-[9px] font-medium">
            {nameOf(pos.playerId).slice(0, 10)}
          </text>
        </>
      )}
    </g>
  )
}
