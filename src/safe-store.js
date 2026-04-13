/**
 * safe-store.js — Encrypted safe for EmblemAI CLI
 *
 * General-purpose encrypted key-value secret store.
 * Each entry individually encrypted using @emblemvault/auth-sdk crypto (vault PKP).
 * Same password = same vault = same keys = decryptable on any machine.
 * Compatible with EmblemAI terminal and all SDK consumers.
 *
 * Features:
 *   - KV secret store (set/get/list/delete)
 *   - Cloud sync via Hustle Memory API (push/pull) — syncs safe.json only
 *   - HTTPS enforced on cloud API URLs
 */

import fs from 'fs';
import { getProfilePaths, ensureProfileDir, getCurrentProfile } from './profile.js';

// ── auth-sdk crypto wrappers ────────────────────────────────────────────────

async function sdkEncrypt(plaintext, authSdk) {
  const { encrypt } = await import('@emblemvault/auth-sdk/crypto');
  return encrypt(plaintext, { config: { sdk: authSdk } });
}

async function sdkDecrypt(encrypted, authSdk) {
  const { decrypt } = await import('@emblemvault/auth-sdk/crypto');
  return decrypt({
    config: { sdk: authSdk },
    ciphertext: encrypted.ciphertext,
    dataToEncryptHash: encrypted.dataToEncryptHash,
  });
}

// ── URL Validation ──────────────────────────────────────────────────────────

function requireSecureUrl(url) {
  if (url.startsWith('https://')) return;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return;
  } catch { /* fall through */ }
  throw new Error('Cloud API URL must use HTTPS. Use --api-url with an https:// URL.');
}

// ── Safe File I/O ───────────────────────────────────────────────────────────

function readSafeFile(profileName = getCurrentProfile()) {
  const safePath = getProfilePaths(profileName).safe;
  if (!safePath || !fs.existsSync(safePath)) return { entries: {} };
  try {
    return { entries: JSON.parse(fs.readFileSync(safePath, 'utf8')).entries || {} };
  } catch {
    return { entries: {} };
  }
}

function writeSafeFile(data, profileName = getCurrentProfile()) {
  ensureProfileDir(profileName);
  const safePath = getProfilePaths(profileName).safe;
  fs.writeFileSync(safePath, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(safePath, 0o600);
}

// ── KV Operations ───────────────────────────────────────────────────────────

/**
 * Store a secret in the encrypted safe.
 * @param {string} name
 * @param {string} value
 * @param {object} authSdk
 * @param {{ profileName?: string }} [options]
 */
export async function safeSet(name, value, authSdk, options = {}) {
  if (!name || !name.trim()) throw new Error('Secret name is required.');
  if (!value && value !== '') throw new Error('Secret value is required.');

  const profileName = options.profileName || getCurrentProfile();
  const data = readSafeFile(profileName);
  data.entries[name.trim()] = await sdkEncrypt(String(value), authSdk);
  writeSafeFile(data, profileName);
}

/**
 * Retrieve a secret from the encrypted safe.
 * @param {string} name
 * @param {object} authSdk
 * @param {{ profileName?: string }} [options]
 * @returns {Promise<string | null>}
 */
export async function safeGet(name, authSdk, options = {}) {
  if (!name) throw new Error('Secret name is required.');

  const profileName = options.profileName || getCurrentProfile();
  const data = readSafeFile(profileName);
  const entry = data.entries[name.trim()];
  if (!entry) return null;

  return sdkDecrypt(entry, authSdk);
}

/**
 * List all secret names in the safe.
 * @param {{ profileName?: string }} [options]
 * @returns {string[]}
 */
export function safeList(options = {}) {
  const profileName = options.profileName || getCurrentProfile();
  return Object.keys(readSafeFile(profileName).entries).sort();
}

/**
 * Delete a secret from the safe.
 * @param {string} name
 * @param {{ profileName?: string }} [options]
 * @returns {boolean}
 */
export function safeDelete(name, options = {}) {
  if (!name) throw new Error('Secret name is required.');

  const profileName = options.profileName || getCurrentProfile();
  const data = readSafeFile(profileName);
  const trimmed = name.trim();
  if (!(trimmed in data.entries)) return false;

  delete data.entries[trimmed];
  writeSafeFile(data, profileName);
  return true;
}

// ── Cloud Sync (safe.json only via Hustle Memory API) ───────────────────────

const DEFAULT_API_URL = 'https://emblemvault.ai';
const SAFE_STORE_CATEGORY = '_safe-store';

function memoryHeaders(apiKey) {
  return { 'Content-Type': 'application/json', 'x-api-key': apiKey };
}

/**
 * Push the safe to the cloud. Encrypts safe.json as a single blob.
 * @param {object} authSdk
 * @param {{ profileName?: string, apiUrl?: string }} [options]
 */
export async function pushToCloud(authSdk, options = {}) {
  const profileName = options.profileName || getCurrentProfile();
  const apiUrl = options.apiUrl || DEFAULT_API_URL;
  requireSecureUrl(apiUrl);

  const data = readSafeFile(profileName);
  const count = Object.keys(data.entries).length;
  if (count === 0) throw new Error('Safe is empty — nothing to push.');

  const apiKey = await authSdk.getVaultApiKey();
  const encrypted = await sdkEncrypt(JSON.stringify(data), authSdk);
  const headers = memoryHeaders(apiKey);

  // Replace existing entry
  await fetch(`${apiUrl}/api/memory`, {
    method: 'DELETE', headers,
    body: JSON.stringify({ category: SAFE_STORE_CATEGORY }),
  }).catch(() => {});

  const res = await fetch(`${apiUrl}/api/memory`, {
    method: 'POST', headers,
    body: JSON.stringify({
      category: SAFE_STORE_CATEGORY,
      content: JSON.stringify(encrypted),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cloud push failed (${res.status}): ${body || res.statusText}`);
  }

  return { ok: true, count };
}

/**
 * Pull the safe from the cloud. Decrypts and writes safe.json.
 * @param {object} authSdk
 * @param {{ profileName?: string, apiUrl?: string }} [options]
 * @returns {Promise<{ count: number } | null>}
 */
export async function pullFromCloud(authSdk, options = {}) {
  const profileName = options.profileName || getCurrentProfile();
  const apiUrl = options.apiUrl || DEFAULT_API_URL;
  requireSecureUrl(apiUrl);

  const apiKey = await authSdk.getVaultApiKey();
  const res = await fetch(`${apiUrl}/api/memory?category=${SAFE_STORE_CATEGORY}&limit=1`, {
    method: 'GET', headers: memoryHeaders(apiKey),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cloud pull failed (${res.status}): ${body || res.statusText}`);
  }

  const data = await res.json();
  const memories = data?.data?.memories || data?.data?.items || [];
  if (memories.length === 0) return null;

  let encrypted;
  try { encrypted = JSON.parse(memories[0].content); }
  catch { throw new Error('Cloud safe data is corrupt.'); }

  if (!encrypted?.ciphertext) throw new Error('Cloud safe data is missing ciphertext.');

  const plaintext = await sdkDecrypt(encrypted, authSdk);
  const safeData = JSON.parse(plaintext);
  writeSafeFile(safeData, profileName);

  return { count: Object.keys(safeData.entries || {}).length };
}

export default {
  safeSet, safeGet, safeList, safeDelete,
  pushToCloud, pullFromCloud,
};
