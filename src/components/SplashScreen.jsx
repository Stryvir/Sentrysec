import { useEffect, useState } from 'react'
import logo from '../../SentrySec_Logo.png'
import './SplashScreen.css'

export default function SplashScreen({ onFinish }) {
  const [phase, setPhase] = useState('enter') // 'enter' | 'exit'

  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase('exit'), 2600)
    const exitTimer = setTimeout(() => onFinish?.(), 3300)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(exitTimer)
    }
  }, [onFinish])

  return (
    <div className={`splash splash--${phase}`}>
      <div className="splash__content">
        <div className="splash__logo-wrap">
          <img src={logo} alt="SentrySec Logo" className="splash__logo" />
          <div className="splash__ripple" />
          <div className="splash__ripple splash__ripple--delay" />
        </div>
      </div>
    </div>
  )
}
