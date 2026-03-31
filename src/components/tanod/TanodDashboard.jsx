import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  getTanodSchedules,
  getMemorandums,
  getEmergencyContacts,
  getEvacuationAreas,
  addEvacuationArea,
  deleteEvacuationArea,
  updateEvacuationArea,
  getDisasterPlans,
  getActiveSosAlerts,
  resolveSosAlert,
  getSosHistory,
  updateUserProfile,
  postAlertMarker,
  deactivateAlertMarker,
  getActivityLog,
  updateProfilePhoto,
} from '../../db/auth'
import { showNotif, showSosNotif, startSiren, stopSiren } from '../../db/localNotif'
import { supabase } from '../../db/db'
import './TanodDashboard.css'
import '../admin/AdminDashboard.css'

function formatShift(ts) {
  const fmt = t => {
    const [h, m] = t.split(':').map(Number)
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }
  const mNew = ts?.match(/^([A-Za-z]+) (\d{2}:\d{2})\u2013(\d{2}:\d{2})$/)
  if (mNew) return `${mNew[1]} · ${fmt(mNew[2])} – ${fmt(mNew[3])}`
  const mOld = ts?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\u2013(\d{2}:\d{2})$/)
  if (mOld) return `${new Date(mOld[1] + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmt(mOld[2])} – ${fmt(mOld[3])}`
  return ts ?? ''
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) +
    ' • ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

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

const TANOD_SEARCH_PAGES = [
  { label: 'Home',             dest: 'home' },
  { label: 'My Schedule',      dest: 'my-schedule' },
  { label: 'Active SOS Alerts',dest: 'sos' },
  { label: 'SOS History',      dest: 'sos-history' },
  { label: 'Info',             dest: 'info' },
  { label: 'Tanod Schedules',  dest: 'schedules' },
  { label: 'Safety Guide',     dest: 'safetyguide' },
  { label: 'Memorandums',      dest: 'memorandums' },
  { label: 'Evacuation Areas', dest: 'evacuation' },
  { label: 'Alert Markers',    dest: 'alerts' },
  { label: 'Profile',          dest: 'profile' },
]

export default function TanodDashboard({ user, onLogout, onUserUpdate }) {
  const [page, setPage] = useState('home')
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const todayISO  = new Date().toISOString().slice(0, 10)

  useEffect(() => { loadStats() }, [])

  // Stop siren when user opens the SOS page
  useEffect(() => {
    if (page === 'sos') stopSiren()
  }, [page])

  // Poll SOS alerts every 30s — siren + OS notification for new ones
  useEffect(() => {
    const notifiedIds = { current: null }
    async function pollSos() {
      const res = await getActiveSosAlerts()
      const list = res.success ? res.data : []
      setStats(prev => prev ? { ...prev, sosList: list } : prev)
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
    setLoading(true)
    const [schedRes, sosRes, memoRes, evacRes, markersRes, histRes] = await Promise.all([
      getTanodSchedules(),
      getActiveSosAlerts(),
      getMemorandums(),
      getEvacuationAreas(),
      supabase.from('alert_markers').select('id,is_active').order('created_at', { ascending: false }),
      getSosHistory(),
    ])
    setStats({
      schedules:      schedRes.success ? schedRes.data : [],
      sosList:        sosRes.success   ? sosRes.data   : [],
      memos:          memoRes.success  ? memoRes.data  : [],
      evacuationAreas:evacRes.success  ? evacRes.data  : [],
      markers:        markersRes.data ?? [],
      sosHistory:     histRes.success  ? histRes.data  : [],
    })
    setLoading(false)
  }

  function goHome() { setPage('home'); loadStats() }

  const mySchedules = (stats?.schedules ?? []).filter(s => s.name === user?.full_name)
  const onDutyToday = mySchedules.some(s =>
    s.time_shift?.startsWith(todayName) || s.time_shift?.startsWith(todayISO)
  )

  // ── HOME ───────────────────────────────────────────────────
  function HomePage() {
    const [actFeed, setActFeed] = useState([])
    const [actLoading, setActLoading] = useState(true)
    const [actPage, setActPage] = useState(0)
    const [actSearch, setActSearch] = useState('')
    const PAGE_SIZE = 5

    useEffect(() => {
      getActivityLog().then(r => {
        setActFeed(r.data ?? [])
        setActLoading(false)
      })
    }, [])

    useEffect(() => { setActPage(0) }, [actSearch])

    if (loading) return (
      <div className="tnod-loading">
        <div className="tnod-spinner" />
        <p>Loading dashboard...</p>
      </div>
    )

    const now = new Date()
    const todayStr = now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const activeSos   = stats?.sosList?.length ?? 0
    const evacCount   = stats?.evacuationAreas?.length ?? 0

    const q = actSearch.trim().toLowerCase()
    // Schedule entries are only shown to the tanod whose name appears in the label
    const myName = user?.full_name ?? ''
    const relevantFeed = actFeed.filter(a =>
      a.dest !== 'schedules' || a.label.toLowerCase().includes(myName.toLowerCase())
    )
    const filtered = q
      ? relevantFeed.filter(a =>
          a.label.toLowerCase().includes(q) ||
          (a.sub && a.sub.toLowerCase().includes(q)) ||
          a.badge.toLowerCase().includes(q)
        )
      : relevantFeed
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const pageFeed   = filtered.slice(actPage * PAGE_SIZE, (actPage + 1) * PAGE_SIZE)

    return (
      <div className="tnod-content">
        <h1 className="adm-home-title">Dashboard</h1>
        <p className="adm-home-sub">Barangay Safety Overview · {todayStr}</p>

        {activeSos > 0 && (
          <button className="adm-banner adm-banner--sos" onClick={() => setPage('sos')}>
            <span className="adm-banner__icon">🚨</span>
            <div className="adm-banner__body">
              <p className="adm-banner__title">{activeSos} Active SOS Alert{activeSos !== 1 ? 's' : ''}</p>
              <p className="adm-banner__sub">{stats.sosList[0].full_name} — {stats.sosList[0].address?.slice(0, 38)}</p>
            </div>
            <span className="adm-banner__btn">View</span>
          </button>
        )}

        <div className="adm-cards-grid">
          {/* My Schedule */}
          <button className="adm-card" onClick={() => setPage('my-schedule')}>
            <div className="adm-card__row">
              <span className="adm-card__label">My Schedule</span>
              <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div className="adm-card__num-row">
              <p className="adm-card__num">{mySchedules.length}</p>
              <div className="adm-card__tags">
                <span className={`adm-tag ${onDutyToday ? 'adm-tag--green' : 'adm-tag--gray'}`}>
                  {onDutyToday ? 'On Duty Today' : 'Off Duty Today'}
                </span>
              </div>
            </div>
            <p className="adm-card__viewall">View →</p>
          </button>

          {/* SOS History */}
          <button className="adm-card" onClick={() => setPage('sos-history')}>
            <div className="adm-card__row">
              <span className="adm-card__label">SOS History</span>
              <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 14 14"/>
              </svg>
            </div>
            <p className="adm-card__num">{stats?.sosHistory?.length ?? 0}</p>
            <p className="adm-card__viewall">View History →</p>
          </button>

          {/* All Schedules */}
          <button className="adm-card" onClick={() => setPage('schedules')}>
            <div className="adm-card__row">
              <span className="adm-card__label">Tanod Sched</span>
              <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
              </svg>
            </div>
            <div className="adm-card__num-row">
              <p className="adm-card__num">{new Set((stats?.schedules ?? []).map(s => s.name)).size}</p>
              <div className="adm-card__tags">
                <span className="adm-tag adm-tag--green">
                  {(stats?.schedules ?? []).filter(s => s.time_shift?.startsWith(todayName) || s.time_shift?.startsWith(todayISO)).length} Today
                </span>
              </div>
            </div>
            <p className="adm-card__viewall">View All →</p>
          </button>

          {/* Evacuation Centers */}
          <button className="adm-card" onClick={() => setPage('evacuation')}>
            <div className="adm-card__row">
              <span className="adm-card__label">Evac Centers</span>
              <svg className="adm-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <div className="adm-card__num-row">
              <p className="adm-card__num">{evacCount}</p>
              <div className="adm-card__tags">
                <span className="adm-tag adm-tag--green">Ready</span>
              </div>
            </div>
            <p className="adm-card__viewall">View →</p>
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
              <p className="adm-card__num">{(stats?.markers ?? []).filter(m => m.is_active).length}</p>
              <span className="adm-card__num-sub">active now</span>
            </div>
            <p className="adm-card__viewall">Post / Manage →</p>
          </button>
        </div>

        <div className="tnod-act-search-row">
          <p className="tnod-section-label" style={{ margin: 0 }}>RECENT ACTIVITIES</p>
          <div className="tnod-act-search">
            <span className="tnod-act-search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search activities…"
              value={actSearch}
              onChange={e => setActSearch(e.target.value)}
            />
            {actSearch && (
              <button className="tnod-act-search-clear" onClick={() => setActSearch('')}>✕</button>
            )}
          </div>
        </div>
        {actLoading && (
          <div className="tnod-activity-row" style={{ justifyContent: 'center', color: '#888', fontSize: '0.82rem' }}>
            <div className="tnod-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Loading...
          </div>
        )}
        {!actLoading && actFeed.length === 0 && (
          <div className="tnod-empty-card">No activities yet.</div>
        )}
        {!actLoading && actFeed.length > 0 && filtered.length === 0 && (
          <div className="tnod-empty-card">No activities match your search.</div>
        )}
        {!actLoading && pageFeed.map(a => (
          <button key={a.id} className="tnod-activity-row" onClick={() => setPage(a.dest)}>
            <div className="tnod-activity-icon">{a.icon}</div>
            <div className="tnod-activity-body">
              <p className="tnod-activity-label">{a.label}</p>
              {a.sub
                ? <p className="tnod-activity-sub">{a.sub} · {timeAgo(a.created_at)}</p>
                : <p className="tnod-activity-sub">{timeAgo(a.created_at)}</p>
              }
            </div>
            <span className={`tnod-badge tnod-badge--${a.badge_type}`}>{a.badge}</span>
          </button>
        ))}
        {!actLoading && totalPages > 1 && (
          <div className="tnod-act-pagination">
            <button
              className="tnod-act-pgbtn"
              disabled={actPage === 0}
              onClick={() => setActPage(p => p - 1)}
            >‹‹ Prev</button>
            <span className="tnod-act-pginfo">{actPage + 1} / {totalPages}</span>
            <button
              className="tnod-act-pgbtn"
              disabled={actPage >= totalPages - 1}
              onClick={() => setActPage(p => p + 1)}
            >Next ››</button>
          </div>
        )}
      </div>
    )
  }

  // ── MY SCHEDULE ────────────────────────────────────────────
  function MySchedulePage() {
    const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
    const sorted = [...mySchedules].sort((a, b) => {
      const da = DAY_ORDER.indexOf(a.time_shift?.split(' ')[0])
      const db = DAY_ORDER.indexOf(b.time_shift?.split(' ')[0])
      return da - db
    })

    return (
      <div className="tnod-content">
        <div className="tnod-page-header">
          <button className="tnod-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h2 className="tnod-page-title">My Schedule</h2>
        </div>

        <div className={`tnod-duty-banner ${onDutyToday ? 'tnod-duty-banner--on' : 'tnod-duty-banner--off'}`}>
          <span>{onDutyToday ? '🟢 You are ON DUTY today' : '⚫ You are OFF DUTY today'}</span>
        </div>

        {sorted.length === 0
          ? <div className="tnod-empty-card">No schedule assigned yet. Contact the admin.</div>
          : sorted.map(s => {
            const isToday = s.time_shift?.startsWith(todayName) || s.time_shift?.startsWith(todayISO)
            return (
              <div key={s.id} className={`tnod-sched-row${isToday ? ' tnod-sched-row--today' : ''}`}>
                <div className="tnod-sched-row__icon">📅</div>
                <div className="tnod-sched-row__body">
                  <p className="tnod-sched-row__shift">{formatShift(s.time_shift)}</p>
                  {isToday && <span className="tnod-tag tnod-tag--green" style={{ fontSize: '0.7rem', marginTop: 3 }}>Today</span>}
                </div>
              </div>
            )
          })
        }
      </div>
    )
  }

  // ── SOS ALERT CARD ─────────────────────────────────────────
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
          <p className="adm-sos-card__coords">{Number(a.latitude).toFixed(5)}, {Number(a.longitude).toFixed(5)}</p>
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

  // ── ACTIVE SOS ─────────────────────────────────────────────
  function SosPage() {
    const [alerts, setAlerts] = useState(stats?.sosList ?? [])

    async function handleResolve(id) {
      await resolveSosAlert(id)
      setAlerts(a => a.filter(x => x.id !== id))
      loadStats()
    }

    return (
      <div className="tnod-content">
        <div className="tnod-page-header">
          <button className="tnod-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h2 className="tnod-page-title">SOS Alerts</h2>
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

  // ── SOS HISTORY ────────────────────────────────────────────
  function SOSHistoryPage() {
    const [records, setRecords] = useState([])
    const [histLoading, setHistLoading] = useState(true)

    useEffect(() => {
      getSosHistory().then(r => {
        if (r.success) setRecords(r.data)
        setHistLoading(false)
      })
    }, [])

    return (
      <div className="tnod-content">
        <div className="tnod-page-header">
          <button className="tnod-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h2 className="tnod-page-title">SOS History</h2>
          <span />
        </div>
        {histLoading && <div className="adm-empty-sos"><div className="adm-spinner" /></div>}
        {!histLoading && records.length === 0 && (
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

  // ── INFO MENU ──────────────────────────────────────────────
  function InfoPage() {
    return (
      <div className="tnod-content">
        <p className="tnod-section-label">INFORMATION</p>
        <button className="tnod-info-card" onClick={() => setPage('schedules')}>
          <svg className="tnod-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>TANOD SCHEDULES</span>
        </button>
        <button className="tnod-info-card" onClick={() => setPage('memorandums')}>
          <svg className="tnod-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span>MEMORANDUMS</span>
        </button>
        <button className="tnod-info-card" onClick={() => setPage('safetyguide')}>
          <svg className="tnod-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>SAFETY GUIDE</span>
        </button>
      </div>
    )
  }

  // ── ALL TANOD SCHEDULES (read-only) ────────────────────────
  function SchedulesPage() {
    const [expandedName, setExpandedName] = useState(null)
    const grouped = (stats?.schedules ?? []).reduce((acc, s) => {
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
      const onToday    = data.entries.some(s => s.time_shift?.startsWith(todayName) || s.time_shift?.startsWith(todayISO))
      return (
        <div className="tnod-sched-group">
          <button className="tnod-sched-card" onClick={() => setExpandedName(isExpanded ? null : name)}>
            <div className="tnod-sched-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <p className="tnod-sched-name">
                {name}
                {name === user?.full_name && <span className="tnod-you-tag"> (You)</span>}
              </p>
              {data.contact && <p className="tnod-sched-detail">{data.contact}</p>}
              <p className="tnod-sched-detail">{data.entries.length} day{data.entries.length !== 1 ? 's' : ''} scheduled</p>
              {onToday && <span className="tnod-tag tnod-tag--green" style={{ fontSize: '0.68rem', marginTop: 3 }}>On Duty Today</span>}
            </div>
            <svg
              style={{ width: 18, height: 18, flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: '0.2s' }}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {isExpanded && (
            <div className="tnod-sched-rows">
              {data.entries.map(s => {
                const isTdy = s.time_shift?.startsWith(todayName) || s.time_shift?.startsWith(todayISO)
                return (
                  <div key={s.id} className={`tnod-shift-row${isTdy ? ' tnod-shift-row--today' : ''}`}>
                    <p className="tnod-shift-text">{formatShift(s.time_shift)}</p>
                    {isTdy && <span className="tnod-tag tnod-tag--green" style={{ fontSize: '0.65rem' }}>Today</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="tnod-content">
        <div className="tnod-page-header">
          <button className="tnod-back" onClick={() => setPage('info')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h2 className="tnod-page-title">Tanod Schedules</h2>
        </div>
        {Object.keys(grouped).length === 0 && <div className="tnod-empty-card">No schedules posted yet.</div>}
        {onDutyNames.length > 0 && (
          <>
            <p className="tnod-duty-label">ON DUTY TODAY</p>
            {onDutyNames.map(n => <TanodGroup key={n} name={n} data={grouped[n]} />)}
          </>
        )}
        {offDutyNames.length > 0 && (
          <>
            <p className="tnod-duty-label tnod-duty-label--off">OFF DUTY</p>
            {offDutyNames.map(n => <TanodGroup key={n} name={n} data={grouped[n]} />)}
          </>
        )}
      </div>
    )
  }

  // ── SAFETY GUIDE ───────────────────────────────────────────
  function SafetyGuidePage() {
    const [contacts, setContacts] = useState([])
    const [areas,    setAreas]    = useState([])
    const [plans,    setPlans]    = useState([])
    const [sgLoad,   setSgLoad]   = useState(true)
    const [expanded, setExpanded] = useState(null)

    useEffect(() => {
      Promise.all([getEmergencyContacts(), getEvacuationAreas(), getDisasterPlans()])
        .then(([c, a, p]) => {
          if (c.success) setContacts(c.data)
          if (a.success) setAreas(a.data)
          if (p.success) setPlans(p.data)
          setSgLoad(false)
        })
    }, [])

    function SectionBox({ sectionKey, label, children }) {
      const open = expanded === sectionKey
      return (
        <div className={`tnod-sg-box${open ? ' tnod-sg-box--open' : ''}`}>
          <button className="tnod-sg-box__header" onClick={() => setExpanded(p => p === sectionKey ? null : sectionKey)}>
            <span>{label}</span>
            <svg className={`tnod-sg-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {open && <div className="tnod-sg-box__body">{children}</div>}
        </div>
      )
    }

    return (
      <div className="tnod-content">
        <div className="tnod-page-header">
          <button className="tnod-back" onClick={() => setPage('info')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h2 className="tnod-page-title">Safety Guide</h2>
        </div>
        {sgLoad && <div className="tnod-empty-card">Loading...</div>}
        {!sgLoad && (
          <>
            <SectionBox sectionKey="contacts" label="EMERGENCY CONTACTS">
              {contacts.length === 0
                ? <p className="tnod-sg-empty">No contacts posted yet.</p>
                : contacts.map(c => (
                  <div key={c.id} className="tnod-sg-row">
                    <p className="tnod-sg-name">{c.name}</p>
                    {c.role && <p className="tnod-sg-sub">{c.role}</p>}
                    <p className="tnod-sg-sub">{c.contact_number}</p>
                  </div>
                ))
              }
            </SectionBox>
            <SectionBox sectionKey="areas" label="EVACUATION AREAS">
              {areas.length === 0
                ? <p className="tnod-sg-empty">No evacuation areas posted yet.</p>
                : areas.map(a => (
                  <div key={a.id} className="tnod-sg-row">
                    <p className="tnod-sg-name">{a.name}</p>
                    {a.address && <p className="tnod-sg-sub">{a.address}</p>}
                    {a.description && <p className="tnod-sg-sub">{a.description}</p>}
                  </div>
                ))
              }
            </SectionBox>
            <SectionBox sectionKey="plans" label="DISASTER PREPAREDNESS PLAN">
              {plans.length === 0
                ? <p className="tnod-sg-empty">No disaster plans posted yet.</p>
                : plans.map(p => (
                  <div key={p.id} className="tnod-sg-row">
                    <p className="tnod-sg-name">{p.title}</p>
                    {p.content && <p className="tnod-sg-sub" style={{ whiteSpace: 'pre-wrap' }}>{p.content}</p>}
                  </div>
                ))
              }
            </SectionBox>
          </>
        )}
      </div>
    )
  }

  // ── MEMORANDUMS ────────────────────────────────────────────
  function MemorandumsPage() {
    return (
      <div className="tnod-content">
        <div className="tnod-page-header">
          <button className="tnod-back" onClick={() => setPage('info')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h2 className="tnod-page-title">Memorandums</h2>
        </div>
        {(stats?.memos ?? []).length === 0
          ? <div className="tnod-empty-card">No memorandums posted yet.</div>
          : (stats?.memos ?? []).map(m => (
            <div key={m.id} className="tnod-memo-card">
              <p className="tnod-memo-title">{m.title}</p>
              <p className="tnod-memo-date">{formatDate(m.created_at)}</p>
              <p className="tnod-memo-content">{m.content}</p>
            </div>
          ))
        }
      </div>
    )
  }

  // ── EVACUATION AREAS ───────────────────────────────────────
  function EvacuationPage() {
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
    const mapRef = useRef(null)
    const editMapRef = useRef(null)
    const [editTarget, setEditTarget] = useState(null)
    const [editName, setEditName] = useState('')
    const [editDesc, setEditDesc] = useState('')
    const [editPinCoords, setEditPinCoords] = useState(null)
    const [editPinAddress, setEditPinAddress] = useState('')
    const [editGeocoding, setEditGeocoding] = useState(false)

    useEffect(() => {
      supabase.from('safety_evacuation_areas')
        .select('id, name, address, description, latitude, longitude')
        .order('created_at', { ascending: true })
        .then(({ data }) => { setAreas(data ?? []); setLoadingList(false) })
    }, [])

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
      const { data } = await supabase.from('safety_evacuation_areas')
        .select('id, name, address, description, latitude, longitude')
        .order('created_at', { ascending: true })
      setAreas(data ?? [])
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
      <div className="tnod-content">
        <div className="tnod-page-header">
          <button className="tnod-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h2 className="tnod-page-title">Evacuation Areas</h2>
          <button className="adm-add-btn" onClick={() => { setShowPicker(v => !v); setError(''); setPinCoords(null) }}>
            {showPicker ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {editTarget && (
          <div className="adm-map-picker-card">
            <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 6 }}>Edit: {editTarget.name}</p>
            <input className="adm-input" placeholder="Area Name *" value={editName} onChange={e => setEditName(e.target.value)} />
            <textarea className="adm-textarea" placeholder="Notes / Description (optional)" rows={2} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
            <p className="adm-map-picker__hint" style={{ marginTop: 8 }}>📍 Tap to move pin</p>
            <div className="adm-map-picker__map">
              <MapContainer
                key={`edit-tnod-evac-${editTarget.id}`}
                center={[editPinCoords?.lat ?? FAIRVIEW_CENTER[0], editPinCoords?.lng ?? FAIRVIEW_CENTER[1]]}
                zoom={16}
                ref={editMapRef}
                maxBounds={FAIRVIEW_BOUNDS}
                maxBoundsViscosity={1.0}
                minZoom={13}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
              >
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapClickHandler onMapClick={handleEditMapClick} />
                {editPinCoords && <Marker position={[editPinCoords.lat, editPinCoords.lng]} icon={makeAdminMarkerIcon('🏠')} />}
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
            <input className="adm-input" placeholder="Area Name * (e.g. Covered Court, Barangay Hall)" value={areaName} onChange={e => setAreaName(e.target.value)} />
            <textarea className="adm-textarea" placeholder="Notes / Description (optional)" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
            <p className="adm-map-picker__hint" style={{ marginTop: 8 }}>📍 Tap on the map to pin the evacuation area</p>
            <div className="adm-map-picker__map">
              <MapContainer
                center={FAIRVIEW_CENTER}
                zoom={15}
                ref={mapRef}
                maxBounds={FAIRVIEW_BOUNDS}
                maxBoundsViscosity={1.0}
                minZoom={13}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
              >
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapClickHandler onMapClick={handleMapClick} />
                {pinCoords && <Marker position={[pinCoords.lat, pinCoords.lng]} icon={makeAdminMarkerIcon('🏠')} />}
              </MapContainer>
            </div>
            {pinCoords && (
              <p className="adm-map-picker__coords">
                {geocoding ? 'Getting street address…' : (pinAddress || `${pinCoords.lat.toFixed(5)}, ${pinCoords.lng.toFixed(5)}`)}
              </p>
            )}
            {error && <p className="adm-error" style={{ marginTop: 4 }}>{error}</p>}
            <button className="adm-submit-btn" onClick={handlePost} disabled={saving || !pinCoords || geocoding} style={{ marginTop: 10 }}>
              {saving ? 'Saving...' : 'Add Evacuation Area'}
            </button>
          </div>
        )}

        {loadingList && <p className="adm-empty">Loading...</p>}
        {!loadingList && areas.length === 0 && <div className="tnod-empty-card">No evacuation areas added yet.</div>}
        {areas.map(a => (
          <div key={a.id} className="tnod-evac-card">
            <div className="tnod-evac-card__emoji">🏠</div>
            <div className="tnod-evac-card__body">
              <p className="tnod-evac-card__name">{a.name}</p>
              {(a.address) && <p className="tnod-evac-card__sub">📍 {a.address}</p>}
              {a.description && <p className="tnod-evac-card__sub">{a.description}</p>}
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
        ))}
      </div>
    )
  }

  // ── PROFILE ────────────────────────────────────────────────
  function ProfilePage() {
    const [contact, setContact] = useState(user?.contact_number ?? '')
    const [saving,  setSaving]  = useState(false)
    const [error,   setError]   = useState('')
    const [success, setSuccess] = useState(false)
    const [photo, setPhoto] = useState(user?.profile_photo ?? null)
    const [photoSaving, setPhotoSaving] = useState(false)
    const [photoError, setPhotoError] = useState('')
    const [deleteConfirm, setDeleteConfirm] = useState(false)
    const fileInputRef = useRef(null)

    async function handleUpdate() {
      setSaving(true); setError(''); setSuccess(false)
      const res = await updateUserProfile({
        userId: user.id,
        contactNumber: contact,
        address: user.address ?? 'Barangay',
        email: user.email ?? '',
      })
      setSaving(false)
      if (!res.success) { setError(res.error); return }
      setSuccess(true)
      if (onUserUpdate) onUserUpdate(res.user)
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
      <div className="tnod-content">
        <div className="tnod-profile-header">
          <div className="tnod-profile-avatar-wrap" style={{ position: 'relative', display: 'inline-block' }}>
            <div className="tnod-profile-avatar" style={{ overflow: 'hidden' }}>
              {photo
                ? <img src={photo} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                )}
            </div>
            {photo && (
              <button
                type="button"
                className="tnod-photo-del-btn"
                onClick={() => setDeleteConfirm(true)}
                title="Remove photo"
              >✕</button>
            )}
            <button
              type="button"
              className="tnod-photo-cam-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoSaving}
              title={photo ? 'Change photo' : 'Upload photo'}
            >
              {photoSaving ? '…' : '📷'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
          </div>
          <p className="tnod-profile-name">{user?.full_name ?? 'Tanod'}</p>
          <span className="tnod-role-badge">TANOD</span>
          {photoError && <p className="tnod-feedback tnod-feedback--error" style={{ marginTop: 4 }}>{photoError}</p>}
        </div>

        {deleteConfirm && (
          <div className="adm-popup-overlay" onClick={() => setDeleteConfirm(false)}>
            <div className="adm-popup-sheet" style={{ padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
              <p style={{ marginBottom: '1rem', fontWeight: 600 }}>Remove profile photo?</p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button className="tnod-update-btn" style={{ flex: 1 }} onClick={handleDeletePhoto}>Remove</button>
                <button className="tnod-logout-btn" style={{ flex: 1, marginTop: 0 }} onClick={() => setDeleteConfirm(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="tnod-profile-field">
          <label className="tnod-profile-label">Full Name</label>
          <div className="tnod-profile-readonly">{user?.full_name ?? '—'}</div>
        </div>
        <div className="tnod-profile-field">
          <label className="tnod-profile-label">Username</label>
          <div className="tnod-profile-readonly">@{user?.username ?? '—'}</div>
        </div>
        <div className="tnod-profile-field">
          <label className="tnod-profile-label">Contact Number</label>
          <input
            className="tnod-profile-input"
            type="tel"
            value={contact}
            onChange={e => { setContact(e.target.value); setSuccess(false) }}
            placeholder="Enter contact number"
          />
        </div>

        {error   && <p className="tnod-feedback tnod-feedback--error">{error}</p>}
        {success && <p className="tnod-feedback tnod-feedback--success">Profile updated!</p>}

        <button className="tnod-update-btn" onClick={handleUpdate} disabled={saving}>
          {saving ? 'Saving...' : 'Update Profile'}
        </button>
        <button className="tnod-logout-btn" onClick={onLogout}>LOG OUT</button>
      </div>
    )
  }

  // ── ALERT MARKERS ─────────────────────────────────────────
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
      supabase.from('alert_markers').select('id,title,description,latitude,longitude,address,is_active,created_at')
        .order('created_at', { ascending: false })
        .then(({ data }) => { setMarkers(data ?? []); setLoadingList(false) })
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
      supabase.from('alert_markers').select('id,title,description,latitude,longitude,address,is_active,created_at')
        .order('created_at', { ascending: false })
        .then(({ data }) => setMarkers(data ?? []))
      setPinCoords(null); setTitle(''); setMarkerType('accident'); setPinAddress(''); setShowPicker(false)
    }

    async function handleDeactivate(id) {
      await deactivateAlertMarker(id)
      setMarkers(m => m.map(x => x.id === id ? { ...x, is_active: false } : x))
    }

    const selectedType = MARKER_TYPES.find(t => t.id === markerType) ?? MARKER_TYPES[0]

    return (
      <div className="tnod-content">
        <div className="tnod-page-header">
          <button className="tnod-back" onClick={goHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 className="tnod-page-title">Alert Markers</h2>
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
                <button className="adm-resolve-btn adm-resolve-btn--sm" onClick={() => handleDeactivate(m.id)}>
                  Deactivate
                </button>
              </div>
              <span className="adm-marker-type-badge">{typeInfo.emoji} {typeInfo.label}</span>
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
              </div>
              <span className="adm-marker-type-badge">{typeInfo.emoji} {typeInfo.label}</span>
            </div>
          )
        })}
      </div>
    )
  }

  // ── RENDER ─────────────────────────────────────────────────
  const sosCount = stats?.sosList?.length ?? 0

  return (
    <div className="tnod-shell">
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
              {TANOD_SEARCH_PAGES
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
      <div className="tnod-topbar">
        <div>
          <p className="tnod-topbar__title">SENTRYSEC</p>
          <p className="tnod-topbar__role">Tanod Portal</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="adm-topbar__searchbtn" onClick={() => setSearchOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="19" height="19"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          {sosCount > 0 && (
            <button className="tnod-topbar__sos" onClick={() => setPage('sos')}>
              🚨 SOS
              <span className="tnod-topbar__sos-count">{sosCount}</span>
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="tnod-body">
        {page === 'home'         && <HomePage />}
        {page === 'my-schedule'  && <MySchedulePage />}
        {page === 'sos'          && <SosPage />}
        {page === 'sos-history'  && <SOSHistoryPage />}
        {page === 'info'         && <InfoPage />}
        {page === 'schedules'    && <SchedulesPage />}
        {page === 'safetyguide'  && <SafetyGuidePage />}
        {page === 'memorandums'  && <MemorandumsPage />}
        {page === 'evacuation'   && <EvacuationPage />}
        {page === 'alerts'       && <AlertMarkersPage />}
        {page === 'profile'      && <ProfilePage />}
      </div>

      {/* Bottom nav — Info | Home | Profile */}
      <div className="tnod-bottomnav">
        <button
          className={`tnod-navbtn${['info','schedules','safetyguide','memorandums'].includes(page) ? ' active' : ''}`}
          onClick={() => setPage('info')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>Info</span>
        </button>
        <button
          className={`tnod-navbtn${['home','my-schedule','sos','sos-history','evacuation','alerts'].includes(page) ? ' active' : ''}`}
          onClick={() => { setPage('home'); loadStats() }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Home</span>
        </button>
        <button
          className={`tnod-navbtn${page === 'profile' ? ' active' : ''}`}
          onClick={() => setPage('profile')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <span>Profile</span>
        </button>
      </div>
    </div>
  )
}
