import { useEffect, useRef, useState } from 'react'
import { useAppStore, serveOf } from '../store/useAppStore'
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
  const cancelGame = useAppStore((s) => s.cancelGame)
  const sideOut = useAppStore((s) => s.sideOut)
  const switchServer = useAppStore((s) => s.switchServer)

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

  const handleCancel = async () => {
    const played = game.history.length > 0
    if (
      !window.confirm(
        played
          ? `Cancel this game at ${game.scoreA}-${game.scoreB}? It is deleted outright — no result, and no court time for anyone in it.`
          : 'Cancel this game? It is deleted outright and nobody is credited for it.',
      )
    )
      return
    stopRecognizer(recognizerRef.current)
    await cancelGame(gameId)
    onFinished()
  }

  const leader = game.scoreA === game.scoreB ? null : game.scoreA > game.scoreB ? 'A' : 'B'

  const serve = serveOf(game)
  // The server is a tracked player, not a position in the team list — the number and the
  // name are both read off the same serve, and CourtVisualizer reads the same player, so
  // the bold name, the call and the diagram can't disagree.
  const servingPair = serve.team === 'A' ? game.teams.teamA : game.teams.teamB
  const servingIndex = servingPair.indexOf(serve.serverId)
  // The doubles call: serving side's score, receiving side's score, server number.
  const call = `${serve.team === 'A' ? game.scoreA : game.scoreB}-${serve.team === 'A' ? game.scoreB : game.scoreA}-${serve.server}`

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
          only means anything as a pair, and the centre seam is the net. The serve strip
          is inside the same card because the serve is part of the game state, not a
          second thing to consult: on a phone a separate panel read as another screen. */}
      <div className="rounded-2xl border border-line bg-surface overflow-hidden">
        <div className="relative grid grid-cols-2">
          <span aria-hidden="true" className="absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-line" />
          <TeamScoreButton
            names={[nameOf(game.teams.teamA[0]), nameOf(game.teams.teamA[1])]}
            score={game.scoreA}
            trailing={leader === 'B'}
            servingIndex={serve.team === 'A' ? servingIndex : null}
            onTap={() => addPoint(gameId, 'A')}
          />
          <TeamScoreButton
            names={[nameOf(game.teams.teamB[0]), nameOf(game.teams.teamB[1])]}
            score={game.scoreB}
            trailing={leader === 'A'}
            servingIndex={serve.team === 'B' ? servingIndex : null}
            onTap={() => addPoint(gameId, 'B')}
          />
        </div>

        <ServeStrip
          call={call}
          partnerName={nameOf(servingPair[1 - servingIndex])}
          onSideOut={() => sideOut(gameId)}
          onSwitchServer={() => switchServer(gameId)}
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

      {/* Deliberately quiet and set apart from Finish: cancelling throws the game away,
          so it should never be the button you hit reaching for the one next to it. */}
      <button
        type="button"
        onClick={handleCancel}
        className="min-h-11 self-center px-4 label text-[0.55rem] text-muted active:text-danger transition-colors"
      >
        Cancel game
      </button>

      {game.stacking.enabled && <CourtVisualizer game={game} nameOf={nameOf} />}
    </section>
  )
}

function TeamScoreButton({
  names,
  score,
  trailing,
  servingIndex,
  onTap,
}: {
  names: [string, string]
  score: number
  /** Only the side that is actually behind recedes — at a tie both read at full weight. */
  trailing: boolean
  /** Which of the two is serving, or null when the other side has the serve. */
  servingIndex: number | null
  onTap: () => void
}) {
  const serving = servingIndex !== null
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`Add 1 point to ${names[0]} and ${names[1]}. Current score ${score}.${
        serving ? ` ${names[servingIndex]} is serving.` : ''
      }`}
      className="flex flex-col items-center gap-1.5 px-2 py-7 active:bg-sunken transition-colors"
    >
      {/* The server is named rather than described: on the serving side one of these two
          names carries the weight, which answers "whose serve?" without a second control
          to read. The other side stays uniformly muted so the contrast means something. */}
      <span className="text-[0.7rem] text-center leading-tight line-clamp-2 min-h-[2.1em] px-1">
        <span className={servingIndex === 0 ? 'text-ink font-semibold' : 'text-muted'}>{names[0]}</span>
        <span className="text-faint"> / </span>
        <span className={servingIndex === 1 ? 'text-ink font-semibold' : 'text-muted'}>{names[1]}</span>
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
      {/* One caption slot, two jobs: who is serving is worth more than a hint everyone
          has already learned, so the flare marker takes the line when it applies. */}
      {serving ? (
        <span className="label text-[0.5rem] text-flare flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-flare" />
          serving
        </span>
      ) : (
        <span className="label text-[0.5rem] text-faint">tap to score</span>
      )}
    </button>
  )
}

/**
 * The serve strip: the doubles call, the button that moves the serve on, and a quiet
 * correction for when the app has the wrong partner serving.
 *
 * There is no 1st/2nd server picker. `sideOut` walks the serve through every legal
 * position — 1st server, 2nd server, then over to the other team — and the number can
 * never be wrong on its own. What can be wrong is the *name*: the app doesn't see who
 * starts in which court, so "switch" says "it's the other one", once, and the app
 * carries the correction forward.
 */
function ServeStrip({
  call,
  partnerName,
  onSideOut,
  onSwitchServer,
}: {
  call: string
  partnerName: string
  onSideOut: () => void
  onSwitchServer: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-2">
      <p className="readout text-lg font-semibold tracking-tight" aria-label={`Call: ${call}`}>
        {call}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSwitchServer}
          aria-label={`${partnerName} is serving instead`}
          title="Wrong server? Switch to their partner"
          className="min-h-11 shrink-0 px-3 label text-[0.55rem] text-muted active:text-ink transition-colors"
        >
          Switch
        </button>
        <button
          type="button"
          onClick={onSideOut}
          title="Serving team lost the rally"
          className="min-h-11 shrink-0 rounded-lg border border-line bg-sunken px-4 label text-[0.55rem]"
        >
          Side out
        </button>
      </div>
    </div>
  )
}
