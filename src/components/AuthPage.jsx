import { useState, useRef } from 'react'
import logo from '../../SentrySec_Logo.png'
import { registerUser, loginUser } from '../db/auth'
import IdScanStep from './IdScanStep'
import './AuthPage.css'

const INITIAL_LOGIN = { username: '', password: '' }
const INITIAL_SIGNUP = {
  fullName: '',
  address: '',
  contactNumber: '',
  email: '',
  username: '',
  password: '',
  confirmPassword: '',
  agreed: false,
}

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(INITIAL_LOGIN)
  const [signupStep, setSignupStep] = useState('form')
  const [showTerms, setShowTerms] = useState(false)
  const [hasReadTerms, setHasReadTerms] = useState(false)
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const modalBodyRef = useRef(null)

  const isLogin = mode === 'login'

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    // Block direct checkbox tick — must read terms first
    if (name === 'agreed' && type === 'checkbox') {
      if (!hasReadTerms) {
        showToast('Please read the Terms & Privacy Policy first.')
        return
      }
    }
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  function showToast(msg) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  function handleModalScroll(e) {
    const el = e.target
    const reachedBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10
    if (reachedBottom) setScrolledToBottom(true)
  }

  function openTerms() {
    setScrolledToBottom(false)
    setShowTerms(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (isLogin) {
      const result = await loginUser({ username: form.username, password: form.password })
      if (!result.success) {
        showToast(result.error)
        return
      }
      showToast(`Welcome back, ${result.user.full_name}!`)
      // TODO: navigate to dashboard
    } else {
      if (form.password !== form.confirmPassword) {
        showToast('Passwords do not match.')
        return
      }
      if (!form.agreed) {
        showToast('Please agree to the Terms & Privacy Policy.')
        return
      }
      // Step 1 done — go to ID scan
      setSignupStep('id-scan')
    }
  }

  async function handleIdSubmit(imageData) {
    const result = await registerUser({ ...form, barangayIdImage: imageData })
    if (!result.success) {
      showToast(result.error)
      setSignupStep('form')
      return
    }
    showToast('Account created! You can now log in.')
    switchMode('login')
  }

  function switchMode(next) {
    setMode(next)
    setForm(next === 'login' ? INITIAL_LOGIN : INITIAL_SIGNUP)
    setSignupStep('form')
  }

  // ID scan step — full-screen replacement
  if (!isLogin && signupStep === 'id-scan') {
    return (
      <>
        <IdScanStep
          onBack={() => setSignupStep('form')}
          onSubmit={handleIdSubmit}
        />
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </>
    )
  }

  return (<>
    <div className="auth">
      {/* Top branding panel */}
      <div className="auth__top">
        <img src={logo} alt="SentrySec Logo" className="auth__logo" />
        <h1 className="auth__title">SentrySec</h1>
        <p className="auth__tagline">Your security, always in sight.</p>
      </div>

      {/* Bottom form card */}
      <div className="auth__card">
        <h2 className="auth__card-title">{isLogin ? 'Welcome back' : 'Create account'}</h2>
        <p className="auth__card-sub">{isLogin ? 'Sign in to continue' : 'Fill in your details to get started'}</p>

        <form className="auth__form" onSubmit={handleSubmit} noValidate>

          {/* ── LOGIN FIELDS ── */}
          {isLogin && (
            <>
              <label className="auth__label" htmlFor="username">Username</label>
              <input id="username" name="username" type="text" className="auth__input"
                placeholder="Enter your username"
                value={form.username} onChange={handleChange} autoComplete="username" required />

              <label className="auth__label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" className="auth__input"
                placeholder="Enter your password"
                value={form.password} onChange={handleChange} autoComplete="current-password" required />
            </>
          )}

          {/* ── SIGNUP FIELDS ── */}
          {!isLogin && (
            <>
              <label className="auth__label" htmlFor="fullName">Full Name</label>
              <input id="fullName" name="fullName" type="text" className="auth__input"
                placeholder="ex. Juan L. Dela Cruz"
                value={form.fullName} onChange={handleChange} autoComplete="name" required />

              <label className="auth__label" htmlFor="address">Address</label>
              <input id="address" name="address" type="text" className="auth__input"
                placeholder="ex. 938 Aurora Blvd, Quezon City"
                value={form.address} onChange={handleChange} autoComplete="street-address" required />

              <label className="auth__label" htmlFor="contactNumber">Contact Number</label>
              <input id="contactNumber" name="contactNumber" type="tel" className="auth__input"
                placeholder="ex. 09123456789"
                value={form.contactNumber} onChange={handleChange} autoComplete="tel" required />

              <label className="auth__label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" className="auth__input"
                placeholder="ex. juan23@gmail.com"
                value={form.email} onChange={handleChange} autoComplete="email" required />

              <label className="auth__label" htmlFor="signupUsername">Username</label>
              <input id="signupUsername" name="username" type="text" className="auth__input"
                placeholder="ex. jldc01"
                value={form.username} onChange={handleChange} autoComplete="username" required />

              <label className="auth__label" htmlFor="signupPassword">Password</label>
              <input id="signupPassword" name="password" type="password" className="auth__input"
                placeholder="Create a strong password"
                value={form.password} onChange={handleChange} autoComplete="new-password" required />

              <label className="auth__label" htmlFor="confirmPassword">Confirm Password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" className="auth__input"
                placeholder="Repeat your password"
                value={form.confirmPassword} onChange={handleChange} autoComplete="new-password" required />

              <label className="auth__checkbox-label">
                <input name="agreed" type="checkbox" className="auth__checkbox"
                  checked={form.agreed} onChange={handleChange} required />
                <span>I agree to the <button type="button" className="auth__link" onClick={openTerms}>Terms &amp; Privacy Policy</button></span>
              </label>
            </>
          )}

          <button type="submit" className="auth__btn">
            {isLogin ? 'LOGIN' : 'NEXT →'}
          </button>
        </form>

        <p className="auth__toggle">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" className="auth__toggle-btn" onClick={() => switchMode(isLogin ? 'signup' : 'login')}>
            {isLogin ? 'Sign Up' : 'Log In'}
          </button>
        </p>
      </div>
    </div>

    {/* Toast notification */}
    {toastMsg && (
      <div className="toast">{toastMsg}</div>
    )}

    {/* Terms & Privacy Policy Modal */}
    {showTerms && (
      <div className="modal-overlay" onClick={() => setShowTerms(false)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div className="modal__header">
            <h2 className="modal__title">Terms &amp; Privacy Policy</h2>
            <button className="modal__close" onClick={() => setShowTerms(false)}>✕</button>
          </div>
          <div className="modal__body" onScroll={handleModalScroll} ref={modalBodyRef}>
            <h3>1. Acceptance of Terms</h3>
            <p>By creating an account and using SentrySec, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use our services.</p>

            <h3>2. Use of Service</h3>
            <p>SentrySec is a personal security monitoring application. You agree to use this platform only for lawful purposes and in a manner that does not infringe the rights of others or restrict their use of the service.</p>

            <h3>3. Account Responsibility</h3>
            <p>You are responsible for maintaining the confidentiality of your account credentials. Any activity under your account is your responsibility. Notify us immediately of any unauthorized use.</p>

            <h3>4. Data Collection &amp; Privacy</h3>
            <p>We collect the following personal information during registration: full name, address, contact number, email, and username. This data is stored locally on your device using IndexedDB and is never shared with third parties without your consent.</p>

            <h3>5. Data Security</h3>
            <p>We take reasonable measures to protect your personal information. However, no method of electronic storage is 100% secure. By using SentrySec, you acknowledge and accept this risk.</p>

            <h3>6. Location Data</h3>
            <p>SentrySec may request access to your device's location for security monitoring features. Location data is used solely for the purpose of the application's core functionality and is not transmitted externally.</p>

            <h3>7. Modifications</h3>
            <p>SentrySec reserves the right to modify these Terms and Privacy Policy at any time. Continued use of the application after changes constitutes your acceptance of the new terms.</p>

            <h3>8. Contact</h3>
            <p>For any concerns regarding these terms or your data, please contact the SentrySec support team through the in-app Help section.</p>
          </div>
          <div className="modal__footer">
            {!scrolledToBottom && (
              <p className="modal__scroll-hint">↓ Scroll down to read all terms</p>
            )}
            <div className="modal__footer-btns">
              <button
                className={`modal__btn${!scrolledToBottom ? ' modal__btn--disabled' : ''}`}
                disabled={!scrolledToBottom}
                onClick={() => {
                  setHasReadTerms(true)
                  setForm(prev => ({ ...prev, agreed: true }))
                  setShowTerms(false)
                }}
              >I Agree</button>
              <button className="modal__btn modal__btn--outline" onClick={() => setShowTerms(false)}>Close</button>
            </div>
          </div>
        </div>
      </div>
    )}
  </>)
}
