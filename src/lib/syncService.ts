import { db } from './db'
import { isoWeek } from './dates'
import { adoptPendingTokens, deleteFile, download, DropboxError, getRev, listFolder, upload } from './dropbox'
import { applyDoc, docSignature, exportDoc, mergeDocs, parseSyncDoc, replaceProfile, type SyncDoc } from './sync'

const syncPath = (profileId: string) => `/sync/${profileId}.lernsync`
const backupFolder = (profileId: string) => `/backups/${profileId}`
/** So viele Wochensicherungen bleiben in Dropbox erhalten. */
const KEEP_BACKUPS = 8

async function encode(doc: SyncDoc): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new TextEncoder().encode(JSON.stringify(doc))
  if (typeof CompressionStream === 'undefined') return bytes
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decode(data: Uint8Array<ArrayBuffer>): Promise<SyncDoc> {
  let bytes = data
  // gzip erkennt man an den ersten beiden Bytes; ältere Browser speichern unkomprimiert.
  if (data[0] === 0x1f && data[1] === 0x8b) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
    bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return parseSyncDoc(JSON.parse(new TextDecoder().decode(bytes)))
}

export interface SyncStatus {
  lastSync?: number
  error?: string
  /** Dropbox-Version der Sync-Datei beim letzten Abgleich */
  rev?: string
  /** Fingerabdruck des lokalen Stands nach dem letzten Abgleich */
  localSig?: string
  backupWeek?: string
}

const statusKey = (profileId: string) => `syncstatus:${profileId}`

export async function getSyncStatus(profileId: string): Promise<SyncStatus> {
  return ((await db.meta.get(statusKey(profileId)))?.value as SyncStatus | undefined) ?? {}
}

async function setSyncStatus(profileId: string, s: SyncStatus) {
  await db.meta.put({ key: statusKey(profileId), value: s })
}

/**
 * Gleicht ein Profil mit Dropbox ab. Zuerst wird nur die Dateiversion abgefragt:
 * - nichts geändert (weder hier noch anderswo) → fertig, kein Datentransfer
 * - nur hier geändert → hochladen
 * - anderswo geändert → herunterladen, zusammenführen, lokal übernehmen, hochladen
 * Hat ein anderes Gerät zwischenzeitlich hochgeladen, wird neu begonnen.
 */
export async function syncProfile(profileId: string, now = Date.now()) {
  const status = await getSyncStatus(profileId)
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const path = syncPath(profileId)
      const base = await exportDoc(profileId)
      const baseSig = docSignature(base)
      const remoteRev = await getRev(profileId, path)
      let rev: string
      let doc: SyncDoc

      try {
        if (remoteRev && remoteRev === status.rev) {
          // Seit dem letzten Abgleich hat kein anderes Gerät hochgeladen.
          rev = baseSig === status.localSig ? remoteRev : await upload(profileId, path, await encode({ ...base, savedAt: now }), remoteRev)
          doc = base
        } else {
          const remote = remoteRev ? await download(profileId, path) : null
          const remoteDoc = remote ? await decode(remote.data) : undefined
          if (remoteDoc && remoteDoc.profile.id !== profileId) throw new DropboxError('Die Daten in Dropbox gehören zu einem anderen Profil.')
          const merged = remoteDoc ? mergeDocs(base, remoteDoc) : base
          if (docSignature(merged) !== baseSig) await applyDoc(merged, base)
          rev =
            remote && remoteDoc && docSignature(merged) === docSignature(remoteDoc)
              ? remote.rev
              : await upload(profileId, path, await encode({ ...merged, savedAt: now }), remote ? remote.rev : null)
          doc = merged
        }
      } catch (e) {
        if (e instanceof DropboxError && e.conflict) continue
        throw e
      }

      const next: SyncStatus = { ...status, rev, localSig: docSignature(await exportDoc(profileId)), lastSync: Date.now(), error: undefined }
      next.backupWeek = await weeklyBackup(profileId, doc, now, status.backupWeek).catch(() => status.backupWeek)
      await setSyncStatus(profileId, next)
      return
    }
    throw new DropboxError('Ein anderes Gerät synchronisiert gerade. Bitte gleich noch einmal versuchen.')
  } catch (e) {
    await setSyncStatus(profileId, { ...(await getSyncStatus(profileId)), error: (e as Error).message })
    throw e
  }
}

/** Legt einmal pro Kalenderwoche eine Sicherung in Dropbox ab und behält die letzten acht. */
async function weeklyBackup(profileId: string, doc: SyncDoc, now: number, lastWeek?: string): Promise<string> {
  const week = isoWeek(now)
  if (week === lastWeek) return week
  await upload(profileId, `${backupFolder(profileId)}/${week}.lernsync`, await encode({ ...doc, savedAt: now }))
  const old = (await listBackups(profileId)).slice(KEEP_BACKUPS)
  for (const b of old) await deleteFile(profileId, b.path)
  return week
}

export interface BackupEntry {
  week: string
  path: string
}

/** Wochensicherungen in Dropbox, neueste zuerst. */
export async function listBackups(profileId: string): Promise<BackupEntry[]> {
  return (await listFolder(profileId, backupFolder(profileId)))
    .filter((f) => f.name.endsWith('.lernsync'))
    .map((f) => ({ week: f.name.replace(/\.lernsync$/, ''), path: f.path }))
    .sort((a, b) => b.week.localeCompare(a.week))
}

/**
 * Setzt das Profil auf eine Wochensicherung zurück und überschreibt den Stand in Dropbox.
 * Was andere Geräte seitdem gelernt haben, kommt beim nächsten Abgleich dieser Geräte wieder dazu.
 */
export async function restoreBackup(profileId: string, entry: BackupEntry) {
  const d = await download(profileId, entry.path)
  if (!d) throw new DropboxError('Die Sicherung wurde nicht gefunden.')
  const doc = await decode(d.data)
  if (doc.profile.id !== profileId) throw new DropboxError('Die Sicherung gehört zu einem anderen Profil.')
  await replaceProfile(doc, false)
  const local = await exportDoc(profileId)
  const rev = await upload(profileId, syncPath(profileId), await encode({ ...local, savedAt: Date.now() }))
  await setSyncStatus(profileId, { ...(await getSyncStatus(profileId)), rev, localSig: docSignature(local), lastSync: Date.now(), error: undefined })
}

export interface RemoteProfile {
  doc: SyncDoc
  path: string
}

/** Profile, die in der verbundenen Dropbox liegen (für die Einrichtung eines neuen Geräts). */
export async function listRemoteProfiles(tokenOwner: string): Promise<RemoteProfile[]> {
  const files = (await listFolder(tokenOwner, '/sync')).filter((f) => f.name.endsWith('.lernsync'))
  const out: RemoteProfile[] = []
  let failed: unknown
  for (const f of files) {
    try {
      const d = await download(tokenOwner, f.path)
      if (d) out.push({ doc: await decode(d.data), path: f.path })
    } catch (e) {
      // Eine beschädigte oder neuere Datei soll die übrigen Profile nicht verdecken.
      if (e instanceof DropboxError) throw e
      failed = e
    }
  }
  if (!out.length && failed) throw failed
  return out
}

/** Holt ein Profil aus Dropbox auf dieses Gerät und verbindet es dauerhaft. */
export async function importRemoteProfile(r: RemoteProfile) {
  const exists = await db.profiles.get(r.doc.profile.id)
  await adoptPendingTokens(r.doc.profile.id)
  if (!exists) await replaceProfile(r.doc, true)
  await syncProfile(r.doc.profile.id)
}
