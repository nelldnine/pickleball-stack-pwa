import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { CourtVisualizer } from './CourtVisualizer'
import { createScoreRecognizer, isSpeechRecognitionSupported } from '../lib/speech'

export function Scoreboard({ gameId, onFinished }: { gameId: string; onFinished: () => void }) {
  const game = useAppStore((s) => s.games.find((g) => g.id === gameId))
  const players = useAppStore((s) => s.players)
  const addPoint = useAppStore((s) => s.addPoint)
  const undoLastPoint = useAppStore((s) => s.undoLastPoint)
  const finishGame = useAppStore((s) => s.finishGame)

  const [listening, setListening] = useState(false)
  const recognizerRef = useRef<ReturnType<typeof createScoreRecognizer>>(null)

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?'

  useEffect(() => {
    recognizerRef.current = createScoreRecognizer((cmd) => {
      if (cmd === 'point-a') addPoint(gameId, 'A')
      else if (cmd === 'point-b') addPoint(gameId, 'B')
      else if (cmd === 'undo') undoLastPoint(gameId)
    })
    const recognizer = recognizerRef.current
    if (recognizer) {
      recognizer.onend = () => setListening(false)
    }
    return () => {
      recognizer?.stop()
    }
  }, [gameId, addPoint, undoLastPoint])

  const toggleListening = () => {
    const recognizer = recognizerRef.current
    if (!recognizer) return
    if (listening) {
      recognizer.stop()
      setListening(false)
    } else {
      recognizer.start()
      setListening(true)
    }
  }

  if (!game) return <p className="text-sm text-text-soft">Game not found.</p>

  const handleFinish = async () => {
    recognizerRef.current?.stop()
    await finishGame(gameId)
    onFinished()
  }

  return (
    <section aria-labelledby="score-heading" className="flex flex-col gap-5 pt-2">
      <h2 id="score-heading" className="sr-only">
        Live score
      </h2>

      <div className="grid grid-cols-2 gap-3">
        <TeamScoreButton
          label={`${nameOf(game.teams.teamA[0])} / ${nameOf(game.teams.teamA[1])}`}
          score={game.scoreA}
          onTap={() => addPoint(gameId, 'A')}
        />
        <TeamScoreButton
          label={`${nameOf(game.teams.teamB[0])} / ${nameOf(game.teams.teamB[1])}`}
          score={game.scoreB}
          onTap={() => addPoint(gameId, 'B')}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => undoLastPoint(gameId)}
          disabled={game.history.length === 0}
          className="min-h-11 flex-1 rounded-lg border border-border px-4 text-base text-text disabled:opacity-40"
        >
          Undo last point
        </button>
        <button
          type="button"
          onClick={handleFinish}
          className="min-h-11 flex-1 rounded-lg bg-text px-4 text-base font-medium text-bg"
        >
          Finish game
        </button>
      </div>

      {isSpeechRecognitionSupported() && (
        <button
          type="button"
          onClick={toggleListening}
          aria-pressed={listening}
          className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${
            listening ? 'border-danger/40 bg-danger/10 text-danger' : 'border-border text-text-soft'
          }`}
        >
          {listening ? '● Listening — say "team a", "team b", or "undo"' : '🎤 Voice score entry'}
        </button>
      )}

      {game.stacking.enabled && <CourtVisualizer game={game} nameOf={nameOf} />}
    </section>
  )
}

function TeamScoreButton({ label, score, onTap }: { label: string; score: number; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`Add 1 point to ${label}. Current score ${score}.`}
      className="flex flex-col items-center gap-1 rounded-2xl bg-surface border border-border py-8 active:bg-surface-sunken transition-colors"
    >
      <span className="text-xs font-medium text-text-soft px-2 text-center truncate max-w-full">{label}</span>
      <span aria-live="polite" aria-atomic="true" className="text-7xl font-bold tabular-nums text-text">
        {score}
      </span>
      <span className="text-[0.65rem] text-text-soft">tap to add point</span>
    </button>
  )
}
