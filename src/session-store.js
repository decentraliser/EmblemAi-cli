/**
 * Session Store for EmblemAI CLI
 *
 * Handles persistent storage of auth sessions to the active profile's
 * session.json with secure file permissions.
 */

import fs from 'fs';
import { ensureProfileDir, getProfilePaths } from './profile.js';

function getSessionFile() {
  return getProfilePaths().session;
}

// Token refresh buffer (refresh 5 minutes before expiry)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Ensure the active profile directory exists with secure permissions.
 */
function ensureDir() {
  ensureProfileDir();
}

/**
 * Save an auth session to disk.
 * @param {object} session - AuthSession from the SDK
 */
export function saveSession(session) {
  ensureDir();

  const stored = {
    session,
    storedAt: Date.now(),
  };

  fs.writeFileSync(getSessionFile(), JSON.stringify(stored, null, 2), { mode: 0o600 });
}

/**
 * Load the stored auth session from disk.
 * Returns null if no session exists or if it's invalid.
 * @returns {object | null}
 */
export function loadSession() {
  try {
    const sessionFile = getSessionFile();
    if (!fs.existsSync(sessionFile)) return null;

    const content = fs.readFileSync(sessionFile, 'utf-8');
    const stored = JSON.parse(content);

    if (!stored?.session?.authToken || !stored?.session?.user) {
      return null;
    }

    return stored.session;
  } catch {
    return null;
  }
}

/**
 * Clear the stored session file.
 */
export function clearSession() {
  try {
    const sessionFile = getSessionFile();
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  } catch {
    // Ignore errors when clearing
  }
}

/**
 * Check if a session is expired.
 * @param {object} session
 * @returns {boolean}
 */
export function isSessionExpired(session) {
  return Date.now() >= session.expiresAt;
}

/**
 * Check if a session needs refresh (within 5 minutes of expiry).
 * @param {object} session
 * @returns {boolean}
 */
export function needsRefresh(session) {
  const timeUntilExpiry = session.expiresAt - Date.now();
  return timeUntilExpiry < REFRESH_BUFFER_MS;
}
