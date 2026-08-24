import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { CourtVisualizer } from './CourtVisualizer'
import {
  createScoreRecognizer,
  isSpeechRecognitionSupported,
  startExclusively,
  stopRecognizer,
} from '../lib/speech'

export function Scoreboard({
  gameId,
  onFinished,
  showCourtLabel,
}: {
  gameId: string
  onFinished: () => void
  showCourtLabel?: boolean
}) {
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
      stopRecognizer(recognizer)
    }
  }, [gameId, addPoint, undoLastPoint])

  const toggleListening = () => {
    const recognizer = recognizerRef.current
    if (!recognizer) return
    if (listening) {
      stopRecognizer(recognizer)
      setListening(false)
    } else {
      startExclusively(recognizer)
      setListening(true)
    }
  }

  if (!game) return <p className="text-sm text-muted">Game not found.</p>

  const handleFinish = async () => {
    stopRecognizer(recognizerRef.current)
    await finishGame(gameId)
    onFinished()
  }

  const leader = game.scoreA === game.scoreB ? null : game.scoreA > game.scoreB ? 'A' : 'B'

  return (
    <section aria-labelledby={`score-heading-${gameId}`} className="flex flex-col gap-3">
      <h2 id={`score-heading-${gameId}`} className="sr-only">
        Live score{showCourtLabel ? ` on court ${game.court ?? 1}` : ''}
      </h2>

      {showCourtLabel && (
        <p className="label text-[0.58rem] text-muted flex items-center gap-2">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-flare" />
          Court {game.court ?? 1}
        </p>
      )}

      {/* One instrument split down the middle, not two separate cards — the score
          only means anything as a pair, and the centre seam is the net. */}
      <div className="relative grid grid-cols-2 rounded-2xl border border-line bg-surface overflow-hidden">
        <span aria-hidden="true" className="absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-line" />
        <TeamScoreButton
          label={`${nameOf(game.teams.teamA[0])} / ${nameOf(game.teams.teamA[1])}`}
          score={game.scoreA}
          trailing={leader === 'B'}
          onTap={() => addPoint(gameId, 'A')}
        />
        <TeamScoreButton
          label={`${nameOf(game.teams.teamB[0])} / ${nameOf(game.teams.teamB[1])}`}
          score={game.scoreB}
          trailing={leader === 'A'}
          onTap={() => addPoint(gameId, 'B')}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => undoLastPoint(gameId)}
          disabled={game.history.length === 0}
          className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-4 text-sm font-medium disabled:opacity-30"
        >
          Undo point
        </button>
        {isSpeechRecognitionSupported() && (
          <button
            type="button"
            onClick={toggleListening}
            aria-pressed={listening}
            aria-label={listening ? 'Stop voice scoring' : 'Start voice scoring'}
            title={listening ? 'Listening — say "team a", "team b", or "undo"' : 'Voice scoring'}
            className={`min-h-11 w-12 shrink-0 rounded-xl border flex items-center justify-center ${
              listening ? 'border-flare bg-flare-soft text-flare' : 'border-line bg-surface text-muted'
            }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="2.5" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={handleFinish}
          className="min-h-11 flex-1 rounded-xl bg-ink px-4 text-sm font-semibold text-paper"
        >
          Finish
        </button>
      </div>

      {listening && (
        <p className="label text-[0.55rem] text-flare">Listening · say "team a", "team b", or "undo"</p>
      )}

      {game.stacking.enabled && <CourtVisualizer game={game} nameOf={nameOf} />}
    </section>
  )
}

function TeamScoreButton({
  label,
  score,
  trailing,
  onTap,
}: {
  label: string
  score: number
  /** Only the side that is actually behind recedes — at a tie both read at full weight. */
  trailing: boolean
  onTap: () => void
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`Add 1 point to ${label}. Current score ${score}.`}
      className="flex flex-col items-center gap-1.5 px-2 py-7 active:bg-sunken transition-colors"
    >
      <span className="text-[0.7rem] text-muted text-center leading-tight line-clamp-2 min-h-[2.1em] px-1">
        {label}
      </span>
      <span
        aria-live="polite"
        aria-atomic="true"
        className={`readout text-[4.25rem] leading-none font-bold transition-colors ${
          trailing ? 'text-faint' : 'text-ink'
        }`}
      >
        {score}
      </span>
      <span className="label text-[0.5rem] text-faint">tap to score</span>
    </button>
  )
}
