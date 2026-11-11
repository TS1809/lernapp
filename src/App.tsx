import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppStateProvider, useAppState } from './state'
import { Onboarding } from './pages/Onboarding'
import { Dashboard } from './pages/Dashboard'
import { Ideas } from './pages/Ideas'
import { ReminderForm, RemindersList } from './pages/Reminders'
import { Session } from './pages/Session'
import { LearnChoice } from './pages/LearnChoice'
import { Exams } from './pages/Exams'
import { ExamDetail } from './pages/ExamDetail'
import { ExamCards } from './pages/ExamCards'
import { HomeworkForm, HomeworkList, HomeworkPage } from './pages/Homework'
import { ExamForm } from './pages/ExamForm'
import { ExamProfilePage } from './pages/ExamProfile'
import { Import } from './pages/Import'
import { Settings } from './pages/Settings'
import { Help } from './pages/Help'
import { DropboxImport } from './pages/DropboxImport'
import { SemesterForm } from './pages/SemesterForm'
import { MockExam } from './pages/MockExam'
import { FsrsSettings } from './pages/FsrsSettings'
import { Documents } from './pages/Documents'
import { Noten } from './pages/Stundenplan'
import { CourseChat } from './pages/CourseChat'
import { CourseEvents } from './pages/CourseEvents'
import { Mensa } from './pages/Mensa'
import { SyncProvider } from './sync-state'
import { ErrorBoundary, UpdateBanner } from './components/AppChrome'

/** Jede Sitzung neu aufbauen, auch beim direkten Wechsel zwischen zwei Sitzungen. */
function SessionRoute() {
  const location = useLocation()
  return <Session key={location.key} />
}

function Shell() {
  const { loading, profile, semester } = useAppState()
  const { pathname } = useLocation()
  if (loading) return null
  if (pathname === '/dropbox-import') {
    return (
      <main className="main">
        <DropboxImport />
      </main>
    )
  }
  if (!profile || !semester) {
    return (
      <main className="main">
        <Onboarding />
      </main>
    )
  }
  // Übersicht und Prüfungsseite (zweispaltig) nutzen auf dem iPad die volle Breite, andere Unterseiten bleiben schmal und gut lesbar.
  return (
    <main className={pathname === '/' || /^\/pruefung\/(?!neu$)[^/]+$/.test(pathname) ? 'main wide' : 'main'}>
      <UpdateBanner />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/lernen/:mode" element={<SessionRoute />} />
        <Route path="/lernen/:mode/auswahl" element={<LearnChoice />} />
        <Route path="/pruefungen" element={<Exams />} />
        <Route path="/pruefung/neu" element={<ExamForm />} />
        <Route path="/pruefung/:id" element={<ExamDetail />} />
        <Route path="/pruefung/:id/bearbeiten" element={<ExamForm />} />
        <Route path="/pruefung/:id/profil" element={<ExamProfilePage />} />
        <Route path="/pruefung/:id/karten" element={<ExamCards />} />
        <Route path="/hausaufgaben" element={<HomeworkList />} />
        <Route path="/hausaufgabe/neu" element={<HomeworkForm />} />
        <Route path="/hausaufgabe/:id" element={<HomeworkPage />} />
        <Route path="/hausaufgabe/:id/bearbeiten" element={<HomeworkForm />} />
        <Route path="/import" element={<Import />} />
        <Route path="/einstellungen" element={<Settings />} />
        <Route path="/hilfe" element={<Help />} />
        <Route path="/ideen" element={<Ideas />} />
        <Route path="/erinnerungen" element={<RemindersList />} />
        <Route path="/erinnerung/neu" element={<ReminderForm />} />
        <Route path="/erinnerung/:id" element={<ReminderForm />} />
        <Route path="/semester/neu" element={<SemesterForm />} />
        <Route path="/probeklausur/:id" element={<MockExam />} />
        <Route path="/lernalgorithmus" element={<FsrsSettings />} />
        <Route path="/unterlagen" element={<Documents />} />
        <Route path="/noten" element={<Noten />} />
        <Route path="/kurschat" element={<CourseChat />} />
        <Route path="/termine" element={<CourseEvents />} />
        <Route path="/mensa" element={<Mensa />} />
        <Route path="/semester/:id" element={<SemesterForm />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </main>
  )
}

export function App() {
  return (
    <HashRouter>
      <AppStateProvider>
        <SyncProvider>
          <div className="app">
            <ErrorBoundary>
              <Shell />
            </ErrorBoundary>
          </div>
        </SyncProvider>
      </AppStateProvider>
    </HashRouter>
  )
}
