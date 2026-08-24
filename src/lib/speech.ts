export type SpeechCommand = 'point-a' | 'point-b' | 'undo'

interface SpeechRecognitionResultLike {
  results: { [index: number]: { [index: number]: { transcript: string } } }
  resultIndex: number
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionResultLike) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined
  return ctor ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

/** Parses a spoken phrase into a scoring command, or null if unrecognized. */
export function parseSpeechCommand(transcript: string): SpeechCommand | null {
  const t = transcript.toLowerCase().trim()
  if (/\bundo\b/.test(t)) return 'undo'
  if (/\b(team\s*a|point\s*a|side\s*a)\b/.test(t)) return 'point-a'
  if (/\b(team\s*b|point\s*b|side\s*b)\b/.test(t)) return 'point-b'
  return null
}

export function createScoreRecognizer(onCommand: (cmd: SpeechCommand) => void): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) return null

  const recognizer = new Ctor()
  recognizer.continuous = true
  recognizer.interimResults = false
  recognizer.lang = 'en-US'

  recognizer.onresult = (event) => {
    for (let i = event.resultIndex; event.results[i]; i++) {
      const transcript = event.results[i][0]?.transcript ?? ''
      const cmd = parseSpeechCommand(transcript)
      if (cmd) onCommand(cmd)
    }
  }

  return recognizer
}

/**
 * There is only one microphone, so only one recognizer may listen at a time.
 * With several courts live at once, two scoreboards listening would both hear
 * "team a" and each score a point on their own game. Starting a recognizer
 * therefore stops whichever one was listening before (its `onend` fires, so
 * that scoreboard drops back out of its listening state on its own).
 */
let activeRecognizer: SpeechRecognitionLike | null = null

export function startExclusively(recognizer: SpeechRecognitionLike) {
  if (activeRecognizer && activeRecognizer !== recognizer) {
    activeRecognizer.stop()
  }
  activeRecognizer = recognizer
  recognizer.start()
}

export function stopRecognizer(recognizer: SpeechRecognitionLike | null) {
  if (!recognizer) return
  if (activeRecognizer === recognizer) activeRecognizer = null
  recognizer.stop()
}
