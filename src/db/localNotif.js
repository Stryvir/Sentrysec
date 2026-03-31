import { LocalNotifications } from '@capacitor/local-notifications'

let _idCounter = Math.floor(Date.now() / 1000) % 2147483647

export async function requestNotifPermission() {
  try {
    // General notification channel (normal sound)
    await LocalNotifications.createChannel({
      id: 'general',
      name: 'General Notifications',
      importance: 3,
      vibration: true,
    }).catch(() => {})

    // SOS channel — max importance, uses default alarm-like OS behavior
    await LocalNotifications.createChannel({
      id: 'sos_alerts',
      name: 'SOS Alerts',
      importance: 5,
      vibration: true,
      visibility: 1,
    }).catch(() => {})

    const { display } = await LocalNotifications.requestPermissions()
    return display === 'granted' || display === 'limited'
  } catch {
    return false
  }
}

// ── Regular notification (normal sound) ───────────────────
export async function showNotif({ title, body }) {
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: (_idCounter++ % 2147483647),
        title,
        body: body ?? '',
        schedule: { at: new Date(Date.now() + 100) },
        channelId: 'general',
        iconColor: '#1a3c1a',
      }]
    })
  } catch {
    // Silently ignore on web
  }
}

// ── SOS notification (high importance, plays through OS) ──
export async function showSosNotif({ title, body }) {
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: (_idCounter++ % 2147483647),
        title,
        body: body ?? '',
        schedule: { at: new Date(Date.now() + 100) },
        channelId: 'sos_alerts',
        iconColor: '#dc2626',
      }]
    })
  } catch {
    // Silently ignore on web
  }
}

// ── In-app siren (Web Audio API, loops until stopSiren()) ─
let _sirenStop = null

export function startSiren() {
  stopSiren() // Cancel any previous siren first
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    let _active = true
    let _cycleTimeout = null

    function playCycle() {
      if (!_active) return

      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      const lfo  = ctx.createOscillator()
      const lfoG = ctx.createGain()

      lfo.frequency.value = 1.8  // Wail speed (cycles per second)
      lfoG.gain.value = 350      // Frequency sweep range (Hz)
      lfo.connect(lfoG)
      lfoG.connect(osc.frequency)

      osc.type = 'sawtooth'
      osc.frequency.value = 900  // Base frequency

      osc.connect(gain)
      gain.connect(ctx.destination)

      // Fade in → hold → fade out over ~3 seconds
      gain.gain.setValueAtTime(0, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.5, ctx.currentTime + 2.7)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 3.0)

      osc.start(ctx.currentTime)
      lfo.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 3.0)
      lfo.stop(ctx.currentTime + 3.0)

      // Loop: next cycle starts just after this one ends
      _cycleTimeout = setTimeout(() => { if (_active) playCycle() }, 3200)
    }

    playCycle()

    _sirenStop = () => {
      _active = false
      if (_cycleTimeout) clearTimeout(_cycleTimeout)
      try { ctx.close() } catch {}
      _sirenStop = null
    }
  } catch {
    // Web Audio not supported — silently skip
  }
}

export function stopSiren() {
  if (_sirenStop) {
    _sirenStop()
    _sirenStop = null
  }
}

