// Allgemeine Datei-Hilfen (Import/Export), unabhängig von einzelnen Funktionen der App.

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.')
  }
}

/** Bietet eine Datei zum Speichern an – auf dem iPhone über das Teilen-Menü („In Dateien sichern“). Liefert false bei Abbruch. */
export async function saveFile(name: string, content: string, type = 'application/json'): Promise<boolean> {
  const file = new File([content], name, { type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: name })
      return true
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

export const safeFileName = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60)
