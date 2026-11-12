import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, deleteExam, tombstone, type Exam } from './db'
import { applyDoc, docSignature, exportDoc, mergeDocs, type SyncDoc } from './sync'

const P = 'p1'

async function seed() {
  await db.profiles.add({ id: P, name: 'Test', createdAt: 0, minutesMobile: 20, minutesDesk: 30, retention: 0.9, activeSemesterId: 's1' })
  await db.semesters.add({ id: 's1', profileId: P, name: 'S5', createdAt: 0 })
  const exam: Exam = { id: 'e1', profileId: P, semesterId: 's1', name: 'TM', date: '2027-02-01', weight: 2, color: '#000', createdAt: 0 }
  await db.exams.add(exam)
}

const clone = (d: SyncDoc): SyncDoc => JSON.parse(JSON.stringify(d))

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('mergeDocs', () => {
  it('nimmt pro Datensatz den neueren Stand und vereinigt Hausaufgaben', async () => {
    await seed()
    const base = await exportDoc(P)
    const a = clone(base)
    const b = clone(base)
    a.exams[0] = { ...a.exams[0], name: 'TM alt', updatedAt: 100 }
    b.exams[0] = { ...b.exams[0], name: 'TM neu', updatedAt: 200 }
    a.homework.push({ id: 'ha', profileId: P, examId: 'e1', title: 'A', description: '', due: '2027-01-10', minutes: 30, createdAt: 1, updatedAt: 1 })
    b.homework.push({ id: 'hb', profileId: P, examId: 'e1', title: 'B', description: '', due: '2027-01-11', minutes: 30, createdAt: 2, updatedAt: 2 })
    const m = mergeDocs(a, b)
    expect(m.exams[0].name).toBe('TM neu')
    expect(m.homework.map((h) => h.id).sort()).toEqual(['ha', 'hb'])
    expect(mergeDocs(b, a).exams[0].name).toBe('TM neu')
  })

  it('überträgt gelöschte Prüfungen', async () => {
    await seed()
    const before = await exportDoc(P)
    await deleteExam('e1')
    const after = await exportDoc(P)
    const m = mergeDocs(after, before)
    expect(m.exams).toHaveLength(0)
  })

  it('behält eine Prüfung, die nach dem Löschen woanders weiterbearbeitet wurde', async () => {
    await seed()
    const doc = await exportDoc(P)
    const other = clone(doc)
    other.exams[0].updatedAt = Date.now() + 10_000
    doc.tombstones.push(tombstone('exams', 'e1', P, Date.now()))
    expect(mergeDocs(doc, other).exams).toHaveLength(1)
  })

  it('entfernt Prüfungen gelöschter Semester und wählt ein gültiges Semester', async () => {
    await seed()
    const doc = await exportDoc(P)
    doc.semesters.push({ id: 's2', profileId: P, name: 'S6', createdAt: 1, updatedAt: 1 })
    const other = clone(doc)
    other.tombstones.push(tombstone('semesters', 's1', P, Date.now() + 1000))
    const m = mergeDocs(doc, other)
    expect(m.exams).toHaveLength(0)
    expect(m.profile.activeSemesterId).toBe('s2')
  })
})

describe('applyDoc', () => {
  it('überschreibt keine lokale Änderung, die während des Abgleichs entstand', async () => {
    await seed()
    await db.homework.add({ id: 'h1', profileId: P, examId: 'e1', title: 'Blatt 1', description: '', due: '2027-01-10', minutes: 30, createdAt: 0 })
    const base = await exportDoc(P)
    const remote = clone(base)
    remote.exams[0] = { ...remote.exams[0], name: 'vom anderen Gerät', updatedAt: Date.now() + 5 }
    const merged = mergeDocs(base, remote)

    // Während des Abgleichs wird lokal die Hausaufgabe geändert.
    await db.homework.update('h1', { title: 'lokal geändert' })
    await applyDoc(merged, base)

    expect((await db.exams.get('e1'))!.name).toBe('vom anderen Gerät')
    expect((await db.homework.get('h1'))!.title).toBe('lokal geändert')
  })

  it('ändert nichts, wenn beide Stände gleich sind', async () => {
    await seed()
    const doc = await exportDoc(P)
    expect(docSignature(mergeDocs(doc, clone(doc)))).toBe(docSignature(doc))
  })
})

describe('syncProfile mit simulierter Dropbox', () => {
  const files = new Map<string, { data: Uint8Array; rev: number }>()
  let conflictsLeft = 0
  let calls: string[] = []

  beforeEach(() => {
    files.clear()
    conflictsLeft = 0
    calls = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const headerArg = (init.headers as Record<string, string>)['Dropbox-API-Arg']
      const arg = JSON.parse(String(headerArg ?? (typeof init.body === 'string' ? init.body : '{}')))
      calls.push(`${url.split('/2/')[1]} ${arg.path}`)
      if (url.endsWith('/files/get_metadata')) {
        const f = files.get(arg.path)
        return f ? Response.json({ rev: String(f.rev) }) : new Response('{}', { status: 409 })
      }
      if (url.endsWith('/files/list_folder')) {
        const entries = [...files.keys()].filter((p) => p.startsWith(arg.path + '/')).map((p) => ({ '.tag': 'file', name: p.split('/').pop(), path_lower: p }))
        return Response.json({ entries })
      }
      if (url.endsWith('/files/delete_v2')) {
        files.delete(arg.path)
        return Response.json({})
      }
      if (url.endsWith('/files/download')) {
        const f = files.get(arg.path)
        if (!f) return new Response('{}', { status: 409 })
        return new Response(f.data, { headers: { 'Dropbox-API-Result': JSON.stringify({ rev: String(f.rev) }) } })
      }
      if (url.endsWith('/files/upload')) {
        const f = files.get(arg.path)
        const mode = arg.mode
        if (conflictsLeft > 0 && typeof mode === 'object') {
          conflictsLeft--
          return new Response('{}', { status: 409 })
        }
        if ((mode === 'add' && f) || (typeof mode === 'object' && String(f?.rev) !== mode.update)) return new Response('{}', { status: 409 })
        const rev = (f?.rev ?? 0) + 1
        files.set(arg.path, { data: new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()), rev })
        return Response.json({ rev: String(rev) })
      }
      return new Response('{}', { status: 404 })
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  async function connect() {
    await db.meta.put({ key: `dropbox:${P}`, value: { accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600_000, connectedAt: 0 } })
  }

  it('lädt hoch und übernimmt Änderungen eines zweiten Geräts', async () => {
    const { syncProfile } = await import('./syncService')
    await seed()
    await connect()
    await syncProfile(P)
    expect(files.has(`/sync/${P}.lernsync`)).toBe(true)

    // Zweites Gerät: Stand ändern und als neue Version hochladen.
    const { exportDoc: exp } = await import('./sync')
    const other = await exp(P)
    other.exams[0] = { ...other.exams[0], name: 'Technische Mechanik', updatedAt: Date.now() + 1000 }
    const f = files.get(`/sync/${P}.lernsync`)!
    files.set(`/sync/${P}.lernsync`, { data: new TextEncoder().encode(JSON.stringify(other)), rev: f.rev + 1 })

    conflictsLeft = 1 // ein drittes Gerät funkt einmal dazwischen
    await syncProfile(P)
    expect((await db.exams.get('e1'))!.name).toBe('Technische Mechanik')
  })

  it('überträgt nichts, wenn sich nichts geändert hat, und lädt nur lokale Änderungen hoch', async () => {
    const { syncProfile } = await import('./syncService')
    await seed()
    await connect()
    await syncProfile(P)
    expect([...files.keys()].some((k) => k.startsWith(`/backups/${P}/`))).toBe(true)

    calls = []
    await syncProfile(P)
    expect(calls).toEqual([`files/get_metadata /sync/${P}.lernsync`])

    await db.exams.update('e1', { name: 'Geändert' })
    calls = []
    await syncProfile(P)
    expect(calls.some((c) => c.startsWith('files/download'))).toBe(false)
    expect(calls.filter((c) => c.startsWith('files/upload /sync'))).toHaveLength(1)
  })

  it('behält nur die letzten acht Wochensicherungen', async () => {
    const { syncProfile } = await import('./syncService')
    await seed()
    await connect()
    for (let w = 1; w <= 9; w++) files.set(`/backups/${P}/2026-KW${String(w).padStart(2, '0')}.lernsync`, { data: new Uint8Array(), rev: 1 })
    await syncProfile(P)
    const backups = [...files.keys()].filter((k) => k.startsWith(`/backups/${P}/`)).sort()
    expect(backups).toHaveLength(8)
    expect(backups[0]).toBe(`/backups/${P}/2026-KW03.lernsync`)
  })
})
