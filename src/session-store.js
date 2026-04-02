/**
 * Session Store for EmblemAI CLI
 *
 * Handles persistent storage of auth sessions to the active profile's
 * session.json with secure file permissions.
 */

import fs from 'fs';
import { ensureProfileDir, getProfilePaths } from './profile.js';
import { createModelSelection, resolveModelId } from './models.js';

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
  return writeSessionStore({ session });
}

/**
 * Save session-related CLI preferences to disk without losing the auth session.
 * @param {{ model?: string | null, modelLabel?: string | null }} preferences
 */
export function saveSessionPreferences(preferences = {}) {
  return writeSessionStore({ preferences });
}

function readStoredSession() {
  const sessionFile = getSessionFile();
  if (!fs.existsSync(sessionFile)) return null;
  const content = fs.readFileSync(sessionFile, 'utf-8');
  return JSON.parse(content);
}

/**
 * @param {{ session?: object | null, preferences?: { model?: string | null, modelLabel?: string | null } | null }} [options]
 */
function writeSessionStore(options = {}) {
  const { session, preferences } = options;
  ensureDir();

  const existing = readStoredSession() || {};
  const nextSession = session === undefined ? existing.session : session;
  const nextPreferences = preferences === undefined
    ? existing.preferences
    : {
        ...(existing.preferences || {}),
        ...preferences,
      };

  const stored = {
    session: nextSession,
    preferences: nextPreferences,
    storedAt: Date.now(),
  };

  fs.writeFileSync(getSessionFile(), JSON.stringify(stored, null, 2), { mode: 0o600 });
  return stored;
}

/**
 * Load the stored auth session from disk.
 * Returns null if no session exists or if it's invalid.
 * @returns {object | null}
 */
export function loadSession() {
  try {
    const stored = readStoredSession();
    if (!stored) return null;

    if (!stored?.session?.authToken || !stored?.session?.user) {
      return null;
    }

    return stored.session;
  } catch {
    return null;
  }
}

/**
 * Load stored CLI preferences from the current profile's session file.
 * @returns {{ model: string | null, modelLabel: string | null } | null}
 */
export function loadSessionPreferences() {
  try {
    const stored = readStoredSession();
    const modelSelection = createModelSelection({
      id: stored?.preferences?.model,
      label: stored?.preferences?.modelLabel,
    });
    return {
      model: modelSelection.id,
      modelLabel: modelSelection.label,
    };
  } catch {
    const modelSelection = createModelSelection({
      id: resolveModelId(null),
      label: null,
    });
    return {
      model: modelSelection.id,
      modelLabel: modelSelection.label,
    };
  }
}

/**
 * Clear the stored session file.
 */
export function clearSession() {
  try {
    const stored = readStoredSession();
    if (!stored) return;

    const hasPreferences = stored.preferences && typeof stored.preferences === 'object'
      && Object.keys(stored.preferences).length > 0;

    if (hasPreferences) {
      writeSessionStore({ session: null, preferences: stored.preferences });
      return;
    }

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
