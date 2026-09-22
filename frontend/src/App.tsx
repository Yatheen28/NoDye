import { Navigate, Route, Routes } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { PatientPage } from './pages/PatientPage'
import { UploadPage } from './pages/UploadPage'
import { ResultsPage } from './pages/ResultsPage'

function App() {
  const { session, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--paper)',
        }}
      >
        <div
          className="skeleton"
          style={{ width: 120, height: 8, borderRadius: 4 }}
        />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={session ? <Navigate to="/patients" replace /> : <LoginPage />}
        />

        {/* Protected — wrapped in the app shell */}
        <Route
          element={
            session ? (
              <Layout session={session} onSignOut={signOut} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route path="/patients" element={<PatientPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/results/:scanId" element={<ResultsPage />} />
        </Route>

        {/* Default redirect */}
        <Route
          path="*"
          element={<Navigate to={session ? '/patients' : '/login'} replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
