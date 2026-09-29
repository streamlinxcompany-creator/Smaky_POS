import type { User } from './types'

const SESSION_KEY = 'smaky-session'

export function getSessionUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) as User : null
  } catch {
    return null
  }
}

export function setSessionUser(user: User) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user))
  window.dispatchEvent(new Event('smaky-auth-change'))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new Event('smaky-auth-change'))
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || 'S'
}
