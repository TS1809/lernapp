import { expect, type BrowserContext, type Page, type Route } from '@playwright/test'

/** Inhalt der simulierten Dropbox – wird von allen „Geräten“ eines Tests geteilt. */
export interface FakeDropbox {
  files: Map<string, { body: Buffer; rev: number }>
  /** Aufgerufene API-Endpunkte, z. B. „files/get_metadata“ */
  requests: string[]
}

export const newDropbox = (): FakeDropbox => ({ files: new Map(), requests: [] })

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'Dropbox-API-Result' }

/**
 * Leitet Anmeldung und API-Aufrufe von Dropbox auf eine Simulation im Speicher um.
 * Bildet die für die App relevanten Regeln nach (Versionen, Konflikte bei veralteter rev).
 */
export async function useFakeDropbox(context: BrowserContext, box: FakeDropbox) {
  await context.route('https://www.dropbox.com/oauth2/authorize**', (route) => {
    const u = new URL(route.request().url())
    route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?code=test&state=${u.searchParams.get('state')}` } })
  })
  const api = async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { ...CORS, 'access-control-allow-methods': 'POST' } })
    const url = req.url()
    const endpoint = url.split('/').slice(-2).join('/')
    box.requests.push(endpoint)
    const header = req.headers()['dropbox-api-arg']
    let arg: { path?: string; mode?: unknown } = {}
    try {
      arg = JSON.parse(header ?? req.postData() ?? '{}')
    } catch {
      // Formular-Daten (OAuth-Token) – kein JSON
    }
    const key = String(arg.path ?? '').toLowerCase()
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: CORS, json: body })

    if (endpoint === 'oauth2/token') return json({ access_token: 'a', refresh_token: 'r', expires_in: 14400 })
    if (endpoint === 'files/get_metadata') {
      const f = box.files.get(key)
      return f ? json({ rev: String(f.rev) }) : json({}, 409)
    }
    if (endpoint === 'files/download') {
      const f = box.files.get(key)
      if (!f) return json({}, 409)
      return route.fulfill({ headers: { ...CORS, 'Dropbox-API-Result': JSON.stringify({ rev: String(f.rev) }) }, body: f.body })
    }
    if (endpoint === 'files/upload') {
      const f = box.files.get(key)
      const mode = arg.mode
      if ((mode === 'add' && f) || (mode && typeof mode === 'object' && String(f?.rev) !== (mode as { update: string }).update)) return json({}, 409)
      const rev = (f?.rev ?? 0) + 1
      box.files.set(key, { body: req.postDataBuffer() ?? Buffer.alloc(0), rev })
      return json({ rev: String(rev) })
    }
    if (endpoint === 'files/list_folder') {
      const entries = [...box.files.keys()].filter((p) => p.startsWith(key + '/')).map((p) => ({ '.tag': 'file', name: p.split('/').pop(), path_lower: p }))
      return json({ entries })
    }
    if (endpoint === 'files/delete_v2') {
      box.files.delete(key)
      return json({})
    }
    if (endpoint === 'token/revoke') return json({})
    return json({}, 404)
  }
  await context.route('https://api.dropboxapi.com/**', api)
  await context.route('https://content.dropboxapi.com/**', api)
}

/** Fängt Fehler der Seite ab, damit jeder Test am Ende „keine Fehler“ prüfen kann. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    // 409 von Dropbox ist erwartet (Datei existiert noch nicht / Versionskonflikt) und wird von der App behandelt.
    if (m.type() === 'error' && !(m.text().includes('status of 409') && m.location().url.includes('dropboxapi.com'))) errors.push(m.text())
  })
  page.on('dialog', (d) => d.accept())
  if (process.env.E2E_DEBUG) page.on('console', (m) => console.log('[browser]', m.type(), m.text()))
  return errors
}

export async function onboard(page: Page, { name = 'Test', kind = 'Dual' }: { name?: string; kind?: 'Dual' | 'Regulär' } = {}) {
  await page.goto('./')
  await page.getByPlaceholder('Vorname').fill(name)
  await page.getByRole('radio', { name: new RegExp(`^${kind}`) }).click()
  await page.getByRole('button', { name: 'Los geht’s' }).click()
  await expect(page.locator('.widget').first()).toBeVisible()
  // Lern-Kacheln sind seit dem Orga-App-Umbau standardmäßig aus; die Tests brauchen sie eingeblendet.
  await enableLernkacheln(page)
}

/** Blendet die (standardmäßig ausgeblendeten) Lern-Kacheln über die Einstellungen ein. */
export async function enableLernkacheln(page: Page) {
  await page.goto('./#/einstellungen')
  const labels = ['Unterwegs (Karten lernen)', 'Schreibtisch (Rechenaufgaben)', 'Nächste Klausur', 'Lernserie', 'Kartenpaket importieren']
  for (const label of labels) {
    const box = page.getByRole('checkbox', { name: label })
    if (await box.isChecked()) continue
    // Kontrollierte Checkbox via Live-Query: klicken und auf den persistierten Zustand warten.
    await box.click()
    await expect(box).toBeChecked()
  }
  await page.goto('./')
  await expect(page.locator('.widget').first()).toBeVisible()
}

export const isoIn = (days: number) => {
  const d = new Date(Date.now() + days * 864e5)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Legt eine Prüfung an; danach steht die Seite auf der Prüfung. */
export async function createExam(page: Page, name: string, daysAhead = 60) {
  await page.goto('./#/pruefung/neu')
  await page.getByPlaceholder('z. B. Thermodynamik II').fill(name)
  await page.locator('input[type=date]').fill(isoIn(daysAhead))
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

/** Importiert das Beispielpaket oder eine Paketdatei – in die erkannte bzw. einzige Prüfung oder in `exam`. */
export async function importPackage(page: Page, file?: string, exam?: string) {
  await page.goto('./#/import')
  if (file) await page.locator('input[type=file]').first().setInputFiles(file)
  else await page.getByRole('button', { name: 'Beispielpaket ausprobieren' }).click()
  // Erst auf die Paketvorschau warten – sonst träfe die Auswahl das Feld im Text-Import, das danach verschwindet.
  const submit = page.getByRole('button', { name: /^(Importieren|Aktualisieren)$/ })
  await expect(submit).toBeVisible()
  if (exam) await page.getByLabel('Für welche Prüfung?').selectOption({ label: exam })
  await submit.click()
  await expect(page.getByText('Import abgeschlossen')).toBeVisible()
}

/** Deckt die aktuelle Karte auf (beantwortet Multiple Choice mit der ersten Option). */
export async function revealCard(page: Page) {
  await expect(page.locator('.flashcard')).toBeVisible()
  // Nach dem Knopf entscheiden, nicht nach der Zahl der Optionen: Die zählt sonst womöglich noch die vorige Karte.
  const button = page.locator('.actions .btn.primary')
  await expect(button).toBeVisible()
  if ((await button.innerText()).trim() === 'Prüfen') {
    await page.locator('.option').first().click()
    await expect(button).toBeEnabled()
  }
  await button.click()
  await expect(page.locator('.ratings')).toBeVisible()
}

export async function rate(page: Page, label: 'Nochmal' | 'Schwer' | 'Gut' | 'Einfach') {
  await page.locator('.ratings button', { hasText: label }).click()
}

/** Anzahl der Datensätze in einer Tabelle der lokalen Datenbank. */
export async function countRows(page: Page, table: string): Promise<number> {
  return page.evaluate(
    (t) =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open('lernapp')
        r.onsuccess = () => {
          const q = r.result.transaction(t).objectStore(t).count()
          q.onsuccess = () => resolve(q.result)
        }
      }),
    table,
  )
}

/** Verbindet das aktuelle Profil mit der (simulierten) Dropbox und wartet auf den ersten Abgleich. */
export async function connectDropbox(page: Page) {
  await page.goto('./#/einstellungen')
  await page.getByRole('button', { name: 'Mit Dropbox verbinden' }).click()
  await expect(page.getByText('Mit Dropbox verbunden.')).toBeVisible()
  await expect(page.getByText(/Zuletzt abgeglichen/)).toBeVisible({ timeout: 15_000 })
}
