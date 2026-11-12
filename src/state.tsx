import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Profile, type Semester } from './lib/db'

export const PROFILE_KEY = 'lernapp.profileId'
const KEY = PROFILE_KEY

export function readStored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function writeStored(id: string) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Ohne localStorage startet die App einfach mit dem ersten Profil.
  }
}

interface AppState {
  loading: boolean
  profiles: Profile[]
  profile?: Profile
  semesters: Semester[]
  semester?: Semester
  selectProfile(id: string): void
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const profiles = useLiveQuery(() => db.profiles.orderBy('id').toArray(), [])
  const [selected, setSelected] = useState<string | null>(readStored)
  const profile = profiles?.find((p) => p.id === selected) ?? profiles?.[0]
  const semesters = useLiveQuery(
    () => (profile ? db.semesters.where('profileId').equals(profile.id).sortBy('createdAt') : []),
    [profile?.id],
  )
  const semester = semesters?.find((s) => s.id === profile?.activeSemesterId)

  useEffect(() => {
    if (profile && profile.id !== selected) setSelected(profile.id)
  }, [profile, selected])

  const value: AppState = {
    loading: profiles === undefined || semesters === undefined,
    profiles: profiles ?? [],
    profile,
    semesters: semesters ?? [],
    semester,
    selectProfile(id) {
      writeStored(id)
      setSelected(id)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppState(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppStateProvider fehlt')
  return v
}

/** Wie useAppState, aber für Seiten, die nur mit Profil und Semester angezeigt werden. */
export function useActive() {
  const s = useAppState()
  return s as AppState & { profile: Profile; semester: Semester }
}
