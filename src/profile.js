/**
 * profile.js — Multi-profile storage manager for EmblemAI CLI
 *
 * Centralizes profile-aware filesystem paths, active profile state,
 * metadata, and legacy single-wallet migration.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export const EMBLEMAI_ROOT = path.join(os.homedir(), '.emblemai');
export const PROFILES_DIR = path.join(EMBLEMAI_ROOT, 'profiles');
export const ACTIVE_PROFILE_FILE = path.join(EMBLEMAI_ROOT, 'active-profile');
export const LEGACY_CUSTOM_PLUGINS_FILE = path.join(os.homedir(), '.emblemai-plugins.json');
export const DEFAULT_PROFILE = 'default';

const PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

let _currentProfile = DEFAULT_PROFILE;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listProfileNames() {
  if (!fs.existsSync(PROFILES_DIR)) return [];

  return fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function resolveConfiguredProfileName() {
  const stored = getStoredActiveProfile();
  if (stored && profileExists(stored)) return stored;

  const profiles = listProfileNames();
  if (profiles.length === 1) return profiles[0];

  return null;
}

function buildMetadata(name, metadata = {}) {
  return {
    name,
    label: metadata.label || name,
    purpose: metadata.purpose || '',
    createdAt: metadata.createdAt || new Date().toISOString(),
    policy: metadata.policy || null,
    ...metadata,
  };
}

function moveFileOrDir(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
  try {
    fs.renameSync(src, dst);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(src, dst, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

function mergeDirectory(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true, mode: 0o700 });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);

    if (entry.isDirectory()) {
      mergeDirectory(srcPath, dstPath);
      continue;
    }

    if (!fs.existsSync(dstPath)) {
      moveFileOrDir(srcPath, dstPath);
    }
  }

  try {
    if (fs.readdirSync(srcDir).length === 0) {
      fs.rmdirSync(srcDir);
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Validate a profile name and return the normalized value.
 *
 * @param {string} name
 * @returns {string}
 */
export function validateProfileName(name) {
  const normalized = String(name || '').trim();
  if (!normalized) {
    throw new Error('Profile name is required.');
  }
  if (!PROFILE_NAME_RE.test(normalized)) {
    throw new Error('Invalid profile name. Use letters, numbers, hyphens, or underscores.');
  }
  return normalized;
}

/**
 * Persist the runtime-selected profile for path resolution.
 *
 * @param {string} name
 * @returns {string}
 */
export function setCurrentProfile(name) {
  _currentProfile = validateProfileName(name);
  return _currentProfile;
}

/**
 * Get the runtime-selected profile.
 *
 * @returns {string}
 */
export function getCurrentProfile() {
  return _currentProfile;
}

/**
 * Ensure the EmblemAI root directory exists.
 */
export function ensureRootDir() {
  fs.mkdirSync(EMBLEMAI_ROOT, { recursive: true, mode: 0o700 });
}

/**
 * Ensure the profiles root directory exists.
 */
export function ensureProfilesDir() {
  ensureRootDir();
  fs.mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Get the root directory for a profile.
 *
 * @param {string} [profileName]
 * @returns {string}
 */
export function profileDir(profileName = _currentProfile) {
  return path.join(PROFILES_DIR, validateProfileName(profileName));
}

/**
 * Get a specific path inside a profile directory.
 *
 * @param {string} [profileName]
 * @param {...string} segments
 * @returns {string}
 */
export function profilePath(profileName = _currentProfile, ...segments) {
  return path.join(profileDir(profileName), ...segments);
}

/**
 * Get all storage paths for a profile.
 *
 * @param {string} [profileName]
 * @returns {{
 *   root: string,
 *   profilesDir: string,
 *   profile: string,
 *   metadata: string,
 *   session: string,
 *   env: string,
 *   envKeys: string,
 *   secrets: string,
 *   plugins: string,
 *   x402Favorites: string,
 *   historyDir: string,
 * }}
 */
export function getProfilePaths(profileName = _currentProfile) {
  const name = validateProfileName(profileName);
  const profile = profileDir(name);
  return {
    root: EMBLEMAI_ROOT,
    profilesDir: PROFILES_DIR,
    profile,
    metadata: path.join(profile, 'metadata.json'),
    session: path.join(profile, 'session.json'),
    env: path.join(profile, '.env'),
    envKeys: path.join(profile, '.env.keys'),
    secrets: path.join(profile, 'secrets.json'),
    plugins: path.join(profile, 'plugins.json'),
    x402Favorites: path.join(profile, 'x402-favorites.json'),
    historyDir: path.join(profile, 'history'),
  };
}

/**
 * Get the legacy flat-layout storage paths.
 *
 * @returns {{
 *   root: string,
 *   session: string,
 *   env: string,
 *   envKeys: string,
 *   secrets: string,
 *   historyDir: string,
 *   x402Favorites: string,
 *   plugins: string,
 * }}
 */
export function getLegacyFlatPaths() {
  return {
    root: EMBLEMAI_ROOT,
    session: path.join(EMBLEMAI_ROOT, 'session.json'),
    env: path.join(EMBLEMAI_ROOT, '.env'),
    envKeys: path.join(EMBLEMAI_ROOT, '.env.keys'),
    secrets: path.join(EMBLEMAI_ROOT, 'secrets.json'),
    historyDir: path.join(EMBLEMAI_ROOT, 'history'),
    x402Favorites: path.join(EMBLEMAI_ROOT, 'x402-favorites.json'),
    plugins: LEGACY_CUSTOM_PLUGINS_FILE,
  };
}

/**
 * Ensure a profile directory and metadata file exist.
 *
 * @param {string} [profileName]
 * @param {object} [metadata]
 * @returns {object}
 */
export function ensureProfileDir(profileName = _currentProfile, metadata = {}) {
  const name = validateProfileName(profileName);
  const paths = getProfilePaths(name);
  ensureProfilesDir();

  if (!fs.existsSync(paths.profile)) {
    fs.mkdirSync(paths.profile, { recursive: true, mode: 0o700 });
  }

  if (!fs.existsSync(paths.metadata)) {
    const meta = buildMetadata(name, metadata);
    fs.writeFileSync(paths.metadata, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    return meta;
  }

  try {
    return readJson(paths.metadata);
  } catch {
    const meta = buildMetadata(name, metadata);
    fs.writeFileSync(paths.metadata, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    return meta;
  }
}

/**
 * Check whether a profile exists on disk.
 *
 * @param {string} profileName
 * @returns {boolean}
 */
export function profileExists(profileName) {
  return fs.existsSync(profileDir(profileName));
}

/**
 * Read the persisted active profile name.
 *
 * @returns {string | null}
 */
export function getStoredActiveProfile() {
  try {
    if (!fs.existsSync(ACTIVE_PROFILE_FILE)) return null;
    const value = fs.readFileSync(ACTIVE_PROFILE_FILE, 'utf8').trim();
    if (!value) return null;
    return validateProfileName(value);
  } catch {
    return null;
  }
}

/**
 * Resolve the active profile.
 * Priority: explicit flag > active-profile file > single existing profile > default
 *
 * @param {string | null | undefined} flagValue
 * @param {{ allowAmbiguous?: boolean, requireExists?: boolean }} [options]
 * @returns {string | null}
 */
export function resolveProfile(flagValue, options = {}) {
  const { allowAmbiguous = false, requireExists = false } = options;

  if (flagValue) {
    const name = validateProfileName(flagValue);
    if (requireExists && !profileExists(name)) {
      throw new Error(`Profile "${name}" does not exist. Create it first with \`emblemai profile create ${name}\`.`);
    }
    return name;
  }

  const configured = resolveConfiguredProfileName();
  if (configured) return configured;

  if (listProfileNames().length === 0) return DEFAULT_PROFILE;

  if (allowAmbiguous) return null;

  throw new Error('Multiple profiles exist but no active profile is set. Use `emblemai profile use <name>` or pass `--profile <name>`.');
}

/**
 * Set the persisted active profile.
 *
 * @param {string} profileName
 * @returns {string}
 */
export function setActiveProfile(profileName) {
  const name = validateProfileName(profileName);
  if (!profileExists(name)) {
    throw new Error(`Profile "${name}" does not exist.`);
  }
  ensureRootDir();
  fs.writeFileSync(ACTIVE_PROFILE_FILE, name + '\n', 'utf8');
  return name;
}

/**
 * Read metadata for a profile.
 *
 * @param {string} profileName
 * @returns {object | null}
 */
export function readProfileMetadata(profileName) {
  const name = validateProfileName(profileName);
  const { metadata } = getProfilePaths(name);
  if (!fs.existsSync(metadata)) return null;
  try {
    return readJson(metadata);
  } catch {
    return buildMetadata(name);
  }
}

/**
 * Write profile metadata.
 *
 * @param {string} profileName
 * @param {object} metadata
 * @returns {object}
 */
export function writeProfileMetadata(profileName, metadata) {
  const name = validateProfileName(profileName);
  ensureProfileDir(name);
  const merged = buildMetadata(name, {
    ...(readProfileMetadata(name) || {}),
    ...metadata,
  });
  fs.writeFileSync(getProfilePaths(name).metadata, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

/**
 * Create a new named profile.
 *
 * @param {string} profileName
 * @param {object} [metadata]
 * @returns {object}
 */
export function createProfile(profileName, metadata = {}) {
  const name = validateProfileName(profileName);
  if (profileExists(name)) {
    throw new Error(`Profile "${name}" already exists.`);
  }

  ensureProfileDir(name, metadata);
  if (!getStoredActiveProfile() && listProfileNames().length === 1) {
    setActiveProfile(name);
  }
  return inspectProfile(name);
}

/**
 * List all profiles.
 *
 * @returns {Array<object>}
 */
export function listProfiles() {
  const activeName = resolveConfiguredProfileName();

  return listProfileNames()
    .map((name) => {
      const info = inspectProfile(name);
      return { ...info, active: name === activeName };
    });
}

/**
 * Inspect a single profile from local filesystem state.
 *
 * @param {string} profileName
 * @returns {object}
 */
export function inspectProfile(profileName) {
  const name = validateProfileName(profileName);
  const paths = getProfilePaths(name);
  const metadata = readProfileMetadata(name) || buildMetadata(name);

  let stored = null;
  if (fs.existsSync(paths.session)) {
    try {
      stored = readJson(paths.session);
    } catch {
      stored = null;
    }
  }

  const historyCount = fs.existsSync(paths.historyDir)
    ? fs.readdirSync(paths.historyDir).filter((entry) => entry.endsWith('.json')).length
    : 0;

  return {
    name,
    path: paths.profile,
    metadata,
    session: stored?.session
      ? {
          vaultId: stored.session.user?.vaultId || null,
          identifier: stored.session.user?.identifier || null,
          authType: stored.session.authType || null,
          expiresAt: stored.session.expiresAt || null,
          storedAt: stored.storedAt || null,
        }
      : null,
    files: {
      env: fs.existsSync(paths.env),
      envKeys: fs.existsSync(paths.envKeys),
      secrets: fs.existsSync(paths.secrets),
      session: fs.existsSync(paths.session),
      plugins: fs.existsSync(paths.plugins),
      x402Favorites: fs.existsSync(paths.x402Favorites),
      history: fs.existsSync(paths.historyDir),
    },
    historyCount,
    active: name === resolveConfiguredProfileName(),
  };
}

/**
 * Delete a profile from disk.
 *
 * @param {string} profileName
 */
export function deleteProfile(profileName) {
  const name = validateProfileName(profileName);
  const currentName = getCurrentProfile();
  const storedActiveName = getStoredActiveProfile();

  if (!profileExists(name)) {
    throw new Error(`Profile "${name}" does not exist.`);
  }
  if (name === currentName || name === storedActiveName) {
    throw new Error(`Cannot delete active profile "${name}".`);
  }

  fs.rmSync(profileDir(name), { recursive: true, force: false });
}

/**
 * Check if more than one profile exists.
 *
 * @returns {boolean}
 */
export function hasMultipleProfiles() {
  return listProfiles().length > 1;
}

/**
 * Migrate the legacy flat ~/.emblemai layout into profiles/default.
 *
 * @returns {boolean}
 */
export function migrateLegacyProfileLayout() {
  const legacy = getLegacyFlatPaths();
  const hasLegacyState = [
    legacy.session,
    legacy.env,
    legacy.envKeys,
    legacy.secrets,
    legacy.historyDir,
    legacy.x402Favorites,
    legacy.plugins,
  ].some((filePath) => fs.existsSync(filePath));

  if (!hasLegacyState) return false;

  const defaultPaths = getProfilePaths(DEFAULT_PROFILE);
  ensureProfileDir(DEFAULT_PROFILE, {
    label: 'Default Profile',
    purpose: 'Migrated from single-wallet layout',
    migratedFrom: 'legacy-flat-layout',
  });

  const filesToMove = [
    ['session', legacy.session, defaultPaths.session],
    ['env', legacy.env, defaultPaths.env],
    ['envKeys', legacy.envKeys, defaultPaths.envKeys],
    ['secrets', legacy.secrets, defaultPaths.secrets],
    ['x402Favorites', legacy.x402Favorites, defaultPaths.x402Favorites],
    ['plugins', legacy.plugins, defaultPaths.plugins],
  ];

  for (const [, src, dst] of filesToMove) {
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    moveFileOrDir(src, dst);
  }

  const sensitiveFiles = [
    defaultPaths.session,
    defaultPaths.env,
    defaultPaths.envKeys,
    defaultPaths.secrets,
  ];
  for (const filePath of sensitiveFiles) {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o600);
    }
  }

  if (fs.existsSync(legacy.historyDir)) {
    mergeDirectory(legacy.historyDir, defaultPaths.historyDir);
  }

  if (!getStoredActiveProfile()) {
    setActiveProfile(DEFAULT_PROFILE);
  }

  return true;
}

export default {
  ACTIVE_PROFILE_FILE,
  DEFAULT_PROFILE,
  EMBLEMAI_ROOT,
  LEGACY_CUSTOM_PLUGINS_FILE,
  PROFILES_DIR,
  createProfile,
  deleteProfile,
  ensureProfileDir,
  ensureProfilesDir,
  ensureRootDir,
  getCurrentProfile,
  getLegacyFlatPaths,
  getProfilePaths,
  getStoredActiveProfile,
  hasMultipleProfiles,
  inspectProfile,
  listProfiles,
  migrateLegacyProfileLayout,
  profileDir,
  profileExists,
  profilePath,
  readProfileMetadata,
  resolveProfile,
  setActiveProfile,
  setCurrentProfile,
  validateProfileName,
  writeProfileMetadata,
};
