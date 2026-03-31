import { supabase } from './db'

// ── Password hashing via Web Crypto API (SHA-256) ──
async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Activity log helpers ───────────────────────────────────
const ACTIVITY_LOG_MAX = 25

const MARKER_EMOJIS  = { accident: '🚗', criminal: '🔪', flood: '🌊', fire: '🔥', hazard: '🚧', medical: '🏥' }
const MARKER_LABELS  = { accident: 'Accident', criminal: 'Criminal Activity', flood: 'Flood', fire: 'Fire', hazard: 'Road Hazard', medical: 'Medical Emergency' }

async function logActivity({ icon, label, sub, badge, badge_type, dest }) {
  await supabase.from('activity_log').insert({ icon, label, sub: sub || null, badge, badge_type, dest })
  // Trim to cap: remove oldest records beyond ACTIVITY_LOG_MAX
  const { data: all } = await supabase.from('activity_log').select('id').order('created_at', { ascending: false })
  if (all && all.length > ACTIVITY_LOG_MAX) {
    const toDelete = all.slice(ACTIVITY_LOG_MAX).map(r => r.id)
    await supabase.from('activity_log').delete().in('id', toDelete)
  }
}

export async function getActivityLog() {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, icon, label, sub, badge, badge_type, dest, created_at')
    .order('created_at', { ascending: false })
    .limit(ACTIVITY_LOG_MAX)
  if (error) return { success: false, data: [] }
  return { success: true, data: data ?? [] }
}

// ── Register a new user ──
export async function registerUser({ fullName, address, contactNumber, email, username, password, barangayIdImage }) {
  const passwordHash = await hashPassword(password)

  const { error } = await supabase.from('users').insert({
    full_name: fullName,
    address,
    contact_number: contactNumber,
    email,
    username,
    password_hash: passwordHash,
    barangay_id_image: barangayIdImage ?? null,
  })

  if (error) {
    if (error.code === '23505') {
      const isDupEmail = error.message.includes('email')
      return { success: false, error: isDupEmail ? 'An account with this email already exists.' : 'Username is already taken.' }
    }
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  return { success: true }
}

// ── Login a user ──
export async function loginUser({ username, password }) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single()

  if (error || !data) {
    return { success: false, error: 'Invalid username or password.' }
  }

  const passwordHash = await hashPassword(password)

  if (passwordHash !== data.password_hash) {
    return { success: false, error: 'Invalid username or password.' }
  }

  if (data.is_active === false) {
    const { data: adminData } = await supabase
      .from('users')
      .select('contact_number')
      .eq('role', 'admin')
      .single()
    const adminContact = adminData?.contact_number || 'the barangay admin'
    return {
      success: false,
      deactivated: true,
      error: `Your account has been deactivated.\n\nIf you believe this is a mistake, please contact the barangay admin at ${adminContact}.`
    }
  }

  const { password_hash: _, ...safeUser } = data
  return { success: true, user: safeUser }
}

// ── Fetch barangay memorandums (posted by admin) ──
export async function getMemorandums() {
  const { data, error } = await supabase
    .from('barangay_memorandums')
    .select('id, title, content, created_at')
    .order('created_at', { ascending: false })
  if (error) return { success: false, error: 'Failed to load memorandums.', data: [] }
  return { success: true, data: data ?? [] }
}

// ── Submit user feedback ──
export async function submitFeedback({ userId, fullName, message }) {
  const { error } = await supabase
    .from('user_feedback')
    .insert({ user_id: userId, full_name: fullName, message })
  if (error) return { success: false, error: 'Failed to send feedback.' }
  return { success: true }
}

// ── Update user profile ──
export async function updateUserProfile({ userId, address, contactNumber, email }) {
  const { data, error } = await supabase
    .from('users')
    .update({ address, contact_number: contactNumber, email })
    .eq('id', userId)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return { success: false, error: 'That email is already in use.' }
    return { success: false, error: 'Failed to update profile.' }
  }
  const { password_hash: _, ...safeUser } = data
  return { success: true, user: safeUser }
}

// ── Fetch safety guide: emergency contacts ──
export async function getEmergencyContacts() {
  const { data, error } = await supabase
    .from('safety_emergency_contacts')
    .select('id, name, role, contact_number')
    .order('created_at', { ascending: true })
  if (error) return { success: false, error: 'Failed to load emergency contacts.', data: [] }
  return { success: true, data: data ?? [] }
}

// ── Fetch safety guide: evacuation areas ──
export async function getEvacuationAreas() {
  const { data, error } = await supabase
    .from('safety_evacuation_areas')
    .select('id, name, address, description, latitude, longitude')
    .order('created_at', { ascending: true })
  if (error) return { success: false, error: 'Failed to load evacuation areas.', data: [] }
  return { success: true, data: data ?? [] }
}

// ── Fetch a user's own past feedback ──
export async function getUserFeedback(userId) {
  const { data, error } = await supabase
    .from('user_feedback')
    .select('id, message, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) return { success: false, error: 'Failed to load feedback.', data: [] }
  return { success: true, data: data ?? [] }
}

// ── Fetch safety guide: disaster preparedness plans ──
export async function getDisasterPlans() {
  const { data, error } = await supabase
    .from('safety_disaster_plans')
    .select('id, title, content')
    .order('created_at', { ascending: true })
  if (error) return { success: false, error: 'Failed to load disaster plans.', data: [] }
  return { success: true, data: data ?? [] }
}

// ── Fetch tanod schedules ──
export async function getTanodSchedules() {
  const { data, error } = await supabase
    .from('tanod_schedules')
    .select('id, name, time_shift, contact_number, status')
    .order('created_at', { ascending: false })

  if (error) return { success: false, error: 'Failed to load schedules.', data: [] }
  return { success: true, data: data ?? [] }
}

// ── Save confirmed user location ──
export async function getNotifications() {
  const [{ data: alerts }, { data: memos }] = await Promise.all([
    supabase
      .from('alert_markers')
      .select('id, title, description, latitude, longitude, address, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('barangay_memorandums')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  return [
    ...(alerts || []).map(a => ({
      id: `alert_${a.id}`,
      type: 'alert',
      title: a.title,
      description: a.description || '',
      address: a.address || '',
      latitude: a.latitude,
      longitude: a.longitude,
      created_at: a.created_at,
    })),
    ...(memos || []).map(m => ({
      id: `memo_${m.id}`,
      type: 'memo',
      title: m.title,
      created_at: m.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

export async function sendSOSAlert({ userId, fullName, latitude, longitude, address }) {
  const { error } = await supabase
    .from('sos_alerts')
    .insert({
      user_id: userId,
      full_name: fullName,
      latitude,
      longitude,
      address,
      status: 'active',
    })

  if (error) {
    return { success: false, error: 'Failed to send SOS alert.' }
  }
  await logActivity({ icon: '🚨', label: `SOS Alert: ${fullName}`, sub: address?.slice(0, 45), badge: 'Active SOS', badge_type: 'red', dest: 'sos' })
  return { success: true }
}

// ── Admin: get all dashboard stats ──
export async function getAdminStats() {
  const [
    { data: feedback },
    { data: tanods },
    { data: schedules },
    { data: memos },
    { data: sos },
    { data: users },
    { data: markers },
    { data: emergencyContacts },
    { data: evacuationAreas },
    { data: disasterPlans },
    { count: sosHistoryCount },
  ] = await Promise.all([
    supabase.from('user_feedback').select('id, user_id, full_name, message, created_at').order('created_at', { ascending: false }),
    supabase.from('users').select('id, full_name, contact_number, username').eq('role', 'tanod'),
    supabase.from('tanod_schedules').select('id, name, time_shift, contact_number, status, created_at').order('created_at', { ascending: false }),
    supabase.from('barangay_memorandums').select('id, title, content, created_at').order('created_at', { ascending: false }),
    supabase.from('sos_alerts').select('id, full_name, address, latitude, longitude, created_at').eq('status', 'active').order('created_at', { ascending: false }),
    supabase.from('users').select('*').eq('role', 'user').order('created_at', { ascending: false }),
    supabase.from('alert_markers').select('id, is_active').order('created_at', { ascending: false }),
    supabase.from('safety_emergency_contacts').select('id, name, role, contact_number').order('created_at', { ascending: true }),
    supabase.from('safety_evacuation_areas').select('id, name, address, description, latitude, longitude').order('created_at', { ascending: true }),
    supabase.from('safety_disaster_plans').select('id, title, content').order('created_at', { ascending: true }),
    supabase.from('sos_alerts').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
  ])
  return {
    feedback: feedback ?? [],
    tanods: tanods ?? [],
    schedules: schedules ?? [],
    memos: memos ?? [],
    sos: sos ?? [],
    users: users ?? [],
    markers: markers ?? [],
    emergencyContacts: emergencyContacts ?? [],
    evacuationAreas: evacuationAreas ?? [],
    disasterPlans: disasterPlans ?? [],
    sosHistoryCount: sosHistoryCount ?? 0,
  }
}

// ── Admin: deactivate / reactivate a resident account ──
export async function setResidentActive({ id, isActive }) {
  const { error } = await supabase.from('users').update({ is_active: isActive }).eq('id', id)
  return { success: !error, error: error?.message }
}

// ── Admin: create tanod account ──
export async function createTanodAccount({ fullName, username, password, contactNumber }) {
  const passwordHash = await hashPassword(password)
  const { error } = await supabase.from('users').insert({
    full_name: fullName,
    username,
    password_hash: passwordHash,
    contact_number: contactNumber || '',
    role: 'tanod',
    address: 'Barangay',
    email: `${username}_${Date.now()}@sentrysec.local`,
  })
  if (error) {
    if (error.code === '23505') return { success: false, error: 'Username already exists.' }
    return { success: false, error: 'Failed to create account.' }
  }
  await logActivity({ icon: '👮', label: `Tanod account created: ${fullName}`, badge: 'Account', badge_type: 'blue', dest: 'schedules' })
  return { success: true }
}

// ── Admin: delete tanod account ──
export async function deleteTanodAccount(id) {
  // Fetch the tanod's full_name to match schedules
  const { data: tanod } = await supabase.from('users').select('full_name').eq('id', id).single()
  if (tanod?.full_name) {
    await supabase.from('tanod_schedules').delete().eq('name', tanod.full_name)
  }
  const { error } = await supabase.from('users').delete().eq('id', id)
  return { success: !error }
}

// ── Admin: post memorandum ──
export async function postMemorandum({ title, content }) {
  const { error } = await supabase.from('barangay_memorandums').insert({ title, content })
  if (error) return { success: false, error: 'Failed to post memorandum.' }
  await logActivity({ icon: '📋', label: `Memo published: "${title}"`, badge: 'Memo', badge_type: 'blue', dest: 'memorandums' })
  return { success: true }
}

// ── Admin: delete memorandum ──
export async function deleteMemorandum(id) {
  const { error } = await supabase.from('barangay_memorandums').delete().eq('id', id)
  return { success: !error }
}

// ── Tanod: get active SOS alerts ──
export async function getActiveSosAlerts() {
  const { data, error } = await supabase
    .from('sos_alerts')
    .select('id, full_name, address, latitude, longitude, created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (error) return { success: false, data: [] }
  return { success: true, data: data ?? [] }
}

// ── Admin: resolve SOS alert ──
export async function resolveSosAlert(id) {
  const { data: alert } = await supabase.from('sos_alerts').select('full_name, address').eq('id', id).single()
  const { error } = await supabase.from('sos_alerts').update({ status: 'resolved' }).eq('id', id)
  if (!error) {
    await logActivity({ icon: '✅', label: `SOS Resolved: ${alert?.full_name ?? 'Unknown'}`, sub: alert?.address?.slice(0, 45), badge: 'Resolved', badge_type: 'green', dest: 'sos-history' })
  }
  return { success: !error }
}

// ── Admin: get resolved SOS history ──
export async function getSosHistory() {
  const { data, error } = await supabase
    .from('sos_alerts')
    .select('id, full_name, address, latitude, longitude, created_at')
    .eq('status', 'resolved')
    .order('created_at', { ascending: false })
  if (error) return { success: false, data: [] }
  return { success: true, data: data ?? [] }
}

// ── Admin: add tanod schedule ──
export async function addTanodSchedule(entries, action = 'added') {
  // accepts a single object or an array of objects
  const rows = (Array.isArray(entries) ? entries : [entries]).map(({ name, timeShift, contactNumber }) => ({
    name,
    time_shift: timeShift,
    contact_number: contactNumber || '',
    status: 'off-duty',
  }))
  const { error } = await supabase.from('tanod_schedules').insert(rows)
  if (error) return { success: false, error: error.message ?? 'Failed to add schedule.' }
  const namesList = [...new Set(rows.map(r => r.name))].join(', ')
  await logActivity({ icon: '📅', label: `Schedule ${action}: ${namesList}`, badge: 'Schedule', badge_type: 'gray', dest: 'schedules' })
  return { success: true }
}

// ── Admin: update schedule status ──
export async function updateScheduleStatus({ id, status }) {
  const { error } = await supabase.from('tanod_schedules').update({ status }).eq('id', id)
  return { success: !error }
}

// ── Admin: delete schedule entry ──
export async function deleteScheduleEntry(id) {
  const { error } = await supabase.from('tanod_schedules').delete().eq('id', id)
  return { success: !error }
}

// ── Admin: post alert marker ──
export async function postAlertMarker({ title, description, latitude, longitude, address }) {
  const { error } = await supabase.from('alert_markers').insert({ title, description, latitude, longitude, is_active: true, address: address || '' })
  if (error) return { success: false, error: 'Failed to post alert.' }
  const emoji = MARKER_EMOJIS[description] ?? '⚠️'
  const typeLabel = MARKER_LABELS[description] ?? 'Alert'
  await logActivity({ icon: emoji, label: `Alert posted: ${title}`, sub: typeLabel, badge: 'Active', badge_type: 'red', dest: 'alerts' })
  return { success: true }
}

// ── Admin: deactivate alert marker ──
export async function deactivateAlertMarker(id) {
  const { data: marker } = await supabase.from('alert_markers').select('title, description').eq('id', id).single()
  const { error } = await supabase.from('alert_markers').update({ is_active: false }).eq('id', id)
  if (!error && marker) {
    const emoji = MARKER_EMOJIS[marker.description] ?? '⚠️'
    const typeLabel = MARKER_LABELS[marker.description] ?? 'Alert'
    await logActivity({ icon: '✓', label: `Alert deactivated: ${marker.title}`, sub: typeLabel, badge: 'Inactive', badge_type: 'gray', dest: 'alerts' })
  }
  return { success: !error }
}

// ── Admin: add emergency contact ──
export async function addEmergencyContact({ name, role, contactNumber }) {
  const { error } = await supabase.from('safety_emergency_contacts').insert({ name, role, contact_number: contactNumber })
  if (error) return { success: false, error: error.message ?? 'Failed to add contact.' }
  await logActivity({ icon: '📞', label: `Emergency contact added: ${name}`, sub: role || null, badge: 'Contact', badge_type: 'blue', dest: 'safetyguide' })
  return { success: true }
}

// ── Admin: delete emergency contact ──
export async function deleteEmergencyContact(id) {
  const { error } = await supabase.from('safety_emergency_contacts').delete().eq('id', id)
  return { success: !error }
}

// ── Admin: add evacuation area ──
export async function addEvacuationArea({ name, latitude, longitude, description, address }) {
  const { error } = await supabase.from('safety_evacuation_areas').insert({ name, latitude, longitude, description: description || '', address: address || '' })
  if (error) return { success: false, error: error.message ?? 'Failed to add area.' }
  await logActivity({ icon: '🏠', label: `Evacuation area added: ${name}`, sub: address || null, badge: 'Evac', badge_type: 'green', dest: 'evacuation' })
  return { success: true }
}

// ── Admin: delete evacuation area ──
export async function deleteEvacuationArea(id) {
  const { error } = await supabase.from('safety_evacuation_areas').delete().eq('id', id)
  return { success: !error }
}

// ── Admin: add disaster plan ──
export async function addDisasterPlan({ title, content }) {
  const { error } = await supabase.from('safety_disaster_plans').insert({ title, content })
  if (error) return { success: false, error: error.message ?? 'Failed to add plan.' }
  await logActivity({ icon: '📖', label: `Disaster plan added: ${title}`, badge: 'Plan', badge_type: 'blue', dest: 'safetyguide' })
  return { success: true }
}

// ── Admin: delete disaster plan ──
export async function deleteDisasterPlan(id) {
  const { error } = await supabase.from('safety_disaster_plans').delete().eq('id', id)
  return { success: !error }
}

// ── Admin: update tanod account ──
export async function updateTanodAccount({ id, fullName, username, contactNumber, password }) {
  const updates = { full_name: fullName, contact_number: contactNumber || '' }
  if (username) updates.username = username
  if (password) updates.password_hash = await hashPassword(password)
  const { error } = await supabase.from('users').update(updates).eq('id', id)
  return { success: !error, error: error?.message }
}

// ── Admin: update schedule entry time shift ──
export async function updateScheduleEntry({ id, timeShift }) {
  const { error } = await supabase.from('tanod_schedules').update({ time_shift: timeShift }).eq('id', id)
  return { success: !error, error: error?.message }
}

// ── Admin: update alert marker ──
export async function updateAlertMarker({ id, title, description, latitude, longitude, address }) {
  const { error } = await supabase.from('alert_markers').update({ title, description, latitude, longitude, address: address || '' }).eq('id', id)
  return { success: !error, error: error?.message }
}

// ── Admin/Tanod: delete alert marker completely ──
export async function deleteAlertMarker(id) {
  const { error } = await supabase.from('alert_markers').delete().eq('id', id)
  return { success: !error }
}

// ── Admin: update emergency contact ──
export async function updateEmergencyContact({ id, name, role, contactNumber }) {
  const { error } = await supabase.from('safety_emergency_contacts').update({ name, role, contact_number: contactNumber }).eq('id', id)
  return { success: !error, error: error?.message }
}

// ── Admin/Tanod: update evacuation area ──
export async function updateEvacuationArea({ id, name, description, latitude, longitude, address }) {
  const { error } = await supabase.from('safety_evacuation_areas').update({ name, description: description || '', latitude, longitude, address: address || '' }).eq('id', id)
  return { success: !error, error: error?.message }
}

// ── Admin: update memorandum ──
export async function updateMemorandum({ id, title, content }) {
  const { error } = await supabase.from('barangay_memorandums').update({ title, content }).eq('id', id)
  return { success: !error, error: error?.message }
}

// ── Admin: update disaster plan ──
export async function updateDisasterPlan({ id, title, content }) {
  const { error } = await supabase.from('safety_disaster_plans').update({ title, content }).eq('id', id)
  return { success: !error, error: error?.message }
}

export async function updateProfilePhoto({ userId, photoData }) {
  const { error } = await supabase.from('users').update({ profile_photo: photoData }).eq('id', userId)
  return { success: !error, error: error?.message }
}

export async function saveUserLocation({ userId, latitude, longitude, address }) {
  const { error } = await supabase
    .from('users')
    .update({
      last_latitude: latitude,
      last_longitude: longitude,
      last_address: address,
      last_location_updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    return { success: false, error: 'Failed to save location.' }
  }
  return { success: true }
}
