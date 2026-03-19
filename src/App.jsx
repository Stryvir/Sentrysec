import { useState } from 'react'
import SplashScreen from './components/SplashScreen'
import AuthPage from './components/AuthPage'
import './App.css'

export default function App() {
  const [splashDone, setSplashDone] = useState(false)

  return (
    <>
      {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} />}
      {splashDone && <AuthPage />}
    </>
  )
}
