import { db } from './db'
import { RELAY_TOKEN, RELAY_URL, type TimetableEvent } from './stundenplan'

/**
 * Mensa-Speiseplan Horb (Studierendenwerk Stuttgart / maxmanager), geholt über das Relais.
 * Tage, an denen man laut Stundenplan nicht am Campus ist (frei oder nur „E"-Gebäude),
 * werden in der Anzeige ausgegraut, bleiben aber einsehbar.
 */
export interface MensaItem {
  category: string
  name: string
  prices: string[] // [Studis, Bedienstete, Gäste]
  icons: string[] // Kennzeichen, z. B. VG, V, S, R, G
}

/** Kurz-Bezeichnungen der gängigen Kennzeichen (unbekannte werden als Code gezeigt). */
export const DIET_LABEL: Record<string, string> = {
  VG: 'vegan',
  V: 'vegetarisch',
  VR: 'Veganer Renner',
  S: 'Schwein',
  R: 'Rind',
  G: 'Geflügel',
  K: 'Kalb',
  L: 'Lamm',
  W: 'Wild',
  F: 'Fisch',
  FI: 'Fisch',
  MSC: 'MSC-Fisch',
  BIO: 'Bio',
}

const mensaKey = (date: string) => `mensa:horb:${date}`
const endpoint = (path: string) => RELAY_URL.replace(/\/+$/, '') + path + '?token=' + encodeURIComponent(RELAY_TOKEN)

/** Speiseplan eines Tages holen (mit gerätelokalem Zwischenspeicher als Rückfall). */
export async function getMensa(date: string): Promise<MensaItem[]> {
  const cached = (await db.meta.get(mensaKey(date)))?.value as { at: number; items: MensaItem[] } | undefined
  try {
    const res = await fetch(endpoint('/mensa') + '&date=' + encodeURIComponent(date))
    const data = (await res.json()) as { items?: MensaItem[]; error?: string }
    if (data.error) throw new Error(data.error)
    const items = data.items ?? []
    await db.meta.put({ key: mensaKey(date), value: { at: Date.now(), items } })
    return items
  } catch (e) {
    if (cached) return cached.items
    throw e
  }
}

/** Nur die „richtigen" Gerichte – Beilagen und Desserts werden generell ausgeblendet. */
export function mainDishes(items: MensaItem[]): MensaItem[] {
  return items.filter((it) => !/beilage|dessert/i.test(it.category))
}

/** Raum im „E"-Gebäude (anderes Gebäude): ein E direkt vor einer Zahl. */
export function isEBuildingRoom(room?: string | null): boolean {
  return /(^|[-\s])E\s?\d/i.test(String(room || ''))
}

/** Am Campus an diesem Tag? Mind. eine Vorlesung in einem Raum außerhalb des „E"-Gebäudes. */
export function onCampus(events: TimetableEvent[]): boolean {
  return events.some((e) => !!e.room && !isEBuildingRoom(e.room))
}
