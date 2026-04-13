import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'emblemai-safe-tests-'));
process.env.HOME = TEST_HOME;

const profile = await import('../src/profile.js');
const safe = await import('../src/safe-store.js');

function resetHomeState() {
  fs.rmSync(path.join(TEST_HOME, '.emblemai'), { recursive: true, force: true });
  profile.setCurrentProfile(profile.DEFAULT_PROFILE);
}

// ── safeList ────────────────────────────────────────────────────────────────

test('safeList on empty safe returns empty array', () => {
  resetHomeState();
  profile.ensureProfileDir('kv-empty');
  assert.deepEqual(safe.safeList({ profileName: 'kv-empty' }), []);
});

test('safeList returns sorted names', () => {
  resetHomeState();
  profile.ensureProfileDir('kv-list');
  const safePath = profile.getProfilePaths('kv-list').safe;
  fs.writeFileSync(safePath, JSON.stringify({
    entries: {
      zebra: { ciphertext: 'z', dataToEncryptHash: 'z' },
      alpha: { ciphertext: 'a', dataToEncryptHash: 'a' },
      middle: { ciphertext: 'm', dataToEncryptHash: 'm' },
    },
  }), 'utf8');

  assert.deepEqual(safe.safeList({ profileName: 'kv-list' }), ['alpha', 'middle', 'zebra']);
});

// ── safeDelete ──────────────────────────────────────────────────────────────

test('safeDelete removes entry', () => {
  resetHomeState();
  profile.ensureProfileDir('kv-del');
  const safePath = profile.getProfilePaths('kv-del').safe;
  fs.writeFileSync(safePath, JSON.stringify({
    entries: { keep: { ciphertext: 'k' }, remove: { ciphertext: 'r' } },
  }), 'utf8');

  assert.equal(safe.safeDelete('remove', { profileName: 'kv-del' }), true);
  assert.deepEqual(safe.safeList({ profileName: 'kv-del' }), ['keep']);
});

test('safeDelete on missing entry returns false', () => {
  resetHomeState();
  profile.ensureProfileDir('kv-del2');
  assert.equal(safe.safeDelete('nonexistent', { profileName: 'kv-del2' }), false);
});

// ── safe.json file permissions ──────────────────────────────────────────────

test('writeSafeFile sets 0o600 permissions', () => {
  resetHomeState();
  profile.ensureProfileDir('kv-perms');
  const safePath = profile.getProfilePaths('kv-perms').safe;
  fs.writeFileSync(safePath, JSON.stringify({
    entries: { test: { ciphertext: 't', dataToEncryptHash: 't' } },
  }), 'utf8');

  // safeDelete triggers writeSafeFile internally
  safe.safeDelete('test', { profileName: 'kv-perms' });
  const stat = fs.statSync(safePath);
  assert.equal(stat.mode & 0o777, 0o600);
});

// ── Cleanup ─────────────────────────────────────────────────────────────────

test.after(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});
