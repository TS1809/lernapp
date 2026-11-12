import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * App-Updates: Eine neue Version wird nie mitten in einer Lernsitzung oder Probeklausur
 * aktiviert. Direkt nach dem Start wird sie still übernommen, sonst erscheint ein Hinweis.
 */
const STARTUP_MS = 10_000
const startedAt = Date.now()
const listeners = new Set<() => void>()
let available = false

/** Seiten, die ein Neuladen unterbrechen würde. (Derzeit keine – reine Orga-App.) */
export const isBusyRoute = () => false

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (Date.now() - startedAt < STARTUP_MS && !isBusyRoute()) {
      updateSW(true)
      return
    }
    available = true
    listeners.forEach((l) => l())
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return
    // Installierte Web-Apps laufen oft tagelang – beim Zurückkehren nach Updates sehen.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {})
    })
  },
})

export const applyUpdate = () => updateSW(true)

export function useUpdateAvailable() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => available,
  )
}
