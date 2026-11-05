import { RELAY_TOKEN, RELAY_URL, type StundenplanConfig } from './stundenplan'
import { ensureCourseConfig } from './course'

/**
 * Web-Push-Benachrichtigungen bei Stundenplan-Änderungen. Das Abo (Push-Subscription)
 * plus DUALIS-Login wird im Relais gespeichert; ein Cloudflare-Cron prüft dort regelmäßig
 * den Plan und schickt bei Änderungen eine Benachrichtigung – auch wenn die App zu ist.
 * Öffentlicher VAPID-Schlüssel (muss zum privaten Schlüssel im Relais passen).
 */
const VAPID_PUBLIC = 'BGR-6HaHHNzscQeWvNv8PB6rQLLFUB_g-nVRrj35BsyvuKZZm3Ugy7jS-pEkI3B9_4VoUJoFScChtPeDQQ2Nb6w'

const endpoint = (path: string) => RELAY_URL.replace(/\/+$/, '') + path + '?token=' + encodeURIComponent(RELAY_TOKEN)

function urlB64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Unterstützt dieses Gerät Web Push? (iPhone: erst nach „Zum Home-Bildschirm“.) */
export function pushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready)
}

async function currentSub(): Promise<PushSubscription | null> {
  try {
    const reg = await registration()
    return reg ? await reg.pushManager.getSubscription() : null
  } catch {
    return null
  }
}

export async function pushEnabled(): Promise<boolean> {
  return !!(await currentSub())
}

/** Benachrichtigungen einschalten: Erlaubnis holen, abonnieren, Abo + Login ans Relais. */
export async function enablePush(profileId: string, cfg: StundenplanConfig): Promise<void> {
  if (!pushSupported()) {
    throw new Error('Dieses Gerät unterstützt keine Benachrichtigungen. Auf dem iPhone die App zuerst über „Teilen → Zum Home-Bildschirm“ installieren.')
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.')
  const reg = await registration()
  if (!reg) throw new Error('Service Worker ist noch nicht bereit – App einmal neu laden.')
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID_PUBLIC) }))
  // Kurs + Mitglied mitschicken, damit das Relais die Kurs-Noten serverseitig frisch halten kann.
  const course = await ensureCourseConfig(profileId).catch(() => undefined)
  const res = await fetch(endpoint('/push/subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DUALIS-USER': cfg.user, 'X-DUALIS-PASS': cfg.pass },
    body: JSON.stringify({ subscription: sub.toJSON(), course: course?.course, memberId: course?.memberId }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || data.error) {
    await sub.unsubscribe().catch(() => {})
    throw new Error(data.error || 'Anmeldung beim Relais fehlgeschlagen.')
  }
}

/** Benachrichtigungen ausschalten: Abo im Relais löschen und lokal abbestellen. */
export async function disablePush(cfg: StundenplanConfig): Promise<void> {
  const sub = await currentSub()
  if (!sub) return
  await fetch(endpoint('/push/unsubscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DUALIS-USER': cfg.user, 'X-DUALIS-PASS': cfg.pass },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

/** Testbenachrichtigung über das Relais auslösen. */
export async function sendPushTest(cfg: StundenplanConfig): Promise<void> {
  const sub = await currentSub()
  if (!sub) throw new Error('Erst Benachrichtigungen einschalten.')
  const res = await fetch(endpoint('/push/test'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DUALIS-USER': cfg.user, 'X-DUALIS-PASS': cfg.pass },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || data.error) throw new Error(data.error || 'Test fehlgeschlagen.')
}
