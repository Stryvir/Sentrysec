import { supabase } from './db'

// ── Password hashing via Web Crypto API (SHA-256) ──
async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
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

  const { password_hash: _, ...safeUser } = data
  return { success: true, user: safeUser }
}
