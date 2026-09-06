import { useCallback, useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/** How often to ask the server whether a new build has been deployed. */
const POLL_MS = 60 * 60 * 1000

export type UpdateStatus = 'idle' | 'checking' | 'ready' | 'current'

/**
 * A new build only reaches an installed app when something asks for it. The service
 * worker checks on page load, and an iOS home-screen app is resumed from a frozen
 * process for days without ever performing one — which is why a stale install used to
 * need deleting. So we check on a timer, and again every time the app comes back to
 * the foreground, and give the user an explicit way to ask.
 *
 * `registerType` is `prompt` rather than `autoUpdate` on purpose: this app is used
 * mid-game, and a silent reload would take the scoreboard away between points.
 * (Scores are in IndexedDB and would survive, but the surprise isn't worth it.)
 */
export function useAppUpdate() {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const applyUpdate = useRef<(reload?: boolean) => Promise<void>>(undefined)

  useEffect(() => {
    applyUpdate.current = registerSW({
      onNeedRefresh: () => setStatus('ready'),
      onRegisteredSW: (_url, reg) => {
        registration.current = reg
      },
    })
  }, [])

  const check = useCallback(async (manual: boolean) => {
    const reg = registration.current
    if (!reg) return
    if (manual) setStatus((s) => (s === 'ready' ? s : 'checking'))
    try {
      await reg.update()
    } catch {
      // Offline, or the server is unreachable. Nothing to tell the user: they either
      // already have the newest build they can get, or they'll find out next check.
    }
    // `update()` resolves once the new worker has been fetched, which can be before it
    // finishes installing and before onNeedRefresh fires. Anything already installing or
    // waiting means an update is genuinely on its way, so don't claim to be up to date.
    const pending = Boolean(reg.installing ?? reg.waiting)
    if (manual) setStatus((s) => (s === 'checking' ? (pending ? 'checking' : 'current') : s))
  }, [])

  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === 'visible') check(false)
    }
    const timer = setInterval(() => check(false), POLL_MS)
    document.addEventListener('visibilitychange', onForeground)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onForeground)
    }
  }, [check])

  /**
   * Activate the waiting worker, then reload into it.
   *
   * The reload is ours on purpose. `registerSW`'s own handler fires only when the
   * `controlling` event reports `isUpdate`, which needs the page to have already been
   * under a worker's control — false on the first run after registering, and false again
   * whenever the worker activates without claiming this client. In those cases the button
   * would swap the build in behind the scenes and look like it did nothing at all.
   */
  const update = useCallback(async () => {
    let reloaded = false
    const reload = () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    }
    // Controlled page: the new worker takes over and we reload the moment it does.
    navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true })
    await applyUpdate.current?.()
    // Uncontrolled page: nothing will ever claim it, so reload on our own once the
    // skip-waiting message has had time to land. The fresh load picks up the new worker.
    setTimeout(reload, 2000)
  }, [])

  return {
    status,
    /** Ask the server now. Surfaces a "you're up to date" answer, unlike the background checks. */
    checkNow: () => check(true),
    update,
  }
}
