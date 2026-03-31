import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  getAdminStats, createTanodAccount, deleteTanodAccount, updateTanodAccount,
  postMemorandum, deleteMemorandum, updateMemorandum,
  resolveSosAlert, getSosHistory,
  addTanodSchedule, updateScheduleStatus, deleteScheduleEntry, updateScheduleEntry,
  postAlertMarker, deactivateAlertMarker, updateAlertMarker, deleteAlertMarker,
  updateUserProfile,
  addEmergencyContact, deleteEmergencyContact, updateEmergencyContact,
  addEvacuationArea, deleteEvacuationArea, updateEvacuationArea,
  addDisasterPlan, deleteDisasterPlan, updateDisasterPlan,
  getActivityLog,
  setResidentActive,
  updateProfilePhoto,
  getActiveSosAlerts,
} from '../../db/auth'
import { showNotif, showSosNotif, startSiren, stopSiren } from '../../db/localNotif'
import './AdminDashboard.css'

const FAIRVIEW_CENTER = [14.7380, 121.0584]
const FAIRVIEW_BOUNDS = [[14.680, 120.990], [14.800, 121.110]]

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

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

const ADMIN_SEARCH_PAGES = [
  { label: 'Home',               dest: 'home' },
  { label: 'Personnel / Accounts', dest: 'personnel' },
  { label: 'Tanod Schedules',    dest: 'schedules' },
  { label: 'Memorandums',        dest: 'memorandums' },
  { label: 'Feedback',           dest: 'feedback' },
  { label: 'Active SOS Alerts',  dest: 'sos' },
  { label: 'SOS History',        dest: 'sos-history' },
  { label: 'Alert Markers',      dest: 'alerts' },
  { label: 'Residents',          dest: 'users' },
  { label: 'User Management',    dest: 'mgmt' },
  { label: 'Emergency Contacts', dest: 'emergency-contacts' },
  { label: 'Evacuation Areas',   dest: 'evacuation-areas' },
  { label: 'Disaster Plans',     dest: 'disaster-plans' },
  { label: 'Profile',            dest: 'profile' },
]

export default function AdminDashboard({ user, onLogout, onUserUpdate }) {
  const [page, setPage] = useState('home')
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  useEffect(() => { loadStats() }, [])

  // Stop siren when admin opens the SOS page
  useEffect(() => {
    if (page === 'sos') stopSiren()
  }, [page])

  // Poll SOS alerts every 30s — siren + OS notification for new ones
  useEffect(() => {
    const notifiedIds = { current: null }
    async function pollSos() {
      const res = await getActiveSosAlerts()
      const list = res.success ? res.data : []
      setStats(prev => prev ? { ...prev, sos: list } : prev)
      if (notifiedIds.current === null) {
        notifiedIds.current = new Set(list.map(x => x.id))
      } else {
        list.forEach(x => {
          if (!notifiedIds.current.has(x.id)) {
            showSosNotif({ title: '🆘 SOS Alert!', body: `${x.full_name ?? 'Resident'} — ${x.address ?? ''}` })
            startSiren()
            notifiedIds.current.add(x.id)
          }
        })
      }
    }
    pollSos()
    const timer = setInterval(pollSos, 30000)
    return () => { clearInterval(timer); stopSiren() }
  }, [])

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
    const activeMarkers = (stats.markers ?? []).filter(m => m.is_active).length
    const resolvedMarkers = (stats.markers ?? []).filter(m => !m.is_active).length
    const feedbackCount = stats.feedback.length
    const emergencyContactsCount = (stats.emergencyContacts ?? []).length
    const evacuationAreasCount = (stats.evacuationAreas ?? []).length
    const disasterPlansCount = (stats.disasterPlans ?? []).length

    // ── Card carousel state
    const [cardPage, setCardPage] = useState(0)
    const [nextCardPage, setNextCardPage] = useState(null)
    const [animDir, setAnimDir] = useState(null)
    const touchStartX = useRef(null)
    const touchStartY = useRef(null)
    const stageRef = useRef(null)
    const CARDS_PER_PAGE = 4
    const isAnimating = nextCardPage !== null

    const allCards = [
      // Page 0
      <button key="personnel" className="adm-card" onClick={() => setPage('personnel')}>
        <div className="adm-card__row">
          <span className="adm-card__label">Personnel</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
        </div>
        <p className="adm-card__num">{stats.tanods.length}</p>
        <p className="adm-card__viewall">View All →</p>
      </button>,
      <button key="schedules" className="adm-card" onClick={() => setPage('schedules')}>
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
      </button>,
      <button key="alerts" className="adm-card" onClick={() => setPage('alerts')}>
        <div className="adm-card__row">
          <span className="adm-card__label">Alert Markers</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <circle cx="12" cy="9" r="2.5"/>
          </svg>
        </div>
        <div className="adm-card__num-row">
          <p className="adm-card__num">{activeMarkers}</p>
          <span className="adm-card__num-sub">active now</span>
        </div>
        <p className="adm-card__viewall">Post / Manage →</p>
      </button>,
      <button key="sos-history" className="adm-card" onClick={() => setPage('sos-history')}>
        <div className="adm-card__row">
          <span className="adm-card__label">SOS History</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 14 14"/>
          </svg>
        </div>
        <p className="adm-card__num">{stats.sosHistoryCount ?? 0}</p>
        <p className="adm-card__viewall">View History →</p>
      </button>,
      // Page 1
      <button key="emergency" className="adm-card" onClick={() => setPage('emergency-contacts')}>
        <div className="adm-card__row">
          <span className="adm-card__label">Emergency</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 12 19.79 19.79 0 012 3.18 2 2 0 014 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </div>
        <p className="adm-card__num">{emergencyContactsCount}</p>
        <p className="adm-card__viewall">Manage →</p>
      </button>,
      <button key="evacuation" className="adm-card" onClick={() => setPage('evacuation-areas')}>
        <div className="adm-card__row">
          <span className="adm-card__label">Evacuation</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </div>
        <p className="adm-card__num">{evacuationAreasCount}</p>
        <p className="adm-card__viewall">Manage →</p>
      </button>,
      <button key="residents" className="adm-card" onClick={() => setPage('users')}>
        <div className="adm-card__row">
          <span className="adm-card__label">Residents</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <p className="adm-card__num">{stats.users.length}</p>
        <p className="adm-card__viewall">View All →</p>
      </button>,
      <button key="memorandums" className="adm-card" onClick={() => setPage('memorandums')}>
        <div className="adm-card__row">
          <span className="adm-card__label">Memorandums</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <p className="adm-card__num">{stats.memos.length}</p>
        <p className="adm-card__viewall">View All →</p>
      </button>,
      <button key="feedback" className="adm-card" onClick={() => setPage('feedback')}>
        <div className="adm-card__row">
          <span className="adm-card__label">Feedback</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <p className="adm-card__num">{feedbackCount}</p>
        <p className="adm-card__viewall">View All →</p>
      </button>,
      <button key="disaster" className="adm-card" onClick={() => setPage('disaster-plans')}>
        <div className="adm-card__row">
          <span className="adm-card__label">Disaster Plans</span>
          <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
        </div>
        <p className="adm-card__num">{disasterPlansCount}</p>
        <p className="adm-card__viewall">Manage →</p>
      </button>,
    ]

    const totalCardPages = Math.ceil(allCards.length / CARDS_PER_PAGE)
    const currentCards = allCards.slice(cardPage * CARDS_PER_PAGE, (cardPage + 1) * CARDS_PER_PAGE)
    const nextCards = nextCardPage !== null
      ? allCards.slice(nextCardPage * CARDS_PER_PAGE, (nextCardPage + 1) * CARDS_PER_PAGE)
      : []

    function navigateTo(target) {
      if (isAnimating || target === cardPage) return
      setAnimDir(target > cardPage ? 'forward' : 'back')
      setNextCardPage(target)
    }
    function handleAnimEnd() {
      setCardPage(nextCardPage)
      setNextCardPage(null)
      setAnimDir(null)
    }
    function handleTouchStart(e) {
      if (isAnimating) return
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
    }
    function handleTouchEnd(e) {
      if (touchStartX.current === null || isAnimating) return
      const dx = e.changedTouches[0].clientX - touchStartX.current
      touchStartX.current = null
      touchStartY.current = null
      if (dx < -50 && cardPage < totalCardPages - 1) navigateTo(cardPage + 1)
      if (dx > 50  && cardPage > 0)                  navigateTo(cardPage - 1)
    }
    // Prevent page scroll during horizontal swipe (requires non-passive listener)
    useEffect(() => {
      const el = stageRef.current
      if (!el) return
      function onMove(e) {
        if (touchStartX.current === null) return
        const dx = Math.abs(e.touches[0].clientX - touchStartX.current)
        const dy = Math.abs(e.touches[0].clientY - (touchStartY.current ?? 0))
        if (dx > dy) e.preventDefault()
      }
      el.addEventListener('touchmove', onMove, { passive: false })
      return () => el.removeEventListener('touchmove', onMove)
    }, [])

    // ── Activity feed state
    const [actFeed, setActFeed] = useState([])
    const [actLoading, setActLoading] = useState(true)
    const [actPage, setActPage] = useState(0)
    const [actSearch, setActSearch] = useState('')
    const ACT_PAGE_SIZE = 5
    useEffect(() => { getActivityLog().then(r => { setActFeed(r.data ?? []); setActLoading(false) }) }, [])
    useEffect(() => { setActPage(0) }, [actSearch])
    const actQ = actSearch.trim().toLowerCase()
    const filtered = actQ ? actFeed.filter(a =>
      a.label.toLowerCase().includes(actQ) ||
      (a.sub && a.sub.toLowerCase().includes(actQ)) ||
      a.badge.toLowerCase().includes(actQ)
    ) : actFeed
    const actTotalPages = Math.max(1, Math.ceil(filtered.length / ACT_PAGE_SIZE))
    const actPageFeed   = filtered.slice(actPage * ACT_PAGE_SIZE, (actPage + 1) * ACT_PAGE_SIZE)

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

        {/* Swipeable card carousel */}
        <div className="adm-cards-carousel">
          <div
            ref={stageRef}
            className="adm-carousel-stage"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className={`adm-carousel-slide${isAnimating ? (animDir === 'forward' ? ' adm-flip-out-left' : ' adm-flip-out-right') : ''}`}>
              <div className="adm-cards-grid">{currentCards}</div>
            </div>
            {isAnimating && (
              <div
                className={`adm-carousel-slide adm-carousel-slide--abs ${animDir === 'forward' ? 'adm-flip-in-right' : 'adm-flip-in-left'}`}
                onAnimationEnd={handleAnimEnd}
              >
                <div className="adm-cards-grid">{nextCards}</div>
              </div>
            )}
          </div>
          <div className="adm-carousel-dots">
            {Array.from({ length: totalCardPages }).map((_, i) => (
              <button
                key={i}
                className={`adm-carousel-dot${(isAnimating ? nextCardPage : cardPage) === i ? ' adm-carousel-dot--active' : ''}`}
                onClick={() => navigateTo(i)}
              />
            ))}
          </div>
        </div>

        {/* Recent Activities — identical to Tanod */}
        <div className="adm-act-search-row">
          <p className="adm-act-section-label">RECENT ACTIVITIES</p>
          <div className="adm-act-search">
            <span className="adm-act-search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search activities…"
              value={actSearch}
              onChange={e => setActSearch(e.target.value)}
            />
            {actSearch && (
              <button className="adm-act-search-clear" onClick={() => setActSearch('')}>✕</button>
            )}
          </div>
        </div>
        {actLoading && (
          <div className="adm-activity-row" style={{ justifyContent: 'center', color: '#888', fontSize: '0.82rem' }}>
            <div className="adm-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Loading...
          </div>
        )}
        {!actLoading && actFeed.length === 0 && (
          <div className="adm-empty-act">No activities yet.</div>
        )}
        {!actLoading && actFeed.length > 0 && filtered.length === 0 && (
          <div className="adm-empty-act">No activities match your search.</div>
        )}
        {!actLoading && actPageFeed.map(a => (
          <button key={a.id} className="adm-activity-row" onClick={() => setPage(a.dest)}>
            <div className="adm-activity-icon">{a.icon}</div>
            <div className="adm-activity-body">
              <p className="adm-activity-label">{a.label}</p>
              {a.sub
                ? <p className="adm-activity-sub">{a.sub} · {timeAgo(a.created_at)}</p>
                : <p className="adm-activity-sub">{timeAgo(a.created_at)}</p>
              }
            </div>
            <span className={`adm-act-badge adm-act-badge--${a.badge_type}`}>{a.badge}</span>
          </button>
        ))}
        {!actLoading && actTotalPages > 1 && (
          <div className="adm-act-pagination">
            <button
              className="adm-act-pgbtn"
              disabled={actPage === 0}
              onClick={() => setActPage(p => p - 1)}
            >‹‹ Prev</button>
            <span className="adm-act-pginfo">{actPage + 1} / {actTotalPages}</span>
            <button
              className="adm-act-pgbtn"
              disabled={actPage >= actTotalPages - 1}
              onClick={() => setActPage(p => p + 1)}
            >Next ››</button>
          </div>
        )}
      </div>
    )
  }

  // ── PERSONNEL PAGE ────────────────────────────────────────
  function PersonnelPage() {
    const tanods = stats?.tanods ?? []

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Personnel</h2>
        </div>

        {tanods.length === 0
          ? <p className="adm-empty">No tanod accounts yet.</p>
          : (() => {
            const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
            const todayISO = new Date().toISOString().slice(0, 10)
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
    const [editGroupTarget, setEditGroupTarget] = useState(null)
    const [editGroupDays, setEditGroupDays] = useState([])
    const [editGroupDayInput, setEditGroupDayInput] = useState('')
    const [editGroupStart, setEditGroupStart] = useState('08:00')
    const [editGroupEnd, setEditGroupEnd] = useState('16:00')

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

    function handleGroupEditOpen(name, entries) {
      setEditGroupTarget({ name, entries })
      setEditGroupDays(entries.map(e => {
        const m = e.time_shift?.match(/^([A-Za-z]+) (\d{2}:\d{2})–(\d{2}:\d{2})$/)
        return m ? { date: m[1], start: m[2], end: m[3] } : null
      }).filter(Boolean).sort((a, b) => DAY_ORDER.indexOf(a.date) - DAY_ORDER.indexOf(b.date)))
      setEditGroupDayInput('')
      setEditGroupStart('08:00')
      setEditGroupEnd('16:00')
      setError(''); setSuccess('')
    }

    function addEditGroupDay() {
      if (!editGroupDayInput) { setError('Select a day first.'); return }
      if (editGroupStart >= editGroupEnd) { setError('End time must be after start time.'); return }
      setEditGroupDays(days => {
        const filtered = days.filter(x => x.date !== editGroupDayInput)
        return [...filtered, { date: editGroupDayInput, start: editGroupStart, end: editGroupEnd }]
          .sort((a, b) => DAY_ORDER.indexOf(a.date) - DAY_ORDER.indexOf(b.date))
      })
      setEditGroupDayInput('')
      setError('')
    }

    function removeEditGroupDay(dayName) {
      setEditGroupDays(days => days.filter(x => x.date !== dayName))
    }

    async function handleGroupUpdate() {
      if (!editGroupTarget) return
      if (editGroupDays.length === 0) { setError('Add at least one day.'); return }
      setSaving(true); setError(''); setSuccess('')
      for (const e of editGroupTarget.entries) {
        await deleteScheduleEntry(e.id)
      }
      const tanodData = tanods.find(t => t.full_name === editGroupTarget.name)
      const contactNum = tanodData?.contact_number ?? ''
      const newEntries = editGroupDays.map(day => ({ name: editGroupTarget.name, timeShift: `${day.date} ${day.start}–${day.end}`, contactNumber: contactNum }))
      const res = await addTanodSchedule(newEntries, 'updated')
      setSaving(false)
      if (!res.success) { setError(res.error || 'Failed to update schedule.'); return }
      const fresh = await getAdminStats()
      setSchedules(fresh.schedules)
      setSuccess('Schedule updated!')
      setEditGroupTarget(null)
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
                <div
                  className={`adm-list-card adm-list-card--clickable${isExpanded ? ' adm-list-card--expanded' : ''}`}
                  style={{ cursor: 'pointer' }}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button type="button" className="adm-edit-btn" onClick={() => handleGroupEditOpen(name, entries)}>✏️</button>
                    <svg
                      className="adm-sched-group__chevron"
                      style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </div>

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
                          <button className="adm-del-btn" onClick={() => handleDelete(s.id)}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        }

        {/* Group schedule edit popup */}
        {editGroupTarget && (
          <div className="adm-popup-overlay" onClick={() => { setEditGroupTarget(null); setError('') }}>
            <div className="adm-popup-sheet" onClick={e => e.stopPropagation()}>
              <div className="adm-popup-sheet__handle" />
              <p className="adm-popup-sheet__title">Edit: {editGroupTarget.name}</p>
              <div className="adm-popup-sheet__list" style={{ padding: '12px 16px 4px' }}>
                {/* Current day chips */}
                {editGroupDays.length > 0 && (
                  <div className="adm-day-chips" style={{ marginBottom: 8 }}>
                    {editGroupDays.map(d => (
                      <span key={d.date} className="adm-day-chip">
                        {formatDayChipLabel(d)}
                        <button type="button" className="adm-day-chip__remove" onClick={() => removeEditGroupDay(d.date)}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                {editGroupDays.length === 0 && <p className="adm-empty" style={{ padding: '4px 0 8px', fontSize:'0.82rem' }}>No days — add below</p>}
                <label className="adm-field-label">Add / Replace Day</label>
                <div className="adm-day-selector">
                  {DAY_ORDER.map(d => (
                    <button key={d} type="button"
                      className={`adm-day-selector__btn${editGroupDayInput === d ? ' adm-day-selector__btn--active' : ''}${editGroupDays.some(s => s.date === d) ? ' adm-day-selector__btn--done' : ''}`}
                      onClick={() => setEditGroupDayInput(d)}
                    >{d.slice(0, 3)}</button>
                  ))}
                </div>
                <div className="adm-time-row" style={{ marginTop: 8 }}>
                  <div className="adm-time-group">
                    <span className="adm-time-label">Start</span>
                    <input className="adm-input" type="time" value={editGroupStart} onChange={e => setEditGroupStart(e.target.value)} />
                  </div>
                  <span className="adm-time-sep">–</span>
                  <div className="adm-time-group">
                    <span className="adm-time-label">End</span>
                    <input className="adm-input" type="time" value={editGroupEnd} onChange={e => setEditGroupEnd(e.target.value)} />
                  </div>
                </div>
                <button type="button" className="adm-add-day-btn adm-add-day-btn--full" onClick={addEditGroupDay}>+ Add Day</button>
                {error && <p className="adm-error">{error}</p>}
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '4px 16px 16px' }}>
                <button className="adm-submit-btn" style={{ flex: 1 }} onClick={handleGroupUpdate} disabled={saving || editGroupDays.length === 0}>{saving ? 'Saving...' : 'Save Changes'}</button>
                <button className="adm-submit-btn" style={{ flex: 1, background: '#e5e7eb', color: '#374151', boxShadow: 'none' }} onClick={() => { setEditGroupTarget(null); setError('') }}>Cancel</button>
              </div>
            </div>
          </div>
        )}
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
    const [editTarget, setEditTarget] = useState(null)
    const [editForm, setEditForm] = useState({ title: '', content: '' })

    function handleEditOpen(m) {
      setEditTarget(m.id)
      setEditForm({ title: m.title, content: m.content })
      setError('')
    }

    async function handleUpdate() {
      if (!editForm.title || !editForm.content) { setError('Title and content are required.'); return }
      setSaving(true); setError('')
      const res = await updateMemorandum({ id: editTarget, title: editForm.title, content: editForm.content })
      setSaving(false)
      if (!res.success) { setError(res.error || 'Update failed.'); return }
      setMemos(m => m.map(x => x.id === editTarget ? { ...x, title: editForm.title, content: editForm.content } : x))
      setEditTarget(null)
    }

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

        {editTarget && (
          <div className="adm-popup-overlay" onClick={() => { setEditTarget(null); setError('') }}>
            <div className="adm-popup-sheet" onClick={ev => ev.stopPropagation()}>
              <div className="adm-popup-sheet__handle" />
              <p className="adm-popup-sheet__title">Edit Memorandum</p>
              <div className="adm-popup-sheet__list" style={{ padding: '12px 16px 4px' }}>
                <input className="adm-input" placeholder="Title *" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                <textarea className="adm-textarea" placeholder="Content..." rows={5} value={editForm.content} onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))} />
                {error && <p className="adm-error">{error}</p>}
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '4px 16px 16px' }}>
                <button className="adm-submit-btn" style={{ flex: 1 }} onClick={handleUpdate} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                <button className="adm-submit-btn" style={{ flex: 1, background: '#e5e7eb', color: '#374151', boxShadow: 'none' }} onClick={() => { setEditTarget(null); setError('') }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

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
                  : <div className="adm-btn-group">
                      <button className="adm-edit-btn" onClick={() => handleEditOpen(m)}>✏️</button>
                      <button className="adm-del-btn" onClick={() => setDeleteTarget(m.id)}>✕</button>
                    </div>
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
    const [editTarget, setEditTarget] = useState(null)
    const [editForm, setEditForm] = useState({ name: '', role: '', contactNumber: '' })

    function handleEditOpen(c) {
      setEditTarget(c.id)
      setEditForm({ name: c.name, role: c.role || '', contactNumber: c.contact_number })
      setError('')
    }

    async function handleUpdate() {
      if (!editForm.name || !editForm.contactNumber) { setError('Name and contact number are required.'); return }
      setSaving(true); setError('')
      const res = await updateEmergencyContact({ id: editTarget, name: editForm.name, role: editForm.role, contactNumber: editForm.contactNumber })
      setSaving(false)
      if (!res.success) { setError(res.error || 'Update failed.'); return }
      setContacts(c => c.map(x => x.id === editTarget ? { ...x, name: editForm.name, role: editForm.role, contact_number: editForm.contactNumber } : x))
      setEditTarget(null)
    }

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

        {editTarget && (
          <div className="adm-popup-overlay" onClick={() => { setEditTarget(null); setError('') }}>
            <div className="adm-popup-sheet" onClick={ev => ev.stopPropagation()}>
              <div className="adm-popup-sheet__handle" />
              <p className="adm-popup-sheet__title">Edit Contact</p>
              <div className="adm-popup-sheet__list" style={{ padding: '12px 16px 4px' }}>
                <input className="adm-input" placeholder="Name *" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                <input className="adm-input" placeholder="Role / Organization" value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))} />
                <input className="adm-input" placeholder="Contact Number *" value={editForm.contactNumber} onChange={e => setEditForm(f => ({ ...f, contactNumber: e.target.value }))} />
                {error && <p className="adm-error">{error}</p>}
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '4px 16px 16px' }}>
                <button className="adm-submit-btn" style={{ flex: 1 }} onClick={handleUpdate} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                <button className="adm-submit-btn" style={{ flex: 1, background: '#e5e7eb', color: '#374151', boxShadow: 'none' }} onClick={() => { setEditTarget(null); setError('') }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

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
                : <div className="adm-btn-group">
                    <button className="adm-edit-btn" onClick={() => handleEditOpen(c)}>✏️</button>
                    <button className="adm-del-btn" onClick={() => setDeleteTarget(c.id)}>✕</button>
                  </div>
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
    const editMapRef = useRef(null)
    const [editTarget, setEditTarget] = useState(null)
    const [editName, setEditName] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [editPinCoords, setEditPinCoords] = useState(null)
    const [editPinAddress, setEditPinAddress] = useState('')
    const [editGeocoding, setEditGeocoding] = useState(false)

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

    useEffect(() => {
      if (editTarget) {
        const t = setTimeout(() => { if (editMapRef.current) editMapRef.current.invalidateSize() }, 150)
        return () => clearTimeout(t)
      }
    }, [editTarget])

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

    function handleEditOpen(a) {
      setEditTarget(a)
      setEditName(a.name)
      setEditDesc(a.description || '')
      setEditPinCoords({ lat: a.latitude, lng: a.longitude })
      setEditPinAddress(a.address || '')
      setEditGeocoding(false)
      setError('')
      setShowPicker(false)
    }

    async function handleEditMapClick(ll) {
      setEditPinCoords({ lat: ll.lat, lng: ll.lng })
      setEditPinAddress('')
      setEditGeocoding(true)
      const addr = await reverseGeocode(ll.lat, ll.lng)
      setEditPinAddress(addr)
      setEditGeocoding(false)
    }

    async function handleUpdate() {
      if (!editName.trim()) { setError('Area name is required.'); return }
      if (!editPinCoords) { setError('Pin location required.'); return }
      setSaving(true); setError('')
      const res = await updateEvacuationArea({
        id: editTarget.id,
        name: editName.trim(),
        description: editDesc.trim(),
        latitude: editPinCoords.lat,
        longitude: editPinCoords.lng,
        address: editPinAddress,
      })
      setSaving(false)
      if (!res.success) { setError(res.error || 'Update failed.'); return }
      setAreas(ar => ar.map(x => x.id === editTarget.id
        ? { ...x, name: editName.trim(), description: editDesc.trim(), latitude: editPinCoords.lat, longitude: editPinCoords.lng, address: editPinAddress }
        : x))
      setEditTarget(null)
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

        {editTarget && (
          <div className="adm-map-picker-card">
            <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 6 }}>Edit: {editTarget.name}</p>
            <input
              className="adm-input"
              placeholder="Area Name *"
              value={editName}
              onChange={e => setEditName(e.target.value)}
            />
            <textarea
              className="adm-textarea"
              placeholder="Notes / Description (optional)"
              rows={2}
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
            />
            <p className="adm-map-picker__hint" style={{ marginTop: 8 }}>📍 Tap to move pin</p>
            <div className="adm-map-picker__map">
              <MapContainer
                key={`edit-evac-${editTarget.id}`}
                center={[editPinCoords?.lat ?? FAIRVIEW_CENTER[0], editPinCoords?.lng ?? FAIRVIEW_CENTER[1]]}
                zoom={16}
                ref={editMapRef}
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
                <MapClickHandler onMapClick={handleEditMapClick} />
                {editPinCoords && (
                  <Marker
                    position={[editPinCoords.lat, editPinCoords.lng]}
                    icon={makeAdminMarkerIcon('🏠')}
                  />
                )}
              </MapContainer>
            </div>
            {editPinCoords && (
              <p className="adm-map-picker__coords">
                {editGeocoding ? 'Getting address…' : (editPinAddress || `${editPinCoords.lat.toFixed(5)}, ${editPinCoords.lng.toFixed(5)}`)}
              </p>
            )}
            {error && <p className="adm-error" style={{ marginTop: 4 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="adm-submit-btn" style={{ flex: 1 }} onClick={handleUpdate} disabled={saving || editGeocoding}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="adm-submit-btn" style={{ flex: 0, background: '#888', minWidth: 72 }} onClick={() => { setEditTarget(null); setError('') }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {!editTarget && showPicker && (
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
                : <div className="adm-btn-group">
                    <button className="adm-edit-btn" onClick={() => handleEditOpen(a)}>✏️</button>
                    <button className="adm-del-btn" onClick={() => setDeleteTarget(a.id)}>✕</button>
                  </div>
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
    const [editTarget, setEditTarget] = useState(null)
    const [editForm, setEditForm] = useState({ title: '', content: '' })

    function handleEditOpen(p) {
      setEditTarget(p.id)
      setEditForm({ title: p.title, content: p.content })
      setError('')
    }

    async function handleUpdate() {
      if (!editForm.title || !editForm.content) { setError('Title and content are required.'); return }
      setSaving(true); setError('')
      const res = await updateDisasterPlan({ id: editTarget, title: editForm.title, content: editForm.content })
      setSaving(false)
      if (!res.success) { setError(res.error || 'Update failed.'); return }
      setPlans(p => p.map(x => x.id === editTarget ? { ...x, title: editForm.title, content: editForm.content } : x))
      setEditTarget(null)
    }

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

        {editTarget && (
          <div className="adm-popup-overlay" onClick={() => { setEditTarget(null); setError('') }}>
            <div className="adm-popup-sheet" onClick={ev => ev.stopPropagation()}>
              <div className="adm-popup-sheet__handle" />
              <p className="adm-popup-sheet__title">Edit Disaster Plan</p>
              <div className="adm-popup-sheet__list" style={{ padding: '12px 16px 4px' }}>
                <input className="adm-input" placeholder="Title *" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                <textarea className="adm-textarea" placeholder="Plan content / instructions..." rows={5} value={editForm.content} onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))} />
                {error && <p className="adm-error">{error}</p>}
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '4px 16px 16px' }}>
                <button className="adm-submit-btn" style={{ flex: 1 }} onClick={handleUpdate} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                <button className="adm-submit-btn" style={{ flex: 1, background: '#e5e7eb', color: '#374151', boxShadow: 'none' }} onClick={() => { setEditTarget(null); setError('') }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

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
                  : <div className="adm-btn-group">
                      <button className="adm-edit-btn" onClick={() => handleEditOpen(p)}>✏️</button>
                      <button className="adm-del-btn" onClick={() => setDeleteTarget(p.id)}>✕</button>
                    </div>
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
    const [deleteTarget, setDeleteTarget] = useState(null)
    const [deactivateTarget, setDeactivateTarget] = useState(null)
    const [editTarget, setEditTarget] = useState(null)
    const [editTitle, setEditTitle] = useState('')
    const [editMarkerType, setEditMarkerType] = useState('accident')
    const [editPinCoords, setEditPinCoords] = useState(null)
    const [editPinAddress, setEditPinAddress] = useState('')
    const [editGeocoding, setEditGeocoding] = useState(false)

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

    function handleEditOpen(m) {
      setEditTarget(m)
      setEditTitle(m.title)
      setEditMarkerType(m.description || 'accident')
      setEditPinCoords({ lat: m.latitude, lng: m.longitude })
      setEditPinAddress(m.address || geoAddresses[m.id] || '')
      setShowPicker(false); setError('')
    }

    async function handleEditMapClick(ll) {
      setEditPinCoords({ lat: ll.lat, lng: ll.lng })
      setEditPinAddress(''); setEditGeocoding(true)
      const addr = await reverseGeocode(ll.lat, ll.lng)
      setEditPinAddress(addr); setEditGeocoding(false)
    }

    async function handleUpdate() {
      if (!editTitle.trim()) { setError('Enter a title.'); return }
      setSaving(true); setError('')
      const res = await updateAlertMarker({ id: editTarget.id, title: editTitle.trim(), description: editMarkerType, latitude: editPinCoords.lat, longitude: editPinCoords.lng, address: editPinAddress })
      setSaving(false)
      if (!res.success) { setError(res.error || 'Update failed.'); return }
      setMarkers(m => m.map(x => x.id === editTarget.id ? { ...x, title: editTitle.trim(), description: editMarkerType, latitude: editPinCoords.lat, longitude: editPinCoords.lng, address: editPinAddress } : x))
      setEditTarget(null)
    }

    async function handleDeleteMarker(id) {
      await deleteAlertMarker(id)
      setMarkers(m => m.filter(x => x.id !== id))
      setDeleteTarget(null)
    }

    const editSelectedType = editTarget ? (MARKER_TYPES.find(t => t.id === editMarkerType) ?? MARKER_TYPES[0]) : MARKER_TYPES[0]

    return (
      <div className="adm-content">
        <div className="adm-page-header">
          <button className="adm-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="adm-page-title">Alert Markers</h2>
          <button className="adm-add-btn" onClick={() => { setShowPicker(v => !v); setEditTarget(null); setError(''); setPinCoords(null) }}>
            {showPicker ? 'Cancel' : '+ Post'}
          </button>
        </div>

        {/* Edit form with map */}
        {editTarget && editPinCoords && (
          <div className="adm-map-picker-card">
            <p className="adm-form__title" style={{ marginBottom: 8 }}>Edit Alert Marker</p>
            <p className="adm-map-picker__hint">📍 Tap on the map to move the pin to a new location</p>
            <div className="adm-map-picker__mapcont">
              <MapContainer
                ref={mapRef}
                key={`edit-${editTarget.id}`}
                center={[editPinCoords.lat, editPinCoords.lng]}
                zoom={15}
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
                <MapClickHandler onMapClick={handleEditMapClick} />
                <Marker position={[editPinCoords.lat, editPinCoords.lng]} icon={makeAdminMarkerIcon(editSelectedType.emoji)} />
              </MapContainer>
            </div>
            <p className="adm-map-picker__typelabel">Alert type:</p>
            <div className="adm-type-grid">
              {MARKER_TYPES.map(t => (
                <button key={t.id} className={`adm-type-btn${editMarkerType === t.id ? ' adm-type-btn--active' : ''}`} onClick={() => setEditMarkerType(t.id)}>
                  <span className="adm-type-btn__emoji">{t.emoji}</span>
                  <span className="adm-type-btn__label">{t.label}</span>
                </button>
              ))}
            </div>
            <input className="adm-input" placeholder="Alert Title *" value={editTitle} onChange={e => setEditTitle(e.target.value)} style={{ marginTop: 2 }} />
            {editPinCoords && (
              <p className="adm-map-picker__coords">
                {editGeocoding ? 'Getting address…' : (editPinAddress || `${editPinCoords.lat.toFixed(5)}, ${editPinCoords.lng.toFixed(5)}`)}
              </p>
            )}
            {error && <p className="adm-error" style={{ marginTop: 4 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="adm-submit-btn" style={{ flex: 1 }} onClick={handleUpdate} disabled={saving || editGeocoding}>{saving ? 'Saving...' : 'Update Alert'}</button>
              <button className="adm-popup-sheet__cancel" style={{ flex: 1, margin: 0 }} onClick={() => { setEditTarget(null); setError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {!editTarget && showPicker && (
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
        {!loadingList && markers.some(m => m.is_active) && (
          <p className="adm-markers-section-label">🔴 Active ({markers.filter(m => m.is_active).length})</p>
        )}
        {!loadingList && markers.filter(m => m.is_active).map(m => {
          const typeInfo = MARKER_TYPES.find(t => t.id === m.description) ?? { emoji: '⚠️', label: 'Alert' }
          return (
            <div key={m.id} className="adm-marker-card">
              <div className="adm-marker-card__header">
                <span className="adm-marker-card__icon">{typeInfo.emoji}</span>
                <div style={{ flex: 1 }}>
                  <p className="adm-marker-card__title">{m.title}</p>
                  <p className="adm-marker-card__coords">📍 {m.address || geoAddresses[m.id] || `${m.latitude?.toFixed(5)}, ${m.longitude?.toFixed(5)}`}</p>
                </div>
                <button className="adm-edit-btn" style={{ width: 72, borderRadius: 6, fontSize: '0.72rem', alignSelf: 'flex-start' }} onClick={() => handleEditOpen(m)}>✏️ Edit</button>
              </div>
              <span className="adm-marker-type-badge">{typeInfo.emoji} {typeInfo.label}</span>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                {deactivateTarget === m.id
                  ? <div className="adm-inline-confirm">
                      <button className="adm-inline-confirm__yes" onClick={() => { handleDeactivate(m.id); setDeactivateTarget(null) }}>Confirm</button>
                      <button className="adm-inline-confirm__no" onClick={() => setDeactivateTarget(null)}>Cancel</button>
                    </div>
                  : <button className="adm-resolve-btn adm-resolve-btn--sm" onClick={() => setDeactivateTarget(m.id)}>Deactivate</button>
                }
              </div>
            </div>
          )
        })}
        {!loadingList && markers.some(m => !m.is_active) && (
          <p className="adm-markers-section-label adm-markers-section-label--inactive">✓ Inactive ({markers.filter(m => !m.is_active).length})</p>
        )}
        {!loadingList && markers.filter(m => !m.is_active).map(m => {
          const typeInfo = MARKER_TYPES.find(t => t.id === m.description) ?? { emoji: '⚠️', label: 'Alert' }
          return (
            <div key={m.id} className="adm-marker-card adm-marker-card--inactive">
              <div className="adm-marker-card__header">
                <span className="adm-marker-card__icon">✓</span>
                <div style={{ flex: 1 }}>
                  <p className="adm-marker-card__title">{m.title}</p>
                  <p className="adm-marker-card__coords">📍 {m.address || geoAddresses[m.id] || `${m.latitude?.toFixed(5)}, ${m.longitude?.toFixed(5)}`}</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                </div>
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
      const [editTarget, setEditTarget] = useState(null)
      const [editForm, setEditForm] = useState({ fullName: '', username: '', contactNumber: '', newPassword: '' })

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

      function handleEditOpen(t) {
        setEditTarget(t.id)
        setEditForm({ fullName: t.full_name, username: t.username || '', contactNumber: t.contact_number || '', newPassword: '' })
        setShowForm(false); setError(''); setSuccess('')
      }

      async function handleUpdate() {
        if (!editForm.fullName) { setError('Full name is required.'); return }
        setSaving(true); setError('')
        const res = await updateTanodAccount({ id: editTarget, fullName: editForm.fullName, username: editForm.username || undefined, contactNumber: editForm.contactNumber, password: editForm.newPassword || undefined })
        setSaving(false)
        if (!res.success) { setError(res.error || 'Update failed.'); return }
        setTanods(list => list.map(x => x.id === editTarget ? { ...x, full_name: editForm.fullName, username: editForm.username || x.username, contact_number: editForm.contactNumber } : x))
        setSuccess('Tanod updated!')
        setEditTarget(null)
      }

      return (
        <>
          {/* Edit popup sheet */}
          {editTarget && (
            <div className="adm-popup-overlay" onClick={() => { setEditTarget(null); setError('') }}>
              <div className="adm-popup-sheet" onClick={ev => ev.stopPropagation()}>
                <div className="adm-popup-sheet__handle" />
                <p className="adm-popup-sheet__title">Edit Tanod</p>
                <div className="adm-popup-sheet__list" style={{ padding: '12px 16px 4px' }}>
                  <input className="adm-input" placeholder="Full Name *" value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} />
                  <input className="adm-input" placeholder="Username" value={editForm.username} onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))} />
                  <input className="adm-input" placeholder="Contact Number" value={editForm.contactNumber} onChange={e => setEditForm(f => ({ ...f, contactNumber: e.target.value }))} />
                  <input className="adm-input" type="password" placeholder="New Password (leave blank to keep)" value={editForm.newPassword} onChange={e => setEditForm(f => ({ ...f, newPassword: e.target.value }))} />
                  {error && <p className="adm-error">{error}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8, padding: '4px 16px 16px' }}>
                  <button className="adm-submit-btn" style={{ flex: 1 }} onClick={handleUpdate} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                  <button className="adm-submit-btn" style={{ flex: 1, background: '#e5e7eb', color: '#374151', boxShadow: 'none' }} onClick={() => { setEditTarget(null); setError('') }}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="adm-add-btn" onClick={() => { setShowForm(v => !v); setEditTarget(null); setError(''); setSuccess('') }}>
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
                    : <div className="adm-btn-group">
                        <button className="adm-edit-btn" onClick={() => handleEditOpen(t)}>✏️</button>
                        <button className="adm-del-btn" onClick={() => setDeleteTarget(t.id)}>✕</button>
                      </div>
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
      const [selectedResident, setSelectedResident] = useState(null)
      const [deactivateConfirm, setDeactivateConfirm] = useState(false)
      const [toggling, setToggling] = useState(false)
      const [toggleError, setToggleError] = useState('')
      const [idViewerSrc, setIdViewerSrc] = useState(null)

      async function handleToggleActive(u) {
        const newVal = u.is_active === false ? true : false
        setToggling(true); setToggleError('')
        const res = await setResidentActive({ id: u.id, isActive: newVal })
        setToggling(false)
        if (!res.success) {
          setToggleError(res.error || 'Failed. Make sure the is_active column exists in your users table.')
          return
        }
        setStats(st => st ? { ...st, users: st.users.map(x => x.id === u.id ? { ...x, is_active: newVal } : x) } : st)
        setSelectedResident(prev => prev ? { ...prev, is_active: newVal } : null)
        setDeactivateConfirm(false)
      }

      // ── Fullscreen ID image viewer with pinch-zoom ──
      function ImageViewer({ src, onClose }) {
        const [scale, setScale] = useState(1)
        const [offset, setOffset] = useState({ x: 0, y: 0 })
        const lastDist = useRef(null)
        const lastPos = useRef(null)
        const lastTap = useRef(0)

        function getDist(touches) {
          const dx = touches[0].clientX - touches[1].clientX
          const dy = touches[0].clientY - touches[1].clientY
          return Math.sqrt(dx * dx + dy * dy)
        }
        function onTouchStart(e) {
          if (e.touches.length === 2) {
            lastDist.current = getDist(e.touches)
          } else if (e.touches.length === 1) {
            const now = Date.now()
            if (now - lastTap.current < 300) {
              // double tap: toggle 1x / 2.5x
              if (scale > 1) { setScale(1); setOffset({ x: 0, y: 0 }) } else setScale(2.5)
            }
            lastTap.current = now
            lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
          }
        }
        function onTouchMove(e) {
          e.preventDefault()
          if (e.touches.length === 2) {
            const d = getDist(e.touches)
            if (lastDist.current) setScale(s => Math.min(6, Math.max(1, s * d / lastDist.current)))
            lastDist.current = d
          } else if (e.touches.length === 1 && scale > 1 && lastPos.current) {
            const dx = e.touches[0].clientX - lastPos.current.x
            const dy = e.touches[0].clientY - lastPos.current.y
            setOffset(o => ({ x: o.x + dx, y: o.y + dy }))
            lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
          }
        }
        function onTouchEnd() {
          lastDist.current = null
          setScale(s => { if (s < 1.05) { setOffset({ x: 0, y: 0 }); return 1 } return s })
        }
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.96)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          >
            <img
              src={src} alt="Barangay ID"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: 'center', transition: scale === 1 ? 'transform 0.2s' : 'none', userSelect: 'none', pointerEvents: 'none' }}
              draggable={false}
            />
            <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 38, height: 38, fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            <p style={{ position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', pointerEvents: 'none' }}>Pinch or double-tap to zoom</p>
          </div>
        )
      }

      return (
        <>
          {users.length === 0
            ? <p className="adm-empty">No residents registered yet.</p>
            : users.map(u => {
                const isActive = u.is_active !== false
                return (
                  <div key={u.id} className="adm-list-card" style={{ cursor: 'pointer' }} onClick={() => { setSelectedResident(u); setDeactivateConfirm(false); setToggleError('') }}>
                    <div className={`adm-list-card__avatar${isActive ? '' : ' adm-list-card__avatar--gray'}`}>{u.full_name?.charAt(0) ?? 'R'}</div>
                    <div className="adm-list-card__info">
                      <p className="adm-list-card__name">{u.full_name}</p>
                      <p className="adm-list-card__sub">{u.contact_number || 'No contact'}</p>
                      <p className="adm-list-card__sub">{u.address || 'No address'}</p>
                    </div>
                    <span className={`adm-tag ${isActive ? 'adm-tag--green' : 'adm-tag--gray'}`} style={{ marginLeft: 8, alignSelf: 'center', flexShrink: 0 }}>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                )
              })
          }

          {idViewerSrc && <ImageViewer src={idViewerSrc} onClose={() => setIdViewerSrc(null)} />}

          {selectedResident && (() => {
            const u = selectedResident
            const isActive = u.is_active !== false
            return (
              <div className="adm-popup-overlay" onClick={() => setSelectedResident(null)}>
                <div className="adm-popup-sheet" onClick={e => e.stopPropagation()}>
                  <div className="adm-popup-sheet__handle" />

                  {/* Header */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 16px 12px' }}>
                    <div className="adm-list-card__avatar" style={{ width: 56, height: 56, fontSize: '1.4rem', marginBottom: 8 }}>{u.full_name?.charAt(0) ?? 'R'}</div>
                    <p style={{ fontWeight: 700, fontSize: '1.05rem', margin: 0 }}>{u.full_name}</p>
                    <span className={`adm-tag ${isActive ? 'adm-tag--green' : 'adm-tag--red'}`} style={{ marginTop: 4 }}>
                      {isActive ? '● Active' : '● Inactive'}
                    </span>
                  </div>

                  {/* Info rows */}
                  <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { label: '👤 Username',    value: u.username || '—' },
                      { label: '📧 Email',        value: u.email || '—' },
                      { label: '📞 Contact',      value: u.contact_number || '—' },
                      { label: '🏠 Address',      value: u.address || '—' },
                      { label: '📅 Registered',   value: u.created_at ? new Date(u.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—' },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ display: 'flex', gap: 8, fontSize: '0.85rem' }}>
                        <span style={{ color: '#6b7280', minWidth: 110 }}>{label}</span>
                        <span style={{ fontWeight: 500, wordBreak: 'break-word', flex: 1 }}>{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Barangay ID */}
                  <div style={{ padding: '12px 16px 0' }}>
                    <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 6 }}>🪪 Barangay ID <span style={{ color:'#9ca3af' }}>(tap to zoom)</span></p>
                    {u.barangay_id_image
                      ? <img src={u.barangay_id_image} alt="Barangay ID"
                          onClick={() => setIdViewerSrc(u.barangay_id_image)}
                          style={{ width: '100%', borderRadius: 10, border: '1.5px solid #d1d5db', maxHeight: 200, objectFit: 'contain', background: '#f8fafc', cursor: 'zoom-in' }} />
                      : <p style={{ fontSize: '0.82rem', color: '#9ca3af', fontStyle: 'italic' }}>No ID submitted</p>
                    }
                  </div>

                  {/* Deactivate / Reactivate */}
                  <div style={{ padding: '14px 16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {toggleError && <p style={{ color: '#dc2626', fontSize: '0.78rem', margin: 0 }}>{toggleError}</p>}
                    {isActive ? (
                      deactivateConfirm
                        ? <div className="adm-inline-confirm" style={{ justifyContent: 'flex-end' }}>
                            <span style={{ flex: 1, fontSize: '0.8rem', color: '#6b7280' }}>Deactivate this account?</span>
                            <button className="adm-inline-confirm__yes" disabled={toggling} onClick={() => handleToggleActive(u)}>{toggling ? '…' : 'Confirm'}</button>
                            <button className="adm-inline-confirm__no" onClick={() => setDeactivateConfirm(false)}>Cancel</button>
                          </div>
                        : <button className="adm-resolve-btn" style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 0', borderRadius: 8, fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' }} onClick={() => setDeactivateConfirm(true)}>
                            Deactivate Account
                          </button>
                    ) : (
                      <button className="adm-submit-btn" disabled={toggling} style={{ background: '#166534', color: '#fff' }} onClick={() => handleToggleActive(u)}>
                        {toggling ? 'Reactivating…' : '✓ Reactivate Account'}
                      </button>
                    )}
                    <button className="adm-popup-sheet__cancel" onClick={() => setSelectedResident(null)}>Close</button>
                  </div>
                </div>
              </div>
            )
          })()}
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
    const [photo, setPhoto] = useState(user?.profile_photo ?? null)
    const [photoSaving, setPhotoSaving] = useState(false)
    const [photoError, setPhotoError] = useState('')
    const [deleteConfirm, setDeleteConfirm] = useState(false)
    const fileInputRef = useRef(null)

    async function handleUpdate(e) {
      e.preventDefault()
      setSaving(true); setError(''); setSuccess('')
      const res = await updateUserProfile({ userId: user.id, address: form.address, contactNumber: form.contactNumber, email: form.email })
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      setSuccess('Profile updated!')
      onUserUpdate?.(res.user)
    }

    async function handlePhotoChange(e) {
      const file = e.target.files[0]
      if (!file) return
      setPhotoSaving(true); setPhotoError('')
      const reader = new FileReader()
      reader.onload = async ev => {
        const base64 = ev.target.result
        const res = await updateProfilePhoto({ userId: user.id, photoData: base64 })
        setPhotoSaving(false)
        if (!res.success) { setPhotoError('Failed to upload photo.'); return }
        setPhoto(base64)
        if (onUserUpdate) onUserUpdate({ ...user, profile_photo: base64 })
      }
      reader.onerror = () => { setPhotoSaving(false); setPhotoError('Failed to read file.') }
      reader.readAsDataURL(file)
      e.target.value = ''
    }

    async function handleDeletePhoto() {
      setPhotoSaving(true); setPhotoError(''); setDeleteConfirm(false)
      const res = await updateProfilePhoto({ userId: user.id, photoData: null })
      setPhotoSaving(false)
      if (!res.success) { setPhotoError('Failed to delete photo.'); return }
      setPhoto(null)
      if (onUserUpdate) onUserUpdate({ ...user, profile_photo: null })
    }

    return (
      <div className="adm-content">
        <div className="adm-profile-hero">
          <div className="adm-profile-avatar-wrap" style={{ position: 'relative', display: 'inline-block' }}>
            <div className="adm-profile-avatar" style={{ overflow: 'hidden' }}>
              {photo
                ? <img src={photo} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                : (user?.full_name?.charAt(0) ?? 'A')}
            </div>
            {photo && (
              <button
                type="button"
                className="adm-photo-del-btn"
                onClick={() => setDeleteConfirm(true)}
                title="Remove photo"
              >✕</button>
            )}
            <button
              type="button"
              className="adm-photo-cam-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoSaving}
              title={photo ? 'Change photo' : 'Upload photo'}
            >
              {photoSaving ? '…' : '📷'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
          </div>
          <p className="adm-profile-name">{user?.full_name}</p>
          <span className="adm-tag adm-tag--green" style={{ fontSize: '0.72rem' }}>ADMIN</span>
          {photoError && <p className="adm-error" style={{ marginTop: 4 }}>{photoError}</p>}
        </div>

        {deleteConfirm && (
          <div className="adm-popup-overlay" onClick={() => setDeleteConfirm(false)}>
            <div className="adm-popup-sheet" style={{ padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
              <p style={{ marginBottom: '1rem', fontWeight: 600 }}>Remove profile photo?</p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button className="adm-submit-btn" style={{ flex: 1 }} onClick={handleDeletePhoto}>Remove</button>
                <button className="adm-cancel-btn" style={{ flex: 1 }} onClick={() => setDeleteConfirm(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

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
      {/* Global search overlay */}
      {searchOpen && (
        <div className="gs-overlay" onClick={() => { setSearchOpen(false); setSearchQ('') }}>
          <div className="gs-box" onClick={e => e.stopPropagation()}>
            <div className="gs-input-row">
              <span className="gs-icon">🔍</span>
              <input
                className="gs-input"
                autoFocus
                placeholder="Search pages…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
              />
              <button className="gs-close" onClick={() => { setSearchOpen(false); setSearchQ('') }}>✕</button>
            </div>
            <div className="gs-results">
              {ADMIN_SEARCH_PAGES
                .filter(p => p.label.toLowerCase().includes(searchQ.toLowerCase()))
                .map(p => (
                  <button key={p.dest} className="gs-result-item" onClick={() => { setPage(p.dest); setSearchOpen(false); setSearchQ('') }}>
                    {p.label}
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="adm-topbar">
        <span className="adm-topbar__title">SENTRYSEC</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="adm-topbar__searchbtn" onClick={() => setSearchOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="19" height="19"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          {stats?.sos?.length > 0 && (
            <button className="adm-topbar__sos" onClick={() => setPage('sos')}>
              🚨 <span className="adm-topbar__sos-count">{stats.sos.length}</span>
            </button>
          )}
        </div>
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
