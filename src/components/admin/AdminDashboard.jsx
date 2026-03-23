import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  getAdminStats, createTanodAccount, deleteTanodAccount,
  postMemorandum, deleteMemorandum,
  resolveSosAlert, getSosHistory,
  addTanodSchedule, updateScheduleStatus, deleteScheduleEntry,
  postAlertMarker, deactivateAlertMarker,
  updateUserProfile,
  addEmergencyContact, deleteEmergencyContact,
  addEvacuationArea, deleteEvacuationArea,
  addDisasterPlan, deleteDisasterPlan,
} from '../../db/auth'
import './AdminDashboard.css'

const FAIRVIEW_CENTER = [14.7380, 121.0584]
const FAIRVIEW_BOUNDS = [[14.680, 120.990], [14.800, 121.110]]

const MARKER_TYPES = [
  { id: 'accident',  label: 'Accident',           emoji: '🚗' },
  { id: 'criminal',  label: 'Criminal Activity',   emoji: '🔪' },
  { id: 'flood',     label: 'Flood',               emoji: '🌊' },
  { id: 'fire',      label: 'Fire',                emoji: '🔥' },
  { id: 'hazard',    label: 'Road Hazard',         emoji: '🚧' },
  { id: 'medical',   label: 'Medical Emergency',   emoji: '🏥' },
]

function makeAdminMarkerIcon(emoji) {
  return L.divIcon({
    html: `<div style="font-size:26px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.45))">${emoji}</div>`,
    className: 'adm-leaflet-emoji-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({ click(e) { onMapClick(e.latlng) } })
  return null
}

async function reverseGeocode(lat, lng) {
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

export default function AdminDashboard({ user, onLogout, onUserUpdate }) {
  const [page, setPage] = useState('home')
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    setStatsLoading(true)
    const data = await getAdminStats()
    setStats(data)
    setStatsLoading(false)
  }

  function goHome() {
    setPage('home')
    loadStats()
  }

  // ── HOME / DASHBOARD ──────────────────────────────────────
  function HomePage() {
    if (statsLoading) return (
      <div className="adm-loading">
        <div className="adm-spinner" />
        <p>Loading dashboard...</p>
      </div>
    )
    if (!stats) return null

    const now = new Date()
    const todayStr = now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0)

    const tanodOnDuty = stats.schedules.filter(s => s.status === 'on-duty').length
    const uniqueScheduled = new Set(stats.schedules.map(s => s.name)).size
    const todayDayNameHome = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    const todayShifts = stats.schedules.filter(s => s.time_shift?.startsWith(todayDayNameHome))
    const schedToday = todayShifts.length
    const onDutyToday = new Set(todayShifts.map(s => s.name)).size
    const offDutyToday = 0 // kept for compat
    const activeMarkers = (stats.markers ?? []).filter(m => m.is_active).length
    const resolvedMarkers = (stats.markers ?? []).filter(m => !m.is_active).length
    const feedbackCount = stats.feedback.length
    const emergencyContactsCount = (stats.emergencyContacts ?? []).length
    const evacuationAreasCount = (stats.evacuationAreas ?? []).length
    const disasterPlansCount = (stats.disasterPlans ?? []).length

    return (
      <div className="adm-content">
        <h1 className="adm-home-title">Dashboard</h1>
        <p className="adm-home-sub">Barangay Safety Overview · {todayStr}</p>

        {/* SOS Alert banner */}
        {stats.sos.length > 0 && (
          <button className="adm-banner adm-banner--sos" onClick={() => setPage('sos')}>
            <span className="adm-banner__icon">🚨</span>
            <div className="adm-banner__body">
              <p className="adm-banner__title">{stats.sos.length} Active SOS Alert{stats.sos.length !== 1 ? 's' : ''}</p>
              <p className="adm-banner__sub">{stats.sos[0].full_name} — {stats.sos[0].address?.slice(0, 45)}</p>
            </div>
            <span className="adm-banner__btn">View</span>
          </button>
        )}

        {/* Cards grid */}
        <div className="adm-cards-grid">

        {/* Personnel */}
        <button className="adm-card" onClick={() => setPage('personnel')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Personnel</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
          </div>
          <p className="adm-card__num">{stats.tanods.length}</p>
          <p className="adm-card__viewall">View All →</p>
        </button>

        {/* Schedules */}
        <button className="adm-card" onClick={() => setPage('schedules')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Schedules</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div className="adm-card__num-row">
            <p className="adm-card__num">{uniqueScheduled}</p>
            <div className="adm-card__tags">
              <span className="adm-tag adm-tag--green">{onDutyToday} Today</span>
            </div>
          </div>
          <p className="adm-card__viewall">View All →</p>
        </button>

        {/* Alert Markers */}
        <button className="adm-card" onClick={() => setPage('alerts')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Alert Markers</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
          </div>
          <div className="adm-card__num-row">
            <p className="adm-card__num">{activeMarkers + resolvedMarkers}</p>
            <div className="adm-card__tags">
              <span className="adm-tag adm-tag--red">{activeMarkers} Active</span>
            </div>
          </div>
          <p className="adm-card__viewall">Post / Manage →</p>
        </button>

        {/* SOS History */}
        <button className="adm-card" onClick={() => setPage('sos-history')}>
          <div className="adm-card__row">
            <span className="adm-card__label">SOS History</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 14 14"/>
            </svg>
          </div>
          <p className="adm-card__num">{stats.sosHistoryCount ?? 0}</p>
          <p className="adm-card__viewall">View History →</p>
        </button>

        {/* Emergency Contacts */}
        <button className="adm-card" onClick={() => setPage('emergency-contacts')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Emergency</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 12 19.79 19.79 0 012 3.18 2 2 0 014 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
            </svg>
          </div>
          <p className="adm-card__num">{emergencyContactsCount}</p>
          <p className="adm-card__viewall">Manage →</p>
        </button>

        {/* Evacuation Areas */}
        <button className="adm-card" onClick={() => setPage('evacuation-areas')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Evacuation</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <p className="adm-card__num">{evacuationAreasCount}</p>
          <p className="adm-card__viewall">Manage →</p>
        </button>

        {/* Registered Residents */}
        <button className="adm-card" onClick={() => setPage('users')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Residents</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <p className="adm-card__num">{stats.users.length}</p>
          <p className="adm-card__viewall">View All →</p>
        </button>

        {/* Memorandums */}
        <button className="adm-card" onClick={() => setPage('memorandums')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Memorandums</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <p className="adm-card__num">{stats.memos.length}</p>
          <p className="adm-card__viewall">View All →</p>
        </button>

        {/* Feedback */}
        <button className="adm-card" onClick={() => setPage('feedback')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Feedback</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
          </div>
          <p className="adm-card__num">{feedbackCount}</p>
          <p className="adm-card__viewall">View All →</p>
        </button>

        {/* Disaster Plans */}
        <button className="adm-card" onClick={() => setPage('disaster-plans')}>
          <div className="adm-card__row">
            <span className="adm-card__label">Disaster Plans</span>
            <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <p className="adm-card__num">{disasterPlansCount}</p>
          <p className="adm-card__viewall">Manage →</p>
        </button>

        </div>
      </div>
    )
  }

  // ── PERSONNEL PAGE ────────────────────────────────────────
  function PersonnelPage() {
    const [tanods, setTanods] = useState(stats?.tanods ?? [])
    const [showForm, setShowForm] = useState(false)
    const [form, setForm] = useState({ fullName: '', username: '', password: '', contactNumber: '' })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [deleteTarget, setDeleteTarget] = useState(null)

    async function handleCreate(e) {
      e.preventDefault()
      if (!form.fullName || !form.username || !form.password) { setError('Full name, username and password are required.'); return }
      setSaving(true); setError(''); setSuccess('')
      const res = await createTanodAccount(form)
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      const fresh = await getAdminStats()
      setTanods(fresh.tanods)
      setSuccess('Tanod account created successfully!')
      setForm({ fullName: '', username: '', password: '', contactNumber: '' })
      setShowForm(false)
    }

    async function handleDelete(id) {
      await deleteTanodAccount(id)
      setTanods(t => t.filter(x => x.id !== id))
      setDeleteTarget(null)
    }

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Personnel</h2>
          <button className="adm-add-btn" onClick={() => { setShowForm(v => !v); setError(''); setSuccess('') }}>
            {showForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {success && <p className="adm-success">{success}</p>}

        {showForm && (
          <form className="adm-form" onSubmit={handleCreate}>
            <p className="adm-form__title">Create Tanod Account</p>
            <input className="adm-input" placeholder="Full Name *" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
            <input className="adm-input" placeholder="Username *" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            <input className="adm-input" type="password" placeholder="Password *" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            <input className="adm-input" placeholder="Contact Number" value={form.contactNumber} onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))} />
            {error && <p className="adm-error">{error}</p>}
            <button className="adm-submit-btn" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Account'}</button>
          </form>
        )}

        {tanods.length === 0
          ? <p className="adm-empty">No tanod accounts yet. Tap + Add to create one.</p>
          : (() => {
            const todayISO = new Date().toISOString().slice(0, 10)
            const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
            const onDutyToday = new Set(
              (stats?.schedules ?? [])
                .filter(s => s.time_shift?.startsWith(todayDayName) || s.time_shift?.startsWith(todayISO))
                .map(s => s.name)
            )
            return tanods.map(t => (
              <div key={t.id} className="adm-list-card">
                <div className={`adm-list-card__avatar${onDutyToday.has(t.full_name) ? ' adm-list-card__avatar--green' : ''}`}>
                  {t.full_name?.charAt(0) ?? 'T'}
                </div>
                <div className="adm-list-card__info">
                  <p className="adm-list-card__name">{t.full_name}</p>
                  <p className="adm-list-card__sub">@{t.username}</p>
                  <p className="adm-list-card__sub">{t.contact_number || 'No contact'}</p>
                  <span className={`adm-tag ${onDutyToday.has(t.full_name) ? 'adm-tag--green' : 'adm-tag--gray'}`} style={{ fontSize: '0.68rem', marginTop: 3 }}>
                    {onDutyToday.has(t.full_name) ? 'On Duty Today' : 'Off Duty Today'}
                  </span>
                </div>
                {deleteTarget === t.id
                  ? <div className="adm-inline-confirm">
                      <button className="adm-inline-confirm__yes" onClick={() => handleDelete(t.id)}>Delete</button>
                      <button className="adm-inline-confirm__no" onClick={() => setDeleteTarget(null)}>Cancel</button>
                    </div>
                  : <button className="adm-del-btn" onClick={() => setDeleteTarget(t.id)}>✕</button>
                }
              </div>
            ))
          })()
        }
      </div>
    )
  }

  // ── SCHEDULES PAGE ────────────────────────────────────────
  function SchedulesAdminPage() {
    const [schedules, setSchedules] = useState(stats?.schedules ?? [])
    const [showForm, setShowForm] = useState(false)
    const [showTanodPicker, setShowTanodPicker] = useState(false)
    const [selectedTanod, setSelectedTanod] = useState('')
    const [contactNumber, setContactNumber] = useState('')
    const [selectedDays, setSelectedDays] = useState([]) // [{date: 'Monday', start, end}]
    const [dayInput, setDayInput] = useState('')
    const [dayStartTime, setDayStartTime] = useState('08:00')
    const [dayEndTime, setDayEndTime] = useState('16:00')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [expandedTanod, setExpandedTanod] = useState(null)

    const tanods = stats?.tanods ?? []
    const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    const todayISO = new Date().toISOString().slice(0, 10)
    const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

    // Group schedules by tanod name
    const groupedSchedules = schedules.reduce((acc, s) => {
      if (!acc[s.name]) acc[s.name] = []
      acc[s.name].push(s)
      return acc
    }, {})

    function pickTanod(t) {
      setSelectedTanod(t.full_name)
      setContactNumber(t.contact_number ?? '')
      setShowTanodPicker(false)
    }

    function addDay() {
      if (!dayInput) { setError('Select a day first.'); return }
      if (selectedDays.some(d => d.date === dayInput)) { setError(`${dayInput} already added.`); return }
      if (dayStartTime >= dayEndTime) { setError('End time must be after start time.'); return }
      setSelectedDays(days => [...days, { date: dayInput, start: dayStartTime, end: dayEndTime }].sort((a, b) => DAY_ORDER.indexOf(a.date) - DAY_ORDER.indexOf(b.date)))
      setDayInput('')
      setError('')
    }

    function removeDay(dayName) { setSelectedDays(days => days.filter(x => x.date !== dayName)) }

    function formatDayChipLabel(dayObj) {
      const fmt = t => { const [h, min] = t.split(':').map(Number); return `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }
      return `${dayObj.date} · ${fmt(dayObj.start)}–${fmt(dayObj.end)}`
    }

    function formatShiftDisplay(ts) {
      const fmt = t => { const [h, min] = t.split(':').map(Number); return `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }
      const mNew = ts?.match(/^([A-Za-z]+) (\d{2}:\d{2})–(\d{2}:\d{2})$/)
      if (mNew) return `${mNew[1]} · ${fmt(mNew[2])} – ${fmt(mNew[3])}`
      const mOld = ts?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})–(\d{2}:\d{2})$/)
      if (mOld) {
        const day = new Date(mOld[1] + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        return `${day} · ${fmt(mOld[2])} – ${fmt(mOld[3])}`
      }
      return ts ?? ''
    }

    async function handleAdd() {
      if (!selectedTanod) { setError('Select a tanod.'); return }
      if (selectedDays.length === 0) { setError('Add at least one day.'); return }
      setSaving(true); setError(''); setSuccess('')
      const entries = selectedDays.map(day => ({ name: selectedTanod, timeShift: `${day.date} ${day.start}–${day.end}`, contactNumber }))
      const res = await addTanodSchedule(entries)
      setSaving(false)
      if (!res.success) { setError(res.error || 'Failed to save schedules.'); return }
      setSuccess(`${selectedDays.length} schedule${selectedDays.length > 1 ? 's' : ''} added!`)
      const fresh = await getAdminStats()
      setSchedules(fresh.schedules)
      setSelectedTanod(''); setContactNumber(''); setSelectedDays([]); setDayInput(''); setDayStartTime('08:00'); setDayEndTime('16:00')
      setShowForm(false)
    }

    async function handleToggle(id, current) {
      const next = current === 'on-duty' ? 'off-duty' : 'on-duty'
      await updateScheduleStatus({ id, status: next })
      setSchedules(s => s.map(x => x.id === id ? { ...x, status: next } : x))
      setStats(st => st ? { ...st, schedules: st.schedules.map(x => x.id === id ? { ...x, status: next } : x) } : st)
    }

    async function handleDelete(id) {
      await deleteScheduleEntry(id)
      setSchedules(s => s.filter(x => x.id !== id))
      setStats(st => st ? { ...st, schedules: st.schedules.filter(x => x.id !== id) } : st)
    }

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Schedules</h2>
          <button className="adm-add-btn" onClick={() => { setShowForm(v => !v); setError(''); setSuccess('') }}>
            {showForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {success && <p className="adm-success">{success}</p>}

        {showForm && (
          <div className="adm-form">
            <p className="adm-form__title">Add Tanod Schedule</p>

            {/* Custom tanod picker trigger */}
            <button
              type="button"
              className={`adm-picker-trigger${selectedTanod ? ' adm-picker-trigger--filled' : ''}`}
              onClick={() => setShowTanodPicker(true)}
            >
              <span>{selectedTanod || '— Select Tanod *'}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="adm-picker-trigger__chevron">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {/* Auto-filled contact */}
            <input
              className="adm-input"
              placeholder="Contact Number (auto-filled)"
              value={contactNumber}
              readOnly
              style={{ background: '#f3f4f6', color: '#6b7280' }}
            />

            {/* Day + per-day time picker */}
            <label className="adm-field-label">Add Day & Shift</label>
            <div className="adm-day-selector">
              {DAY_ORDER.map(d => (
                <button
                  key={d}
                  type="button"
                  className={`adm-day-selector__btn${dayInput === d ? ' adm-day-selector__btn--active' : ''}${selectedDays.some(s => s.date === d) ? ' adm-day-selector__btn--done' : ''}`}
                  onClick={() => setDayInput(d)}
                >
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
            <div className="adm-time-row" style={{ marginTop: 8 }}>
              <div className="adm-time-group">
                <span className="adm-time-label">Start</span>
                <input className="adm-input" type="time" value={dayStartTime} onChange={e => setDayStartTime(e.target.value)} />
              </div>
              <span className="adm-time-sep">–</span>
              <div className="adm-time-group">
                <span className="adm-time-label">End</span>
                <input className="adm-input" type="time" value={dayEndTime} onChange={e => setDayEndTime(e.target.value)} />
              </div>
            </div>
            <button type="button" className="adm-add-day-btn adm-add-day-btn--full" onClick={addDay}>+ Add Day</button>
            {selectedDays.length > 0 && (
              <div className="adm-day-chips">
                {selectedDays.map(d => (
                  <span key={d.date} className="adm-day-chip">
                    {formatDayChipLabel(d)}
                    <button type="button" className="adm-day-chip__remove" onClick={() => removeDay(d.date)}>✕</button>
                  </span>
                ))}
              </div>
            )}

            {error && <p className="adm-error">{error}</p>}
            <button
              className="adm-submit-btn"
              type="button"
              onClick={handleAdd}
              disabled={saving || selectedDays.length === 0 || !selectedTanod}
            >
              {saving ? 'Adding...' : `Add ${selectedDays.length > 0 ? selectedDays.length + ' ' : ''}Schedule${selectedDays.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {/* ── Custom tanod picker popup ── */}
        {showTanodPicker && (
          <div className="adm-popup-overlay" onClick={() => setShowTanodPicker(false)}>
            <div className="adm-popup-sheet" onClick={e => e.stopPropagation()}>
              <div className="adm-popup-sheet__handle" />
              <p className="adm-popup-sheet__title">Select Tanod</p>
              <div className="adm-popup-sheet__list">
                {tanods.length === 0
                  ? <p className="adm-empty" style={{ padding: '16px 0' }}>No tanods yet. Add tanod accounts first.</p>
                  : tanods.map(t => (
                    <button
                      key={t.id}
                      className={`adm-popup-option${selectedTanod === t.full_name ? ' adm-popup-option--active' : ''}`}
                      onClick={() => pickTanod(t)}
                    >
                      <div className={`adm-popup-option__avatar${selectedTanod === t.full_name ? ' adm-popup-option__avatar--active' : ''}`}>
                        {t.full_name?.charAt(0)}
                      </div>
                      <div className="adm-popup-option__info">
                        <p className="adm-popup-option__name">{t.full_name}</p>
                        <p className="adm-popup-option__sub">{t.contact_number || 'No contact'}</p>
                      </div>
                      {selectedTanod === t.full_name && (
                        <svg className="adm-popup-option__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </button>
                  ))
                }
              </div>
              <button className="adm-popup-sheet__cancel" onClick={() => setShowTanodPicker(false)}>Cancel</button>
            </div>
          </div>
        )}

        {schedules.length === 0
          ? <p className="adm-empty">No schedules yet.</p>
          : Object.entries(groupedSchedules).map(([name, entries]) => {
            const isExpanded = expandedTanod === name
            const hasToday = entries.some(s => s.time_shift?.startsWith(todayDayName) || s.time_shift?.startsWith(todayISO))
            const onDutyCount = entries.filter(s => s.status === 'on-duty').length
            return (
              <div key={name} className="adm-sched-group">
                {/* Group header card */}
                <button
                  type="button"
                  className={`adm-list-card adm-list-card--clickable${isExpanded ? ' adm-list-card--expanded' : ''}`}
                  onClick={() => setExpandedTanod(isExpanded ? null : name)}
                >
                  <div className={`adm-list-card__avatar${onDutyCount > 0 ? ' adm-list-card__avatar--green' : ''}`}>
                    {name?.charAt(0) ?? 'T'}
                  </div>
                  <div className="adm-list-card__info">
                    <p className="adm-list-card__name">{name}</p>
                    <p className="adm-list-card__sub">{entries.length} day{entries.length !== 1 ? 's' : ''} scheduled</p>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:2 }}>
                      {hasToday && <span className="adm-tag adm-tag--green" style={{ fontSize:'0.68rem' }}>On Duty</span>}
                    </div>
                  </div>
                  <svg
                    className="adm-sched-group__chevron"
                    style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {/* Expanded day rows */}
                {isExpanded && (
                  <div className="adm-sched-group__rows">
                    {entries.map(s => {
                      const isToday = s.time_shift?.startsWith(todayDayName) || s.time_shift?.startsWith(todayISO)
                      return (
                        <div key={s.id} className="adm-sched-row">
                          <div className="adm-sched-row__info">
                            <p className="adm-sched-row__shift">{formatShiftDisplay(s.time_shift)}</p>
                            {isToday && <span className="adm-tag adm-tag--green" style={{ fontSize:'0.65rem' }}>On Duty</span>}
                          </div>
                          <div className="adm-list-card__actions">
                            <button className="adm-del-btn" onClick={() => handleDelete(s.id)}>✕</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        }
      </div>
    )
  }

  // ── MEMORANDUMS PAGE ──────────────────────────────────────
  function MemorandumsAdminPage() {
    const [memos, setMemos] = useState(stats?.memos ?? [])
    const [showForm, setShowForm] = useState(false)
    const [form, setForm] = useState({ title: '', content: '' })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [deleteTarget, setDeleteTarget] = useState(null)

    async function handlePost(e) {
      e.preventDefault()
      if (!form.title || !form.content) { setError('Title and content are required.'); return }
      setSaving(true); setError('')
      const res = await postMemorandum({ title: form.title, content: form.content })
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      const fresh = await getAdminStats()
      setMemos(fresh.memos)
      setForm({ title: '', content: '' })
      setShowForm(false)
    }

    async function handleDelete(id) {
      await deleteMemorandum(id)
      setMemos(m => m.filter(x => x.id !== id))
      setDeleteTarget(null)
    }

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Memorandums</h2>
          <button className="adm-add-btn" onClick={() => { setShowForm(v => !v); setError('') }}>
            {showForm ? 'Cancel' : '+ Post'}
          </button>
        </div>

        {showForm && (
          <form className="adm-form" onSubmit={handlePost}>
            <p className="adm-form__title">Post New Memorandum</p>
            <input className="adm-input" placeholder="Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea className="adm-textarea" placeholder="Content / Announcement..." rows={5} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
            {error && <p className="adm-error">{error}</p>}
            <button className="adm-submit-btn" type="submit" disabled={saving}>{saving ? 'Posting...' : 'Post Memorandum'}</button>
          </form>
        )}

        {memos.length === 0
          ? <p className="adm-empty">No memorandums posted yet.</p>
          : memos.map(m => (
            <div key={m.id} className="adm-memo-card">
              <div className="adm-memo-card__header">
                <div>
                  <p className="adm-memo-card__title">{m.title}</p>
                  <p className="adm-memo-card__date">
                    {new Date(m.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                {deleteTarget === m.id
                  ? <div className="adm-inline-confirm">
                      <button className="adm-inline-confirm__yes" onClick={() => handleDelete(m.id)}>Delete</button>
                      <button className="adm-inline-confirm__no" onClick={() => setDeleteTarget(null)}>Cancel</button>
                    </div>
                  : <button className="adm-del-btn" onClick={() => setDeleteTarget(m.id)}>✕</button>
                }
              </div>
              {m.content && <p className="adm-memo-card__preview">{m.content.slice(0, 80)}{m.content.length > 80 ? '...' : ''}</p>}
            </div>
          ))
        }
      </div>
    )
  }

  // ── FEEDBACK PAGE ─────────────────────────────────────────
  function FeedbackAdminPage() {
    const feedback = stats?.feedback ?? []

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Feedback</h2>
          <span />
        </div>

        {feedback.length === 0
          ? <p className="adm-empty">No feedback submitted yet.</p>
          : feedback.map(f => (
            <div key={f.id} className="adm-feedback-card">
              <div className="adm-feedback-card__header">
                <p className="adm-feedback-card__name">{f.full_name || 'Anonymous'}</p>
                <p className="adm-feedback-card__date">
                  {new Date(f.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <p className="adm-feedback-card__message">{f.message}</p>
            </div>
          ))
        }
      </div>
    )
  }

  // ── EMERGENCY CONTACTS PAGE ─────────────────────────────
  function EmergencyContactsPage() {
    const [contacts, setContacts] = useState(stats?.emergencyContacts ?? [])
    const [showForm, setShowForm] = useState(false)
    const [form, setForm] = useState({ name: '', role: '', contactNumber: '' })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [deleteTarget, setDeleteTarget] = useState(null)

    async function handleAdd(e) {
      e.preventDefault()
      if (!form.name || !form.contactNumber) { setError('Name and contact number are required.'); return }
      setSaving(true); setError('')
      const res = await addEmergencyContact({ name: form.name, role: form.role, contactNumber: form.contactNumber })
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      const fresh = await getAdminStats()
      setContacts(fresh.emergencyContacts)
      setForm({ name: '', role: '', contactNumber: '' })
      setShowForm(false)
    }

    async function handleDelete(id) {
      await deleteEmergencyContact(id)
      setContacts(c => c.filter(x => x.id !== id))
      setDeleteTarget(null)
    }

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Emergency Contacts</h2>
          <button className="adm-add-btn" onClick={() => { setShowForm(v => !v); setError('') }}>
            {showForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showForm && (
          <form className="adm-form" onSubmit={handleAdd}>
            <p className="adm-form__title">Add Emergency Contact</p>
            <input className="adm-input" placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="adm-input" placeholder="Role / Organization (e.g. Police, Fire Dept)" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
            <input className="adm-input" placeholder="Contact Number *" value={form.contactNumber} onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))} />
            {error && <p className="adm-error">{error}</p>}
            <button className="adm-submit-btn" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Contact'}</button>
          </form>
        )}

        {contacts.length === 0
          ? <p className="adm-empty">No emergency contacts added yet.</p>
          : contacts.map(c => (
            <div key={c.id} className="adm-list-card">
              <div className="adm-list-card__avatar" style={{ background: '#c0392b', fontSize: '1.1rem' }}>📞</div>
              <div className="adm-list-card__info">
                <p className="adm-list-card__name">{c.name}</p>
                {c.role && <span className="adm-tag adm-tag--blue" style={{ fontSize: '0.68rem', marginBottom: 2 }}>{c.role}</span>}
                <p className="adm-list-card__sub">{c.contact_number}</p>
              </div>
              {deleteTarget === c.id
                ? <div className="adm-inline-confirm">
                    <button className="adm-inline-confirm__yes" onClick={() => handleDelete(c.id)}>Delete</button>
                    <button className="adm-inline-confirm__no" onClick={() => setDeleteTarget(null)}>Cancel</button>
                  </div>
                : <button className="adm-del-btn" onClick={() => setDeleteTarget(c.id)}>✕</button>
              }
            </div>
          ))
        }
      </div>
    )
  }

  // ── EVACUATION AREAS PAGE ──────────────────────────
  function EvacuationAreasPage() {
    const [areas, setAreas] = useState([])
    const [loadingList, setLoadingList] = useState(true)
    const [showPicker, setShowPicker] = useState(false)
    const [pinCoords, setPinCoords] = useState(null)
    const [pinAddress, setPinAddress] = useState('')
    const [geocoding, setGeocoding] = useState(false)
    const [areaName, setAreaName] = useState('')
    const [description, setDescription] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [deleteTarget, setDeleteTarget] = useState(null)
    const [geoAddresses, setGeoAddresses] = useState({})
    const mapRef = useRef(null)

    useEffect(() => {
      import('../../db/db').then(({ supabase }) => {
        supabase.from('safety_evacuation_areas')
          .select('id, name, address, description, latitude, longitude')
          .order('created_at', { ascending: true })
          .then(({ data }) => { setAreas(data ?? []); setLoadingList(false) })
      })
    }, [])

    useEffect(() => {
      const missing = areas.filter(a => !a.address)
      if (!missing.length) return
      missing.forEach(async a => {
        const addr = await reverseGeocode(a.latitude, a.longitude)
        if (addr) setGeoAddresses(prev => ({ ...prev, [a.id]: addr }))
      })
    }, [areas])

    useEffect(() => {
      if (showPicker) {
        const t = setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize() }, 150)
        return () => clearTimeout(t)
      }
    }, [showPicker])

    async function handleMapClick(ll) {
      setPinCoords({ lat: ll.lat, lng: ll.lng })
      setPinAddress('')
      setGeocoding(true)
      const addr = await reverseGeocode(ll.lat, ll.lng)
      setPinAddress(addr)
      setGeocoding(false)
    }

    async function handlePost() {
      if (!pinCoords) { setError('Tap on the map to pin the evacuation area first.'); return }
      if (!areaName.trim()) { setError('Enter a name for this evacuation area.'); return }
      setSaving(true); setError('')
      const res = await addEvacuationArea({
        name: areaName.trim(),
        latitude: pinCoords.lat,
        longitude: pinCoords.lng,
        description: description.trim(),
        address: pinAddress,
      })
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      import('../../db/db').then(({ supabase }) => {
        supabase.from('safety_evacuation_areas')
          .select('id, name, address, description, latitude, longitude')
          .order('created_at', { ascending: true })
          .then(({ data }) => setAreas(data ?? []))
      })
      setPinCoords(null); setAreaName(''); setDescription(''); setPinAddress(''); setShowPicker(false)
    }

    async function handleDelete(id) {
      await deleteEvacuationArea(id)
      setAreas(a => a.filter(x => x.id !== id))
      setDeleteTarget(null)
    }

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Evacuation Areas</h2>
          <button className="adm-add-btn" onClick={() => { setShowPicker(v => !v); setError(''); setPinCoords(null) }}>
            {showPicker ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showPicker && (
          <div className="adm-map-picker-card">
            <input
              className="adm-input"
              placeholder="Area Name * (e.g. Covered Court, Barangay Hall)"
              value={areaName}
              onChange={e => setAreaName(e.target.value)}
            />
            <textarea
              className="adm-textarea"
              placeholder="Notes / Description (optional)"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />

            <p className="adm-map-picker__hint" style={{ marginTop: 8 }}>📍 Tap on the map to pin the evacuation area</p>

            <div className="adm-map-picker__mapcont">
              <MapContainer
                ref={mapRef}
                center={FAIRVIEW_CENTER}
                zoom={14}
                maxBounds={FAIRVIEW_BOUNDS}
                maxBoundsViscosity={1.0}
                minZoom={13}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler onMapClick={handleMapClick} />
                {pinCoords && (
                  <Marker
                    position={[pinCoords.lat, pinCoords.lng]}
                    icon={makeAdminMarkerIcon('🏠')}
                  />
                )}
              </MapContainer>
            </div>

            {pinCoords && (
              <p className="adm-map-picker__coords">
                {geocoding ? 'Getting street address…' : (pinAddress || `${pinCoords.lat.toFixed(5)}, ${pinCoords.lng.toFixed(5)}`)}
              </p>
            )}

            {error && <p className="adm-error" style={{ marginTop: 4 }}>{error}</p>}

            <button
              className="adm-submit-btn"
              onClick={handlePost}
              disabled={saving || !pinCoords || geocoding}
              style={{ marginTop: 10 }}
            >
              {saving ? 'Saving...' : 'Add Evacuation Area'}
            </button>
          </div>
        )}

        {loadingList && <p className="adm-empty">Loading...</p>}
        {!loadingList && areas.length === 0 && <p className="adm-empty">No evacuation areas added yet.</p>}
        {areas.map(a => (
          <div key={a.id} className="adm-marker-card">
            <div className="adm-marker-card__header">
              <span className="adm-marker-card__icon">🏠</span>
              <div style={{ flex: 1 }}>
                <p className="adm-marker-card__title">{a.name}</p>
                <p className="adm-marker-card__coords">📍 {a.address || geoAddresses[a.id] || `${a.latitude?.toFixed(5)}, ${a.longitude?.toFixed(5)}`}</p>
              </div>
              {deleteTarget === a.id
                ? <div className="adm-inline-confirm">
                    <button className="adm-inline-confirm__yes" onClick={() => handleDelete(a.id)}>Delete</button>
                    <button className="adm-inline-confirm__no" onClick={() => setDeleteTarget(null)}>Cancel</button>
                  </div>
                : <button className="adm-del-btn" onClick={() => setDeleteTarget(a.id)}>✕</button>
              }
            </div>
            {a.description && <p className="adm-memo-card__preview" style={{ padding: '4px 12px 10px' }}>{a.description}</p>}
          </div>
        ))}
      </div>
    )
  }

  // ── DISASTER PLANS PAGE ────────────────────────────────
  function DisasterPlansPage() {
    const [plans, setPlans] = useState(stats?.disasterPlans ?? [])
    const [showForm, setShowForm] = useState(false)
    const [form, setForm] = useState({ title: '', content: '' })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [deleteTarget, setDeleteTarget] = useState(null)

    async function handleAdd(e) {
      e.preventDefault()
      if (!form.title || !form.content) { setError('Title and content are required.'); return }
      setSaving(true); setError('')
      const res = await addDisasterPlan({ title: form.title, content: form.content })
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      const fresh = await getAdminStats()
      setPlans(fresh.disasterPlans)
      setForm({ title: '', content: '' })
      setShowForm(false)
    }

    async function handleDelete(id) {
      await deleteDisasterPlan(id)
      setPlans(p => p.filter(x => x.id !== id))
      setDeleteTarget(null)
    }

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Disaster Plans</h2>
          <button className="adm-add-btn" onClick={() => { setShowForm(v => !v); setError('') }}>
            {showForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showForm && (
          <form className="adm-form" onSubmit={handleAdd}>
            <p className="adm-form__title">Add Disaster Plan</p>
            <input className="adm-input" placeholder="Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea className="adm-textarea" placeholder="Plan content / instructions..." rows={5} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
            {error && <p className="adm-error">{error}</p>}
            <button className="adm-submit-btn" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Plan'}</button>
          </form>
        )}

        {plans.length === 0
          ? <p className="adm-empty">No disaster plans added yet.</p>
          : plans.map(p => (
            <div key={p.id} className="adm-memo-card">
              <div className="adm-memo-card__header">
                <div>
                  <p className="adm-memo-card__title">{p.title}</p>
                </div>
                {deleteTarget === p.id
                  ? <div className="adm-inline-confirm">
                      <button className="adm-inline-confirm__yes" onClick={() => handleDelete(p.id)}>Delete</button>
                      <button className="adm-inline-confirm__no" onClick={() => setDeleteTarget(null)}>Cancel</button>
                    </div>
                  : <button className="adm-del-btn" onClick={() => setDeleteTarget(p.id)}>✕</button>
                }
              </div>
              {p.content && <p className="adm-memo-card__preview">{p.content.slice(0, 100)}{p.content.length > 100 ? '...' : ''}</p>}
            </div>
          ))
        }
      </div>
    )
  }

  // ── SOS ALERTS PAGE ───────────────────────────────────────
  function SOSAlertCard({ a, onResolve }) {
    const sosMapRef = useRef(null)
    useEffect(() => {
      const t = setTimeout(() => { if (sosMapRef.current) sosMapRef.current.invalidateSize() }, 200)
      return () => clearTimeout(t)
    }, [])
    return (
      <div className="adm-sos-card">
        <div className="adm-sos-card__header">
          <span className="adm-sos-card__pulse">🚨</span>
          <div>
            <p className="adm-sos-card__name">{a.full_name}</p>
            <p className="adm-sos-card__time">
              {new Date(a.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
        <p className="adm-sos-card__address">📍 {a.address}</p>
        {a.latitude && (
          <p className="adm-sos-card__coords">{a.latitude.toFixed(5)}, {a.longitude.toFixed(5)}</p>
        )}
        {a.latitude && a.longitude && (
          <div className="adm-sos-map">
            <MapContainer
              center={[a.latitude, a.longitude]}
              zoom={16}
              maxBounds={FAIRVIEW_BOUNDS}
              zoomControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              touchZoom={false}
              attributionControl={false}
              style={{ height: '100%', width: '100%' }}
              ref={sosMapRef}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Marker position={[a.latitude, a.longitude]} icon={makeAdminMarkerIcon('🚨')} />
            </MapContainer>
          </div>
        )}
        <button className="adm-resolve-btn" onClick={() => onResolve(a.id)}>
          ✓ Mark as Resolved
        </button>
      </div>
    )
  }

  function SOSPage() {
    const [alerts, setAlerts] = useState(stats?.sos ?? [])

    async function handleResolve(id) {
      await resolveSosAlert(id)
      setAlerts(a => a.filter(x => x.id !== id))
    }

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">SOS Alerts</h2>
          <span />
        </div>

        {alerts.length === 0
          ? <div className="adm-empty-sos"><p>✅</p><p>No active SOS alerts.</p></div>
          : alerts.map(a => (
            <SOSAlertCard key={a.id} a={a} onResolve={handleResolve} />
          ))
        }
      </div>
    )
  }

  // ── SOS HISTORY PAGE ──────────────────────────────────────
  function SOSHistoryPage() {
    const [records, setRecords] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      getSosHistory().then(r => {
        if (r.success) setRecords(r.data)
        setLoading(false)
      })
    }, [])

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">SOS History</h2>
          <span />
        </div>
        {loading && <div className="adm-empty-sos"><div className="adm-spinner" /></div>}
        {!loading && records.length === 0 && (
          <div className="adm-empty-sos"><p>📋</p><p>No resolved SOS alerts yet.</p></div>
        )}
        {records.map(a => (
          <div key={a.id} className="adm-sos-card adm-sos-card--resolved">
            <div className="adm-sos-card__header">
              <span style={{ fontSize: 22 }}>✅</span>
              <div>
                <p className="adm-sos-card__name">{a.full_name}</p>
                <p className="adm-sos-card__time">
                  {new Date(a.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
            <p className="adm-sos-card__address">📍 {a.address}</p>
          </div>
        ))}
      </div>
    )
  }

  // ── ALERT MARKERS PAGE ────────────────────────────────────
  function AlertMarkersPage() {
    const [markers, setMarkers] = useState([])
    const [loadingList, setLoadingList] = useState(true)
    const [showPicker, setShowPicker] = useState(false)
    const [pinCoords, setPinCoords] = useState(null)
    const [pinAddress, setPinAddress] = useState('')
    const [geocoding, setGeocoding] = useState(false)
    const [markerType, setMarkerType] = useState('accident')
    const [title, setTitle] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [geoAddresses, setGeoAddresses] = useState({})
    const mapRef = useRef(null)

    useEffect(() => {
      if (showPicker) {
        const t = setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize() }, 150)
        return () => clearTimeout(t)
      }
    }, [showPicker])

    async function handleMapClick(ll) {
      setPinCoords({ lat: ll.lat, lng: ll.lng })
      setPinAddress('')
      setGeocoding(true)
      const addr = await reverseGeocode(ll.lat, ll.lng)
      setPinAddress(addr)
      setGeocoding(false)
    }

    useEffect(() => {
      import('../../db/db').then(({ supabase }) => {
        supabase.from('alert_markers').select('id,title,description,latitude,longitude,address,is_active,created_at')
          .order('created_at', { ascending: false })
          .then(({ data }) => { setMarkers(data ?? []); setLoadingList(false) })
      })
    }, [])

    useEffect(() => {
      const missing = markers.filter(m => !m.address)
      if (!missing.length) return
      missing.forEach(async m => {
        const addr = await reverseGeocode(m.latitude, m.longitude)
        if (addr) setGeoAddresses(prev => ({ ...prev, [m.id]: addr }))
      })
    }, [markers])

    async function handlePost() {
      if (!pinCoords) { setError('Tap on the map to drop a pin first.'); return }
      if (!title.trim()) { setError('Enter a title for this alert.'); return }
      setSaving(true); setError('')
      const res = await postAlertMarker({
        title: title.trim(),
        description: markerType,
        latitude: pinCoords.lat,
        longitude: pinCoords.lng,
        address: pinAddress,
      })
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      import('../../db/db').then(({ supabase }) => {
        supabase.from('alert_markers').select('id,title,description,latitude,longitude,address,is_active,created_at')
          .order('created_at', { ascending: false })
          .then(({ data }) => setMarkers(data ?? []))
      })
      setPinCoords(null); setTitle(''); setMarkerType('accident'); setPinAddress(''); setShowPicker(false)
    }

    async function handleDeactivate(id) {
      await deactivateAlertMarker(id)
      setMarkers(m => m.map(x => x.id === id ? { ...x, is_active: false } : x))
    }

    const selectedType = MARKER_TYPES.find(t => t.id === markerType) ?? MARKER_TYPES[0]

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Alert Markers</h2>
          <button className="adm-add-btn" onClick={() => { setShowPicker(v => !v); setError(''); setPinCoords(null) }}>
            {showPicker ? 'Cancel' : '+ Post'}
          </button>
        </div>

        {showPicker && (
          <div className="adm-map-picker-card">
            <p className="adm-map-picker__hint">📍 Tap anywhere within Fairview to drop a pin</p>

            <div className="adm-map-picker__mapcont">
              <MapContainer
                ref={mapRef}
                center={FAIRVIEW_CENTER}
                zoom={14}
                maxBounds={FAIRVIEW_BOUNDS}
                maxBoundsViscosity={1.0}
                minZoom={13}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler onMapClick={handleMapClick} />
                {pinCoords && (
                  <Marker
                    position={[pinCoords.lat, pinCoords.lng]}
                    icon={makeAdminMarkerIcon(selectedType.emoji)}
                  />
                )}
              </MapContainer>
            </div>

            <p className="adm-map-picker__typelabel">Choose alert type:</p>
            <div className="adm-type-grid">
              {MARKER_TYPES.map(t => (
                <button
                  key={t.id}
                  className={`adm-type-btn${markerType === t.id ? ' adm-type-btn--active' : ''}`}
                  onClick={() => setMarkerType(t.id)}
                >
                  <span className="adm-type-btn__emoji">{t.emoji}</span>
                  <span className="adm-type-btn__label">{t.label}</span>
                </button>
              ))}
            </div>

            <input
              className="adm-input"
              placeholder="Alert Title *"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ marginTop: 2 }}
            />

            {pinCoords && (
              <p className="adm-map-picker__coords">
                {geocoding ? 'Getting street address…' : (pinAddress || `${pinCoords.lat.toFixed(5)}, ${pinCoords.lng.toFixed(5)}`)}
              </p>
            )}

            {error && <p className="adm-error" style={{ marginTop: 4 }}>{error}</p>}

            <button
              className="adm-submit-btn"
              onClick={handlePost}
              disabled={saving || !pinCoords || geocoding}
              style={{ marginTop: 10 }}
            >
              {saving ? 'Posting...' : 'Post Alert Marker'}
            </button>
          </div>
        )}

        {loadingList && <p className="adm-empty">Loading...</p>}
        {!loadingList && markers.length === 0 && <p className="adm-empty">No alert markers posted yet.</p>}
        {markers.map(m => {
          const typeInfo = MARKER_TYPES.find(t => t.id === m.description) ?? { emoji: '⚠️', label: 'Alert' }
          return (
            <div key={m.id} className={`adm-marker-card${!m.is_active ? ' adm-marker-card--inactive' : ''}`}>
              <div className="adm-marker-card__header">
                <span className="adm-marker-card__icon">{m.is_active ? typeInfo.emoji : '✓'}</span>
                <div style={{ flex: 1 }}>
                  <p className="adm-marker-card__title">{m.title}</p>
                  <p className="adm-marker-card__coords">📍 {m.address || geoAddresses[m.id] || `${m.latitude?.toFixed(5)}, ${m.longitude?.toFixed(5)}`}</p>
                </div>
                {m.is_active && (
                  <button className="adm-resolve-btn adm-resolve-btn--sm" onClick={() => handleDeactivate(m.id)}>
                    Deactivate
                  </button>
                )}
                {!m.is_active && <span className="adm-tag adm-tag--gray" style={{ marginLeft: 'auto' }}>Inactive</span>}
              </div>
              <span className="adm-marker-type-badge">{typeInfo.emoji} {typeInfo.label}</span>
            </div>
          )
        })}
      </div>
    )
  }

  // ── USERS (RESIDENTS) PAGE ────────────────────────────────
  function UsersPage() {
    const users = stats?.users ?? []

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Residents ({users.length})</h2>
          <span />
        </div>

        {users.length === 0
          ? <p className="adm-empty">No residents registered yet.</p>
          : users.map(u => (
            <div key={u.id} className="adm-list-card">
              <div className="adm-list-card__avatar">{u.full_name?.charAt(0) ?? 'R'}</div>
              <div className="adm-list-card__info">
                <p className="adm-list-card__name">{u.full_name}</p>
                <p className="adm-list-card__sub">{u.contact_number || 'No contact'}</p>
                <p className="adm-list-card__sub">{u.address || 'No address'}</p>
              </div>
            </div>
          ))
        }
      </div>
    )
  }

  // ── USER MANAGEMENT (TANODS + RESIDENTS) ─────────────────
  function UserManagementPage() {
    const [tab, setTab] = useState('tanods') // 'tanods' | 'residents'

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">User Management</h2>
          <span />
        </div>
        <div className="adm-tabs">
          <button className={`adm-tab${tab === 'tanods' ? ' adm-tab--active' : ''}`} onClick={() => setTab('tanods')}>
            Tanods ({stats?.tanods?.length ?? 0})
          </button>
          <button className={`adm-tab${tab === 'residents' ? ' adm-tab--active' : ''}`} onClick={() => setTab('residents')}>
            Residents ({stats?.users?.length ?? 0})
          </button>
        </div>
        {tab === 'tanods' ? <PersonnelContent /> : <ResidentsContent />}
      </div>
    )

    function PersonnelContent() {
      const [tanods, setTanods] = useState(stats?.tanods ?? [])
      const [showForm, setShowForm] = useState(false)
      const [form, setForm] = useState({ fullName: '', username: '', password: '', contactNumber: '' })
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const [success, setSuccess] = useState('')
      const [deleteTarget, setDeleteTarget] = useState(null)

      async function handleCreate(e) {
        e.preventDefault()
        if (!form.fullName || !form.username || !form.password) { setError('Full name, username and password required.'); return }
        setSaving(true); setError(''); setSuccess('')
        const res = await createTanodAccount(form)
        setSaving(false)
        if (!res.success) { setError(res.error); return }
        const fresh = await getAdminStats()
        setTanods(fresh.tanods)
        setSuccess('Tanod account created!')
        setForm({ fullName: '', username: '', password: '', contactNumber: '' })
        setShowForm(false)
      }

      async function handleDelete(id) {
        await deleteTanodAccount(id)
        setTanods(t => t.filter(x => x.id !== id))
        setDeleteTarget(null)
      }

      return (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="adm-add-btn" onClick={() => { setShowForm(v => !v); setError(''); setSuccess('') }}>
              {showForm ? 'Cancel' : '+ Add Tanod'}
            </button>
          </div>
          {success && <p className="adm-success">{success}</p>}
          {showForm && (
            <form className="adm-form" onSubmit={handleCreate}>
              <p className="adm-form__title">Create Tanod Account</p>
              <input className="adm-input" placeholder="Full Name *" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
              <input className="adm-input" placeholder="Username *" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              <input className="adm-input" type="password" placeholder="Password *" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <input className="adm-input" placeholder="Contact Number" value={form.contactNumber} onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))} />
              {error && <p className="adm-error">{error}</p>}
              <button className="adm-submit-btn" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Account'}</button>
            </form>
          )}
          {tanods.length === 0
            ? <p className="adm-empty">No tanod accounts yet.</p>
            : (() => {
              const todayISO = new Date().toISOString().slice(0, 10)
              const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
              const onDutyToday = new Set(
                (stats?.schedules ?? [])
                  .filter(s => s.time_shift?.startsWith(todayDayName) || s.time_shift?.startsWith(todayISO))
                  .map(s => s.name)
              )
              return tanods.map(t => (
                <div key={t.id} className="adm-list-card">
                  <div className={`adm-list-card__avatar${onDutyToday.has(t.full_name) ? ' adm-list-card__avatar--green' : ''}`}>
                    {t.full_name?.charAt(0) ?? 'T'}
                  </div>
                  <div className="adm-list-card__info">
                    <p className="adm-list-card__name">{t.full_name}</p>
                    <p className="adm-list-card__sub">@{t.username} · {t.contact_number || 'No contact'}</p>
                    <span className={`adm-tag ${onDutyToday.has(t.full_name) ? 'adm-tag--green' : 'adm-tag--gray'}`} style={{ fontSize: '0.68rem', marginTop: 3 }}>
                      {onDutyToday.has(t.full_name) ? 'On Duty Today' : 'Off Duty Today'}
                    </span>
                  </div>
                  {deleteTarget === t.id
                    ? <div className="adm-inline-confirm">
                        <button className="adm-inline-confirm__yes" onClick={() => handleDelete(t.id)}>Delete</button>
                        <button className="adm-inline-confirm__no" onClick={() => setDeleteTarget(null)}>Cancel</button>
                      </div>
                    : <button className="adm-del-btn" onClick={() => setDeleteTarget(t.id)}>✕</button>
                  }
                </div>
              ))
            })()
          }
        </>
      )
    }

    function ResidentsContent() {
      const users = stats?.users ?? []
      return (
        <>
          {users.length === 0
            ? <p className="adm-empty">No residents registered yet.</p>
            : users.map(u => (
              <div key={u.id} className="adm-list-card">
                <div className="adm-list-card__avatar">{u.full_name?.charAt(0) ?? 'R'}</div>
                <div className="adm-list-card__info">
                  <p className="adm-list-card__name">{u.full_name}</p>
                  <p className="adm-list-card__sub">{u.contact_number || 'No contact'}</p>
                  <p className="adm-list-card__sub">{u.address || 'No address'}</p>
                </div>
              </div>
            ))
          }
        </>
      )
    }
  }

  // ── PROFILE PAGE ──────────────────────────────────────────
  function ProfilePage() {
    const [form, setForm] = useState({
      address: user?.address ?? '',
      contactNumber: user?.contact_number ?? '',
      email: user?.email ?? '',
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    async function handleUpdate(e) {
      e.preventDefault()
      setSaving(true); setError(''); setSuccess('')
      const res = await updateUserProfile({ userId: user.id, address: form.address, contactNumber: form.contactNumber, email: form.email })
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      setSuccess('Profile updated!')
      onUserUpdate?.(res.user)
    }

    return (
      <div className="adm-content">
        <div className="adm-profile-hero">
          <div className="adm-profile-avatar">{user?.full_name?.charAt(0) ?? 'A'}</div>
          <p className="adm-profile-name">{user?.full_name}</p>
          <span className="adm-tag adm-tag--green" style={{ fontSize: '0.72rem' }}>ADMIN</span>
        </div>
        <form className="adm-form" onSubmit={handleUpdate}>
          <label className="adm-field-label">Address</label>
          <input className="adm-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          <label className="adm-field-label">Contact Number</label>
          <input className="adm-input" value={form.contactNumber} onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))} />
          <label className="adm-field-label">Email</label>
          <input className="adm-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          {error && <p className="adm-error">{error}</p>}
          {success && <p className="adm-success">{success}</p>}
          <button className="adm-submit-btn" type="submit" disabled={saving}>{saving ? 'Updating...' : 'Update Profile'}</button>
        </form>
        <button className="adm-logout-btn" onClick={onLogout}>Logout</button>
      </div>
    )
  }

  // ── RENDER ────────────────────────────────────────────────
  const homePages = ['home', 'schedules', 'memorandums', 'feedback', 'sos', 'alerts']

  return (
    <div className="adm-shell">
      {/* Top bar */}
      <div className="adm-topbar">
        <span className="adm-topbar__title">SENTRYSEC</span>
        {stats?.sos?.length > 0 && (
          <button className="adm-topbar__sos" onClick={() => setPage('sos')}>
            🚨 <span className="adm-topbar__sos-count">{stats.sos.length}</span>
          </button>
        )}
      </div>

      {/* Page */}
      <div className="adm-body">
        {page === 'home'        && <HomePage />}
        {page === 'personnel'   && <PersonnelPage />}
        {page === 'schedules'   && <SchedulesAdminPage />}
        {page === 'memorandums' && <MemorandumsAdminPage />}
        {page === 'feedback'    && <FeedbackAdminPage />}
        {page === 'sos'         && <SOSPage />}
        {page === 'sos-history'  && <SOSHistoryPage />}
        {page === 'alerts'      && <AlertMarkersPage />}
        {page === 'users'       && <UsersPage />}
        {page === 'mgmt'        && <UserManagementPage />}
        {page === 'emergency-contacts' && <EmergencyContactsPage />}
        {page === 'evacuation-areas'   && <EvacuationAreasPage />}
        {page === 'disaster-plans'     && <DisasterPlansPage />}
        {page === 'profile'     && <ProfilePage />}
      </div>

      {/* Bottom nav: User Management | Home | Profile */}
      <div className="adm-bottomnav">
        <button
          className={`adm-navbtn${page === 'mgmt' ? ' adm-navbtn--active' : ''}`}
          onClick={() => setPage('mgmt')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <span>Users</span>
        </button>
        <button
          className={`adm-navbtn${homePages.includes(page) ? ' adm-navbtn--active' : ''}`}
          onClick={goHome}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Home</span>
        </button>
        <button
          className={`adm-navbtn${page === 'profile' ? ' adm-navbtn--active' : ''}`}
          onClick={() => setPage('profile')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          <span>Profile</span>
        </button>
      </div>
    </div>
  )
}
