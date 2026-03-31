import { useState, useEffect } from 'react'
import SplashScreen from './components/SplashScreen'
import AuthPage from './components/AuthPage'
import UserDashboard from './components/user/UserDashboard'
import AdminDashboard from './components/admin/AdminDashboard'
import TanodDashboard from './components/tanod/TanodDashboard'
import { requestNotifPermission } from './db/localNotif'
import './App.css'

const SESSION_KEY = 'sentrysec_session'

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSession(user) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch {}
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false)
  const [loggedInUser, setLoggedInUser] = useState(() => loadSession())

  // Request OS notification permission once splash is gone
  useEffect(() => {
    if (splashDone) requestNotifPermission()
  }, [splashDone])

  function handleLogin(user) {
    saveSession(user)
    setLoggedInUser(user)
  }

  function handleUserUpdate(updatedUser) {
    saveSession(updatedUser)
    setLoggedInUser(updatedUser)
  }

  function handleLogout() {
    clearSession()
    setLoggedInUser(null)
  }

  // Show splash first
  if (!splashDone) {
    return <SplashScreen onFinish={() => setSplashDone(true)} />
  }

  // Not logged in — show auth
  if (!loggedInUser) {
    return <AuthPage onLogin={handleLogin} />
  }

  // Role-based routing
  const role = loggedInUser.role ?? 'user'

  if (role === 'tanod') {
    return <TanodDashboard user={loggedInUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
  }

  if (role === 'admin') {
    return <AdminDashboard user={loggedInUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
  }

  // Default: user
  return <UserDashboard user={loggedInUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
}
