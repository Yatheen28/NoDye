import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { NoDyeLogo } from './NoDyeLogo'

interface LayoutProps {
  session: Session
  onSignOut: () => Promise<void>
}

export function Layout({ session, onSignOut }: LayoutProps) {
  const navigate = useNavigate()

  async function handleSignOut() {
    await onSignOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="row" style={{ gap: '2rem' }}>
            <NavLink to="/patients" style={{ textDecoration: 'none' }}>
              <NoDyeLogo size={26} color="#F5F2EB" />
            </NavLink>
            <nav className="app-nav" aria-label="Primary">
              <NavLink
                to="/patients"
                className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
              >
                Patients
              </NavLink>
              <NavLink
                to="/upload"
                className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
              >
                Upload and process
              </NavLink>
            </nav>
          </div>

          <div className="app-header__right">
            <span className="app-header__user" title={session.user.email ?? ''}>
              {session.user.email}
            </span>
            <button type="button" className="btn btn--header" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
