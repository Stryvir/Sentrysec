import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import { Geolocation } from '@capacitor/geolocation'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { saveUserLocation, sendSOSAlert, getNotifications, getTanodSchedules, getEmergencyContacts, getEvacuationAreas, getDisasterPlans, updateUserProfile, getMemorandums, submitFeedback, getUserFeedback } from '../../db/auth'
import './UserDashboard.css'

// Fix default leaflet marker icons (broken in Vite builds)
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const ALERT_MARKER_ICONS = {
  accident: '🚗',
  criminal: '🔪',
  flood:    '🌊',
  fire:     '🔥',
  hazard:   '🚧',
  medical:  '🏥',
}

function getAlertIcon(description) {
  const emoji = ALERT_MARKER_ICONS[description] ?? '⚠️'
  return L.divIcon({
    className: '',
    html: `<div class="map-alert-pin">${emoji}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
  })
}

const evacuationAreaIcon = L.divIcon({
  className: '',
  html: '<div class="map-evac-pin">🏠</div>',
  iconSize: [38, 38],
  iconAnchor: [19, 38],
})

const alertMapIcon = L.divIcon({
  className: '',
  html: '<div class="map-alert-pin">⚠️</div>',
  iconSize: [38, 38],
  iconAnchor: [19, 38],
})

function RecenterMap({ position }) {
  const map = useMap()
  useEffect(() => {
    if (position) map.setView(position, 17)
  }, [position, map])
  return null
}

async function fetchAddress(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
    )
    const data = await res.json()
    return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

export default function UserDashboard({ user, onLogout, onUserUpdate }) {
  const [page, setPage] = useState('home') // 'home' | 'info' | 'profile'
  const [position, setPosition] = useState(null)
  const [address, setAddress] = useState('')
  const [locating, setLocating] = useState(true)
  const [locationConfirmed, setLocationConfirmed] = useState(null) // null | true | false
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [pinMode, setPinMode] = useState(false) // true when user is dragging pin to correct location
  const markerRef = useRef(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sosState, setSosState] = useState('idle') // 'idle'|'confirming'|'sending'|'sent'|'error'
  const [sosError, setSosError] = useState('')
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [seenIds, setSeenIds] = useState(() => new Set(JSON.parse(localStorage.getItem('ss_seen_notifs') || '[]')))
  const [focusedAlert, setFocusedAlert] = useState(null)
  const [evacuationAreas, setEvacuationAreas] = useState([])

  async function handleSendSOS() {
    setSosState('sending')
    setSosError('')
    const result = await sendSOSAlert({
      userId: user.id,
      fullName: user.full_name,
      latitude: position ? position[0] : null,
      longitude: position ? position[1] : null,
      address: address || 'Unknown location',
    })
    if (result.success) {
      setSosState('sent')
    } else {
      setSosError(result.error || 'Failed to send SOS.')
      setSosState('error')
    }
  }

  function drawerNav(dest) {
    setPage(dest)
    setDrawerOpen(false)
  }

  async function confirmLocation() {
    setSaving(true)
    setSaveError('')
    const result = await saveUserLocation({
      userId: user.id,
      latitude: position[0],
      longitude: position[1],
      address,
    })
    setSaving(false)
    if (!result.success) {
      setSaveError(result.error)
    } else {
      setLocationConfirmed(true)
      setPinMode(false)
    }
  }

  async function handlePinDragEnd() {
    if (!markerRef.current) return
    const { lat, lng } = markerRef.current.getLatLng()
    setPosition([lat, lng])
    setAddress('Getting address...')
    const addr = await fetchAddress(lat, lng)
    setAddress(addr)
  }

  async function fetchCurrentLocation() {
    setLocating(true)
    setLocationConfirmed(null)
    setPinMode(false)
    setSaveError('')
    setAddress('Getting your location...')
    try {
      // Try Capacitor plugin first
      const perm = await Geolocation.requestPermissions()
      if (perm.location === 'granted' || perm.location === 'limited') {
        const coords = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
        const lat = coords.coords.latitude
        const lng = coords.coords.longitude
        setPosition([lat, lng])
        setAddress(await fetchAddress(lat, lng))
        setLocating(false)
        return
      }
    } catch {}

    // Fallback to browser geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude
          const lng = pos.coords.longitude
          setPosition([lat, lng])
          setAddress(await fetchAddress(lat, lng))
          setLocating(false)
        },
        () => {
          setAddress('Unable to get location. Please enable GPS.')
          setLocating(false)
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    } else {
      setAddress('GPS not supported on this device.')
      setLocating(false)
    }
  }

  useEffect(() => {
    fetchCurrentLocation()
  }, [])

  useEffect(() => {
    getNotifications().then(n => setNotifications(n))
  }, [])

  useEffect(() => {
    getEvacuationAreas().then(r => { if (r.success) setEvacuationAreas(r.data) })
  }, [])

  const defaultCenter = [14.7380, 121.0584]

  // ── INFO PAGE ──────────────────────────────────────────────
  function InfoPage() {
    return (
      <div className="dashboard__content">
        <p className="dashboard__section-title">INFORMATION</p>
        <button className="dashboard__info-card" onClick={() => setPage('schedules')}>
          <svg className="dashboard__info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>SCHEDULES</span>
        </button>
        <button className="dashboard__info-card" onClick={() => setPage('safetyguide')}>
          <svg className="dashboard__info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>SAFETY GUIDE</span>
        </button>
      </div>
    )
  }

  // ── SCHEDULES PAGE ─────────────────────────────────────────
  function SchedulesPage() {
    const [schedules, setSchedules] = useState([])
    const [loading, setLoading] = useState(true)
    const [fetchError, setFetchError] = useState('')
    const [expandedName, setExpandedName] = useState(null)

    useEffect(() => {
      getTanodSchedules().then(res => {
        if (!res.success) setFetchError(res.error)
        else setSchedules(res.data)
        setLoading(false)
      })
    }, [])

    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    const todayISO  = new Date().toISOString().slice(0, 10)

    function formatShift(ts) {
      const fmt = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}` }
      const mNew = ts?.match(/^([A-Za-z]+) (\d{2}:\d{2})\u2013(\d{2}:\d{2})$/)
      if (mNew) return `${mNew[1]} · ${fmt(mNew[2])} – ${fmt(mNew[3])}`
      const mOld = ts?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\u2013(\d{2}:\d{2})$/)
      if (mOld) return `${new Date(mOld[1]+'T00:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'})} · ${fmt(mOld[2])} – ${fmt(mOld[3])}`
      return ts ?? ''
    }

    const grouped = schedules.reduce((acc, s) => {
      if (!acc[s.name]) acc[s.name] = { entries: [], contact: s.contact_number }
      acc[s.name].entries.push(s)
      return acc
    }, {})

    const isOnToday = name => grouped[name].entries.some(
      s => s.time_shift?.startsWith(todayName) || s.time_shift?.startsWith(todayISO)
    )
    const onDutyNames  = Object.keys(grouped).filter(n => isOnToday(n))
    const offDutyNames = Object.keys(grouped).filter(n => !isOnToday(n))

    function TanodGroup({ name, data }) {
      const isExpanded = expandedName === name
      const onToday = data.entries.some(s => s.time_shift?.startsWith(todayName) || s.time_shift?.startsWith(todayISO))
      return (
        <div className="sched-group">
          <button
            className="sched-card sched-card--clickable"
            onClick={() => setExpandedName(isExpanded ? null : name)}
          >
            <div className="sched-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div className="sched-info" style={{ flex: 1 }}>
              <p className="sched-name">{name}</p>
              {data.contact && <p className="sched-detail">{data.contact}</p>}
              <p className="sched-detail">{data.entries.length} day{data.entries.length !== 1 ? 's' : ''} scheduled</p>
              {onToday && <span className="sched-badge sched-badge--green">On Duty Today</span>}
            </div>
            <svg
              className="sched-chevron"
              style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {isExpanded && (
            <div className="sched-group__rows">
              {data.entries.map(s => {
                const isToday = s.time_shift?.startsWith(todayName) || s.time_shift?.startsWith(todayISO)
                return (
                  <div key={s.id} className={`sched-shift-row${isToday ? ' sched-shift-row--today' : ''}`}>
                    <p className="sched-shift-text">{formatShift(s.time_shift)}</p>
                    {isToday && <span className="sched-badge sched-badge--green">Today</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="dashboard__content">
        <button className="dashboard__back-btn" onClick={() => setPage('info')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          BACK
        </button>

        <p className="sched-page-title">TANOD{`\n`}SCHEDULES</p>

        {loading && <div className="dashboard__placeholder-card">Loading schedules...</div>}
        {fetchError && <div className="dashboard__placeholder-card" style={{color:'#c0392b'}}>{fetchError}</div>}
        {!loading && !fetchError && Object.keys(grouped).length === 0 && (
          <div className="dashboard__placeholder-card">No schedules posted yet.</div>
        )}
        {!loading && !fetchError && onDutyNames.length > 0 && (
          <>
            <div className="sched-section-label">ON DUTY TODAY</div>
            {onDutyNames.map(name => <TanodGroup key={name} name={name} data={grouped[name]} />)}
          </>
        )}
        {!loading && !fetchError && offDutyNames.length > 0 && (
          <>
            <div className="sched-section-label sched-section-label--prev">OFF DUTY</div>
            {offDutyNames.map(name => <TanodGroup key={name} name={name} data={grouped[name]} />)}
          </>
        )}
      </div>
    )
  }

  // ── SAFETY GUIDE PAGE ──────────────────────────────────────
  function SafetyGuidePage() {
    const [contacts, setContacts] = useState([])
    const [areas, setAreas] = useState([])
    const [plans, setPlans] = useState([])
    const [loading, setLoading] = useState(true)
    const [errors, setErrors] = useState({})
    const [expanded, setExpanded] = useState(null) // 'contacts' | 'areas' | 'plans'

    useEffect(() => {
      Promise.all([
        getEmergencyContacts(),
        getEvacuationAreas(),
        getDisasterPlans(),
      ]).then(([c, a, p]) => {
        if (!c.success) setErrors(e => ({ ...e, contacts: c.error }))
        else setContacts(c.data)
        if (!a.success) setErrors(e => ({ ...e, areas: a.error }))
        else setAreas(a.data)
        if (!p.success) setErrors(e => ({ ...e, plans: p.error }))
        else setPlans(p.data)
        setLoading(false)
      })
    }, [])

    function toggle(key) {
      setExpanded(prev => prev === key ? null : key)
    }

    function SectionBox({ sectionKey, label, children }) {
      const open = expanded === sectionKey
      return (
        <div className={`sg-box${open ? ' sg-box--open' : ''}`}>
          <button className="sg-box__header" onClick={() => toggle(sectionKey)}>
            <span>{label}</span>
            <svg className={`sg-box__chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {open && <div className="sg-box__body">{children}</div>}
        </div>
      )
    }

    return (
      <div className="dashboard__content">
        <button className="dashboard__back-btn" onClick={() => setPage('info')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          BACK
        </button>

        <p className="sg-page-title">SAFETY GUIDE &amp;{`\n`}EMERGENCY PLAN</p>
        <p className="sg-subtitle">
          This module contains the areas where the residents can take refuge when a calamity happens. This will also show a list of things and actions the residents themselves can prepare for disasters.
        </p>

        {loading && <div className="dashboard__placeholder-card">Loading...</div>}

        {!loading && (
          <>
            {/* EMERGENCY CONTACTS */}
            <SectionBox sectionKey="contacts" label="EMERGENCY CONTACTS">
              {errors.contacts
                ? <p className="sg-error">{errors.contacts}</p>
                : contacts.length === 0
                  ? <p className="sg-empty">No emergency contacts posted yet.</p>
                  : contacts.map(c => (
                      <div key={c.id} className="sg-row">
                        <p className="sg-row__name">{c.name}</p>
                        {c.role && <p className="sg-row__sub">{c.role}</p>}
                        <p className="sg-row__sub">{c.contact_number}</p>
                      </div>
                    ))
              }
            </SectionBox>

            {/* EVACUATION AREAS */}
            <SectionBox sectionKey="areas" label="EVACUATION AREAS">
              {errors.areas
                ? <p className="sg-error">{errors.areas}</p>
                : areas.length === 0
                  ? <p className="sg-empty">No evacuation areas posted yet.</p>
                  : areas.map(a => (
                      <div key={a.id} className="sg-row">
                        <p className="sg-row__name">{a.name}</p>
                        {a.address && <p className="sg-row__sub">{a.address}</p>}
                        {a.description && <p className="sg-row__desc">{a.description}</p>}
                      </div>
                    ))
              }
            </SectionBox>

            {/* DISASTER PREPAREDNESS PLAN */}
            <SectionBox sectionKey="plans" label="DISASTER PREPAREDNESS PLAN">
              {errors.plans
                ? <p className="sg-error">{errors.plans}</p>
                : plans.length === 0
                  ? <p className="sg-empty">No disaster plans posted yet.</p>
                  : plans.map(p => (
                      <div key={p.id} className="sg-row">
                        <p className="sg-row__name">{p.title}</p>
                        {p.content && <p className="sg-row__desc">{p.content}</p>}
                      </div>
                    ))
              }
            </SectionBox>
          </>
        )}
      </div>
    )
  }

  // ── PROFILE PAGE ───────────────────────────────────────────
  function ProfilePage() {
    const [formAddress, setFormAddress] = useState(user?.address ?? '')
    const [formContact, setFormContact] = useState(user?.contact_number ?? '')
    const [formEmail, setFormEmail] = useState(user?.email ?? '')
    const [updating, setUpdating] = useState(false)
    const [updateError, setUpdateError] = useState('')
    const [updateSuccess, setUpdateSuccess] = useState(false)

    async function handleUpdate() {
      setUpdating(true)
      setUpdateError('')
      setUpdateSuccess(false)
      const result = await updateUserProfile({
        userId: user.id,
        address: formAddress,
        contactNumber: formContact,
        email: formEmail,
      })
      setUpdating(false)
      if (!result.success) {
        setUpdateError(result.error)
      } else {
        setUpdateSuccess(true)
        if (onUserUpdate) onUserUpdate(result.user)
      }
    }

    return (
      <div className="dashboard__content">
        {/* Avatar + name */}
        <div className="profile__header">
          <div className="dashboard__profile-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <p className="dashboard__profile-name">{user?.full_name ?? user?.email ?? 'User'}</p>
        </div>

        {/* Editable fields */}
        <div className="profile__fields">
          <div className="profile__field">
            <label className="profile__label">Address</label>
            <input
              className="profile__input"
              type="text"
              value={formAddress}
              onChange={e => { setFormAddress(e.target.value); setUpdateSuccess(false) }}
              placeholder="Enter your address"
            />
          </div>
          <div className="profile__field">
            <label className="profile__label">Contact Number</label>
            <input
              className="profile__input"
              type="tel"
              value={formContact}
              onChange={e => { setFormContact(e.target.value); setUpdateSuccess(false) }}
              placeholder="Enter contact number"
            />
          </div>
          <div className="profile__field">
            <label className="profile__label">Email</label>
            <input
              className="profile__input"
              type="email"
              value={formEmail}
              onChange={e => { setFormEmail(e.target.value); setUpdateSuccess(false) }}
              placeholder="Enter email"
            />
          </div>
        </div>

        {updateError && <p className="profile__feedback profile__feedback--error">{updateError}</p>}
        {updateSuccess && <p className="profile__feedback profile__feedback--success">Profile updated!</p>}

        <button
          className="profile__update-btn"
          onClick={handleUpdate}
          disabled={updating}
        >
          {updating ? 'Saving...' : 'Update Profile'}
        </button>

        <button className="dashboard__logout-btn" onClick={onLogout}>LOG OUT</button>
      </div>
    )
  }
  // ── EMERGENCY CONTACTS PAGE ──────────────────────────────
  function EmergencyContactsPage() {
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [err, setErr] = useState('')
    useEffect(() => {
      getEmergencyContacts().then(r => {
        if (!r.success) setErr(r.error); else setItems(r.data)
        setLoading(false)
      })
    }, [])
    return (
      <div className="dashboard__content">
        <button className="dashboard__back-btn" onClick={() => drawerNav('home')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>BACK
        </button>
        <p className="sched-page-title">EMERGENCY{`\n`}CONTACTS</p>
        {loading && <div className="dashboard__placeholder-card">Loading...</div>}
        {err && <div className="dashboard__placeholder-card" style={{color:'#c0392b'}}>{err}</div>}
        {!loading && !err && items.length === 0 && <div className="dashboard__placeholder-card">No emergency contacts posted yet.</div>}
        {items.map(c => (
          <div key={c.id} className="sched-card">
            <div className="sched-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-5-5 19.79 19.79 0 01-3.07-8.63A2 2 0 014 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14v2.92z"/></svg>
            </div>
            <div className="sched-info">
              <p className="sched-name">{c.name}</p>
              {c.role && <p className="sched-detail">{c.role}</p>}
              <p className="sched-detail">{c.contact_number}</p>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── EVACUATION AREAS PAGE ────────────────────────────────
  function EvacuationAreasPage() {
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [err, setErr] = useState('')
    const [geoAddresses, setGeoAddresses] = useState({})
    useEffect(() => {
      getEvacuationAreas().then(r => {
        if (!r.success) setErr(r.error); else setItems(r.data)
        setLoading(false)
      })
    }, [])
    useEffect(() => {
      const missing = items.filter(a => !a.address && a.latitude && a.longitude)
      if (!missing.length) return
      missing.forEach(async a => {
        const addr = await fetchAddress(a.latitude, a.longitude)
        if (addr) setGeoAddresses(prev => ({ ...prev, [a.id]: addr }))
      })
    }, [items])
    return (
      <div className="dashboard__content">
        <button className="dashboard__back-btn" onClick={() => drawerNav('home')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>BACK
        </button>
        <p className="sched-page-title">EVACUATION{`\n`}AREAS</p>
        {loading && <div className="dashboard__placeholder-card">Loading...</div>}
        {err && <div className="dashboard__placeholder-card" style={{color:'#c0392b'}}>{err}</div>}
        {!loading && !err && items.length === 0 && <div className="dashboard__placeholder-card">No evacuation areas posted yet.</div>}
        {items.map(a => (
          <div key={a.id} className="sched-card">
            <div className="sched-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div className="sched-info">
              <p className="sched-name">{a.name}</p>
              <p className="sched-detail">📍 {a.address || geoAddresses[a.id] || (a.latitude ? 'Getting address…' : '')}</p>
              {a.description && <p className="sched-detail">{a.description}</p>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── BARANGAY MEMORANDUMS PAGE ─────────────────────────────
  function MemorandumsPage() {
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [err, setErr] = useState('')

    useEffect(() => {
      getMemorandums().then(r => {
        if (!r.success) setErr(r.error); else setItems(r.data)
        setLoading(false)
      })
    }, [])

    function formatDate(iso) {
      const d = new Date(iso)
      return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) +
        ' • ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    }

    return (
      <div className="dashboard__content">
        <button className="dashboard__back-btn" onClick={() => drawerNav('home')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>BACK
        </button>
        <p className="sched-page-title">BARANGAY{`\n`}MEMORANDUMS</p>
        {loading && <div className="dashboard__placeholder-card">Loading...</div>}
        {err && <div className="dashboard__placeholder-card" style={{color:'#c0392b'}}>{err}</div>}
        {!loading && !err && items.length === 0 &&
          <div className="dashboard__placeholder-card">No memorandums posted yet.</div>}
        {items.map(m => (
          <div key={m.id} className="memo-card">
            <p className="memo-title">{m.title}</p>
            <p className="memo-date">{formatDate(m.created_at)}</p>
            <p className="memo-content">{m.content}</p>
          </div>
        ))}
      </div>
    )
  }

  // ── FEEDBACK PAGE ──────────────────────────────────────
  function FeedbackPage() {
    const [message, setMessage] = useState('')
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState('')
    const [sent, setSent] = useState(false)
    const [pastFeedback, setPastFeedback] = useState([])
    const [loadingPast, setLoadingPast] = useState(true)

    useEffect(() => {
      getUserFeedback(user.id).then(r => {
        if (r.success) setPastFeedback(r.data)
        setLoadingPast(false)
      })
    }, [])

    async function handleSend() {
      if (!message.trim()) return
      setSending(true)
      setSendError('')
      setSent(false)
      const result = await submitFeedback({
        userId: user.id,
        fullName: user.full_name ?? user.email,
        message: message.trim(),
      })
      setSending(false)
      if (!result.success) {
        setSendError(result.error)
      } else {
        setMessage('')
        setSent(true)
        getUserFeedback(user.id).then(r => { if (r.success) setPastFeedback(r.data) })
      }
    }

    function formatDate(iso) {
      return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' · ' + new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    }

    return (
      <div className="dashboard__content">
        <button className="dashboard__back-btn" onClick={() => drawerNav('home')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>BACK
        </button>
        <p className="sched-page-title">FEEDBACK</p>
        <p className="sg-subtitle">Share your thoughts, concerns, or suggestions.</p>

        <div className="feedback__field">
          <label className="profile__label">Your Message</label>
          <textarea
            className="feedback__textarea"
            rows={5}
            placeholder="Write your feedback here..."
            value={message}
            onChange={e => { setMessage(e.target.value); setSent(false); setSendError('') }}
          />
        </div>

        {sendError && <p className="profile__feedback profile__feedback--error">{sendError}</p>}
        {sent && <p className="profile__feedback profile__feedback--success">Feedback sent! Thank you.</p>}

        <button
          className="profile__update-btn"
          onClick={handleSend}
          disabled={sending || !message.trim()}
        >
          {sending ? 'Sending...' : 'Send Feedback'}
        </button>

        <div className="sched-section-label" style={{ marginTop: 20 }}>YOUR PAST FEEDBACK</div>
        {loadingPast && <div className="dashboard__placeholder-card">Loading...</div>}
        {!loadingPast && pastFeedback.length === 0 && <div className="dashboard__placeholder-card">No feedback sent yet.</div>}
        {pastFeedback.map(f => (
          <div key={f.id} className="memo-card">
            <p className="memo-date">{formatDate(f.created_at)}</p>
            <p className="memo-content">{f.message}</p>
          </div>
        ))}
      </div>
    )
  }

  // ── ABOUT THE APP PAGE ────────────────────────────────────
  function AboutPage() {
    return (
      <div className="dashboard__content">
        <button className="dashboard__back-btn" onClick={() => drawerNav('home')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>BACK
        </button>
        <p className="sched-page-title">ABOUT THE APP</p>

        <div className="about-hero">
          <img src="/icons/icon-192.png" alt="SentrySec" className="about-logo" onError={e => e.target.style.display='none'} />
          <h2 className="about-appname">SentrySec</h2>
          <p className="about-tagline">Your Community Safety Companion</p>
        </div>

        <div className="about-section">
          <h3 className="about-section-title">What is SentrySec?</h3>
          <p className="about-body">
            <strong>SentrySec</strong> is a mobile safety and community monitoring application designed for barangay residents. It bridges the gap between citizens, tanod personnel, and barangay officials — making your community safer, more informed, and better prepared.
          </p>
        </div>

        <div className="about-section">
          <h3 className="about-section-title">Key Features</h3>
          <ul className="about-list">
            <li>📍 <strong>Location Sharing</strong> — Share your real-time location so tanod personnel can easily locate and assist you during emergencies.</li>
            <li>🗺️ <strong>Safety Area Maps</strong> — Quickly find the nearest evacuation areas, safe zones, and assembly points in your barangay.</li>
            <li>🛡️ <strong>Tanod Schedules</strong> — Stay updated on who is on duty in your area and when — so you always know help is nearby.</li>
            <li>📞 <strong>Emergency Contacts</strong> — Instant access to local emergency hotlines, barangay officials, and response teams.</li>
            <li>⚠️ <strong>Disaster Preparedness</strong> — View evacuation plans and disaster preparedness guides curated by your barangay.</li>
            <li>📢 <strong>Barangay Memorandums</strong> — Receive official announcements and notices posted directly by barangay administrators.</li>
            <li>💬 <strong>Resident Feedback</strong> — Submit concerns, suggestions, or reports directly to your barangay through the app.</li>
          </ul>
        </div>

        <div className="about-section">
          <h3 className="about-section-title">Why SentrySec?</h3>
          <p className="about-body">
            During emergencies, every second counts. SentrySec ensures that residents are never left in the dark — with critical information always at their fingertips and tanod personnel always aware of where help is needed most.
          </p>
        </div>

        <div className="about-section">
          <h3 className="about-section-title">Built For</h3>
          <p className="about-body">
            Barangay residents, tanod officers, and local government units who want a smarter, more connected, and more responsive community safety system.
          </p>
        </div>

        <div className="about-footer">
          <p>Version 1.0.0 &nbsp;•&nbsp; © 2026 SentrySec Team</p>
          <p>Technological Institute of the Philippines</p>
        </div>
      </div>
    )
  }

  // ── DEVELOPERS PAGE ───────────────────────────────────────
  const DEV_LIST = [
    { name: 'Santos, Kishi Blue N.',   course: 'BSIT', email: 'qkbnsantos@tip.edu.ph' },
    { name: 'Sastrillo, Lean Paolo J.', course: 'BSIT', email: 'qlpjsastrillo@tip.edu.ph' },
    { name: 'Sison, Geremy A.',         course: 'BSIT', email: 'qgasison@tip.edu.ph' },
    { name: 'Solas, Blessy Pearl B.',   course: 'BSIT', email: 'qbpbsolas@tip.edu.ph' },
    { name: 'Riparip, Jimuel M.',       course: 'BSIT', email: 'qjmriparip@tip.edu.ph' },
  ]
  function DevelopersPage() {
    return (
      <div className="dashboard__content">
        <button className="dashboard__back-btn" onClick={() => drawerNav('home')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>BACK
        </button>
        <p className="sched-page-title">DEVELOPERS</p>
        <p className="about-body" style={{textAlign:'center', marginBottom: 20}}>
          SentrySec was developed by the following students of the
          <strong> Technological Institute of the Philippines</strong>:
        </p>
        {DEV_LIST.map((dev, i) => (
          <div key={i} className="dev-card">
            <div className="dev-avatar">{dev.name.charAt(0)}</div>
            <div className="dev-info">
              <p className="dev-name">{dev.name}</p>
              <p className="dev-course">{dev.course}</p>
              <p className="dev-email">{dev.email}</p>
            </div>
          </div>
        ))}
        <div className="about-footer" style={{marginTop: 28}}>
          <p>Technological Institute of the Philippines</p>
          <p>© 2026 SentrySec Team</p>
        </div>
      </div>
    )
  }
  // ── NOTIFICATIONS PAGE ────────────────────────────────────
  function NotificationsPage() {
    function timeAgo(dateStr) {
      const diff = Date.now() - new Date(dateStr)
      const mins = Math.floor(diff / 60000)
      if (mins < 1) return 'just now'
      if (mins < 60) return `${mins}m ago`
      const hrs = Math.floor(mins / 60)
      if (hrs < 24) return `${hrs}h ago`
      return `${Math.floor(hrs / 24)}d ago`
    }
    function handleNotifClick(n) {
      if (n.type === 'alert') {
        setFocusedAlert({ lat: n.latitude, lng: n.longitude, title: n.title })
        setNotifOpen(false)
        setPage('home')
      } else {
        setNotifOpen(false)
        setPage('memorandums')
      }
    }
    return (
      <div className="notif-overlay">
        <div className="notif-header">
          <button className="notif-back" onClick={() => setNotifOpen(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="notif-header__title">All Notifications</span>
        </div>
        <div className="notif-list">
          {notifications.length === 0 ? (
            <div className="notif-empty">No notifications yet.</div>
          ) : notifications.map(n => (
            <button key={n.id} className={`notif-card${!seenIds.has(n.id) ? ' notif-card--unread' : ''}`} onClick={() => handleNotifClick(n)}>
              <div className={`notif-icon ${n.type === 'alert' ? 'notif-icon--alert' : 'notif-icon--memo'}`}>
                {n.type === 'alert' ? '⚠️' : '📢'}
              </div>
              <div className="notif-body">
                <p className="notif-type">{n.type === 'alert' ? 'ALERT' : 'ANNOUNCEMENT / MEMORANDUM'}</p>
                <p className="notif-title">{n.title}</p>
                {n.description && <p className="notif-desc">{n.description}</p>}
                <p className="notif-time">{timeAgo(n.created_at)}</p>
              </div>
              <svg className="notif-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── HOME PAGE ──────────────────────────────────────────
  function HomePage() {
    return (
      <div className="dashboard__content">
        {/* Map card */}
        <div className="dashboard__map-card">
          {locating && (
            <div className="dashboard__locating">
              <div className="dashboard__spinner" />
              <p>Getting your location...</p>
            </div>
          )}
          <MapContainer
            center={position ?? defaultCenter}
            zoom={position ? 17 : 14}
            className="dashboard__map"
            zoomControl={false}
            maxBounds={[[14.680, 120.990], [14.800, 121.110]]}
            maxBoundsViscosity={1.0}
            minZoom={13}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {notifications.filter(n => n.type === 'alert').map(a => (
              <Marker key={a.id} position={[a.latitude, a.longitude]} icon={getAlertIcon(a.description)} />
            ))}
            {evacuationAreas.filter(a => a.latitude && a.longitude).map(a => (
              <Marker key={`evac_${a.id}`} position={[a.latitude, a.longitude]} icon={evacuationAreaIcon} />
            ))}
            {position && (
              <>
                {focusedAlert
                  ? <RecenterMap position={[focusedAlert.lat, focusedAlert.lng]} />
                  : (!pinMode && <RecenterMap position={position} />)
                }
                <Marker
                  position={position}
                  draggable={pinMode}
                  ref={markerRef}
                  eventHandlers={pinMode ? { dragend: handlePinDragEnd } : {}}
                />
              </>
            )}
          </MapContainer>
        </div>

        {/* Alert focus bar */}
        {focusedAlert && (
          <div className="alert-focus-bar">
            <span className="alert-focus-bar__text">⚠️ {focusedAlert.title}</span>
            <button className="alert-focus-bar__clear" onClick={() => setFocusedAlert(null)}>My Location</button>
          </div>
        )}

        {/* Location field */}
        <div className="dashboard__location-block">
          <label className="dashboard__location-label">LOCATION:</label>
          <div className="dashboard__location-value">{address}</div>
        </div>

        {/* Confirmation */}
        {locationConfirmed === null && position && !pinMode && (
          <div className="dashboard__confirm-block">
            <p className="dashboard__confirm-text">IS YOUR LOCATION CORRECT?</p>
            <div className="dashboard__confirm-btns">
              <button
                className="dashboard__confirm-btn dashboard__confirm-btn--no"
                onClick={() => setPinMode(true)}
              >NO</button>
              <button
                className="dashboard__confirm-btn dashboard__confirm-btn--yes"
                onClick={confirmLocation}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'YES'}
              </button>
            </div>
            {saveError && <p className="dashboard__save-error">{saveError}</p>}
          </div>
        )}

        {pinMode && (
          <div className="dashboard__confirm-block">
            <p className="dashboard__confirm-text">DRAG THE PIN TO YOUR CORRECT LOCATION</p>
            <button
              className="dashboard__confirm-btn dashboard__confirm-btn--yes"
              onClick={confirmLocation}
              disabled={saving || address === 'Getting address...'}
            >
              {saving ? 'Saving...' : 'YES, THIS IS MY LOCATION'}
            </button>
            {saveError && <p className="dashboard__save-error">{saveError}</p>}
          </div>
        )}

        {locationConfirmed === true && (
          <div className="location-confirmed-row">
            <p className="dashboard__confirm-hint confirmed">Location confirmed!</p>
            <button className="update-location-btn" onClick={fetchCurrentLocation}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="15" height="15"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              UPDATE LOCATION
            </button>
          </div>
        )}

        {/* SOS Button */}
        {position && (
          <div className="sos-section">
            {sosState === 'idle' && (
              <button className="sos-btn" onClick={() => setSosState('confirming')}>
                <span className="sos-btn__icon">🚨</span>
                <span className="sos-btn__label">SOS EMERGENCY</span>
              </button>
            )}

            {sosState === 'confirming' && (
              <div className="sos-confirm">
                <p className="sos-confirm__title">⚠️ Send SOS Alert?</p>
                <p className="sos-confirm__sub">This will immediately notify all tanod personnel and barangay officials with your current location.</p>
                <div className="sos-confirm__btns">
                  <button className="sos-confirm__cancel" onClick={() => setSosState('idle')}>CANCEL</button>
                  <button className="sos-confirm__send" onClick={handleSendSOS}>SEND SOS</button>
                </div>
              </div>
            )}

            {sosState === 'sending' && (
              <div className="sos-status sos-status--sending">
                <div className="dashboard__spinner" style={{borderTopColor:'#fff'}} />
                <p>Sending SOS alert...</p>
              </div>
            )}

            {sosState === 'sent' && (
              <div className="sos-status sos-status--sent">
                <p className="sos-status__icon">✅</p>
                <p className="sos-status__text">SOS SENT! Help is on the way.</p>
                <p className="sos-status__sub">Tanod and barangay officials have been notified with your location.</p>
                <button className="sos-status__reset" onClick={() => setSosState('idle')}>DISMISS</button>
              </div>
            )}

            {sosState === 'error' && (
              <div className="sos-status sos-status--error">
                <p>{sosError}</p>
                <button className="sos-status__reset" onClick={() => setSosState('idle')}>TRY AGAIN</button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const DRAWER_ITEMS = [
    { label: 'HOME',                dest: 'home',      icon: <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></> },
    { label: 'TANOD SCHEDULES',     dest: 'schedules', icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></> },
    { label: 'BARANGAY MEMORANDUMS',dest: 'memorandums',icon: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
    { label: 'EMERGENCY CONTACTS',  dest: 'emergency', icon: <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-5-5 19.79 19.79 0 01-3.07-8.63A2 2 0 014 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14v2.92z"/> },
    { label: 'EVACUATION AREAS',    dest: 'evacuation',icon: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></> },
    { label: 'FEEDBACK',            dest: 'feedback',  icon: <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/> },
    { label: 'PROFILE',             dest: 'profile',   icon: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></> },
    { label: 'ABOUT THE APP',       dest: 'about',     icon: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></> },
    { label: 'DEVELOPERS',          dest: 'developers',icon: <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></> },
  ]

  return (
    <div className="dashboard">
      {/* Notifications overlay */}
      {notifOpen && <NotificationsPage />}

      {/* Side drawer overlay */}
      {drawerOpen && <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} />}

      {/* Side drawer */}
      <div className={`drawer${drawerOpen ? ' drawer--open' : ''}`}>
        <div className="drawer__header">
          <div className="drawer__avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <p className="drawer__name">{user?.full_name ?? 'User'}</p>
          <p className="drawer__contact">{user?.contact_number ?? ''}</p>
        </div>
        <nav className="drawer__nav">
          {DRAWER_ITEMS.map(item => (
            <button key={item.dest} className={`drawer__item${page === item.dest ? ' drawer__item--active' : ''}`} onClick={() => drawerNav(item.dest)}>
              <svg className="drawer__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{item.icon}</svg>
              <span>{item.label}</span>
            </button>
          ))}
          <button className="drawer__item drawer__item--logout" onClick={() => { setDrawerOpen(false); onLogout() }}>
            <svg className="drawer__item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>LOGOUT</span>
          </button>
        </nav>
      </div>

      {/* Top bar */}
      <div className="dashboard__topbar">
        <button className="dashboard__menu" onClick={() => setDrawerOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="dashboard__title">SENTRYSEC</span>
        <button className="dashboard__topbtn notif-bell-btn" onClick={() => {
          const newSeen = new Set([...seenIds, ...notifications.map(n => n.id)])
          setSeenIds(newSeen)
          localStorage.setItem('ss_seen_notifs', JSON.stringify([...newSeen]))
          setNotifOpen(true)
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
          {notifications.filter(n => !seenIds.has(n.id)).length > 0 && (
            <span className="notif-badge">
              {notifications.filter(n => !seenIds.has(n.id)).length > 9 ? '9+' : notifications.filter(n => !seenIds.has(n.id)).length}
            </span>
          )}
        </button>
      </div>

      {/* Page content */}
      {page === 'home'        && <HomePage />}
      {page === 'info'        && <InfoPage />}
      {page === 'schedules'   && <SchedulesPage />}
      {page === 'safetyguide' && <SafetyGuidePage />}
      {page === 'profile'     && <ProfilePage />}
      {page === 'emergency'   && <EmergencyContactsPage />}
      {page === 'evacuation'  && <EvacuationAreasPage />}
      {page === 'memorandums' && <MemorandumsPage />}
      {page === 'feedback'    && <FeedbackPage />}
      {page === 'about'       && <AboutPage />}
      {page === 'developers'  && <DevelopersPage />}

      {/* Bottom nav — Info | Home | Profile */}
      <div className="dashboard__bottomnav">
        <button
          className={`dashboard__navbtn${page === 'info' || page === 'schedules' || page === 'safetyguide' || page === 'emergency' || page === 'evacuation' ? ' active' : ''}`}
          onClick={() => setPage('info')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>Info</span>
        </button>
        <button
          className={`dashboard__navbtn${page === 'home' ? ' active' : ''}`}
          onClick={() => setPage('home')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Home</span>
        </button>
        <button
          className={`dashboard__navbtn${page === 'profile' ? ' active' : ''}`}
          onClick={() => setPage('profile')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>Profile</span>
        </button>
      </div>
    </div>
  )
}
