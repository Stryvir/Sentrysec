import { useState } from 'react'
import SplashScreen from './components/SplashScreen'
import AuthPage from './components/AuthPage'
import UserDashboard from './components/user/UserDashboard'
import AdminDashboard from './components/admin/AdminDashboard'
import './App.css'

export default function App() {
  const [splashDone, setSplashDone] = useState(false)
  const [loggedInUser, setLoggedInUser] = useState(null)

  function handleLogin(user) {
    setLoggedInUser(user)
  }

  function handleUserUpdate(updatedUser) {
    setLoggedInUser(updatedUser)
  }

  function handleLogout() {
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
    // Tanod dashboard — coming soon
    return <div style={{padding:32}}>Tanod Dashboard (coming soon)</div>
  }

  if (role === 'admin') {
    return <AdminDashboard user={loggedInUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
  }

  // Default: user
  return <UserDashboard user={loggedInUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
}
