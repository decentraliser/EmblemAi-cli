import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'emblemai-tests-'));
process.env.HOME = TEST_HOME;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = path.join(REPO_ROOT, 'emblemai.js');

const profile = await import('../src/profile.js');
const { processCommand } = await import('../src/commands.js');
const sessionStore = await import('../src/session-store.js');
const modelHelpers = await import('../src/models.js');

const EMBLEMAI_DIR = path.join(TEST_HOME, '.emblemai');
const LEGACY_PLUGINS_FILE = path.join(TEST_HOME, '.emblemai-plugins.json');

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function resetHomeState() {
  fs.rmSync(EMBLEMAI_DIR, { recursive: true, force: true });
  fs.rmSync(LEGACY_PLUGINS_FILE, { force: true });
  profile.setCurrentProfile(profile.DEFAULT_PROFILE);
}

function makeCtx(overrides = {}) {
  const outputs = [];
  const ctx = {
    profileName: 'default',
    activeProfileName: 'default',
    authSdk: {
      async getVaultInfo() {
        return {
          vaultId: '7315642221',
          evmAddress: '0x0E06800bD4274aAAb3127e60dD281d520ee405dA',
          solanaAddress: 'EM5EJQL4oFkC3Zzs9prqFgBQasN4Xud9YnLwUFFwzzi',
        };
      },
      getSession() {
        return { user: { vaultId: '7315642221' } };
      },
    },
    history: { messages: [] },
    settings: {
      selectedTools: [],
      model: null,
      modelLabel: null,
      stream: true,
      debug: false,
      retainHistory: true,
      glowEnabled: true,
      log: false,
    },
    lastModelSearchResults: [],
    client: {
      async getPaygStatus() {
        return {
          enabled: true,
          mode: 'debt_accumulation',
          payment_token: 'SOL',
          payment_chain: 'solana',
          is_blocked: false,
          total_debt_usd: 12.34,
          total_paid_usd: 56.78,
          debt_ceiling_usd: 100,
          pending_charges: 2,
          available_tokens: ['SOL', 'ETH', 'HUSTLE'],
        };
      },
      async configurePayg() {
        return { success: true };
      },
    },
    LOG_FILE: '/tmp/test.log',
    appendMessage: (_role, content) => outputs.push(content),
    addLog: () => {},
    promptText: async () => 'n',
    setModel: async (model) => {
      ctx.settings.model = model.id;
      ctx.settings.modelLabel = model.label;
    },
    ...overrides,
  };

  return { ctx, outputs };
}

test.beforeEach(() => {
  resetHomeState();
});

test.after(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

test('creates profiles, persists default selection, and resolves the active profile', () => {
  const created = profile.createProfile('default', { label: 'Default Profile' });
  profile.createProfile('treasury');
  profile.setActiveProfile('treasury');

  const listed = profile.listProfiles();

  assert.equal(created.name, 'default');
  assert.equal(profile.resolveProfile(), 'treasury');
  assert.equal(profile.getStoredActiveProfile(), 'treasury');
  assert.deepEqual(
    listed.map((entry) => ({ name: entry.name, active: entry.active })),
    [
      { name: 'default', active: false },
      { name: 'treasury', active: true },
    ]
  );
});

test('fails closed when multiple profiles exist but no active profile is configured', () => {
  profile.createProfile('default');
  profile.createProfile('treasury');
  fs.rmSync(path.join(EMBLEMAI_DIR, 'active-profile'), { force: true });

  assert.throws(
    () => profile.resolveProfile(),
    /Multiple profiles exist but no active profile is set/
  );
});

test('rejects explicit selection of a profile that does not exist', () => {
  profile.createProfile('default');

  assert.throws(
    () => profile.resolveProfile('treasury', { requireExists: true }),
    /Profile "treasury" does not exist/
  );
});

test('migrates the flat legacy layout into profiles/default', () => {
  fs.mkdirSync(path.join(EMBLEMAI_DIR, 'history'), { recursive: true });
  fs.writeFileSync(path.join(EMBLEMAI_DIR, 'session.json'), '{"session":{"user":{"vaultId":"vault-123"}}}');
  fs.writeFileSync(path.join(EMBLEMAI_DIR, '.env'), 'EMBLEM_PASSWORD=encrypted\n');
  fs.writeFileSync(path.join(EMBLEMAI_DIR, '.env.keys'), 'DOTENV_PRIVATE_KEY=key\n');
  fs.writeFileSync(path.join(EMBLEMAI_DIR, 'secrets.json'), '{"secret":true}\n');
  fs.writeFileSync(path.join(EMBLEMAI_DIR, 'x402-favorites.json'), '{"favorite":true}\n');
  fs.writeFileSync(path.join(EMBLEMAI_DIR, 'history', 'vault-123.json'), '{"messages":[]}\n');
  fs.writeFileSync(LEGACY_PLUGINS_FILE, '[]\n');

  const migrated = profile.migrateLegacyProfileLayout();
  const defaultPaths = profile.getProfilePaths('default');

  assert.equal(migrated, true);
  assert.equal(profile.getStoredActiveProfile(), 'default');
  assert.equal(fs.existsSync(defaultPaths.session), true);
  assert.equal(fs.existsSync(defaultPaths.env), true);
  assert.equal(fs.existsSync(defaultPaths.envKeys), true);
  assert.equal(fs.existsSync(defaultPaths.secrets), true);
  assert.equal(fs.existsSync(defaultPaths.plugins), true);
  assert.equal(fs.existsSync(defaultPaths.x402Favorites), true);
  assert.equal(fs.existsSync(path.join(defaultPaths.historyDir, 'vault-123.json')), true);
});

test('migrateLegacyProfileLayout tightens migrated credential file permissions to 0600', () => {
  fs.mkdirSync(path.join(EMBLEMAI_DIR, 'history'), { recursive: true });

  const legacySession = path.join(EMBLEMAI_DIR, 'session.json');
  const legacyEnv = path.join(EMBLEMAI_DIR, '.env');
  const legacyEnvKeys = path.join(EMBLEMAI_DIR, '.env.keys');
  const legacySecrets = path.join(EMBLEMAI_DIR, 'secrets.json');

  fs.writeFileSync(legacySession, '{"session":{"user":{"vaultId":"vault-123"}}}');
  fs.writeFileSync(legacyEnv, 'EMBLEM_PASSWORD=encrypted\n');
  fs.writeFileSync(legacyEnvKeys, 'DOTENV_PRIVATE_KEY=key\n');
  fs.writeFileSync(legacySecrets, '{"secret":true}\n');

  for (const filePath of [legacySession, legacyEnv, legacyEnvKeys, legacySecrets]) {
    fs.chmodSync(filePath, 0o664);
  }

  profile.migrateLegacyProfileLayout();
  const defaultPaths = profile.getProfilePaths('default');

  for (const filePath of [defaultPaths.session, defaultPaths.env, defaultPaths.envKeys, defaultPaths.secrets]) {
    const mode = fs.statSync(filePath).mode & 0o777;
    assert.equal(mode, 0o600);
  }
});

test('profile commands switch the live session profile', async () => {
  profile.createProfile('default', {
    label: 'Default Profile',
    purpose: 'Migrated from single-wallet layout',
  });
  profile.createProfile('treasury');
  profile.setActiveProfile('default');
  sessionStore.saveSessionPreferences({ model: 'openai/gpt-4.1', modelLabel: 'OpenAI: GPT-4.1' });

  profile.setCurrentProfile('treasury');
  sessionStore.saveSessionPreferences({ model: 'qwen/qwen3.6-plus-preview:free', modelLabel: 'Qwen: Qwen3.6 Plus Preview (free)' });
  profile.setCurrentProfile('default');

  const { ctx, outputs } = makeCtx();
  ctx.switchProfile = async (name) => {
    profile.setCurrentProfile(name);
    profile.setActiveProfile(name);
    ctx.profileName = name;
    ctx.activeProfileName = name;
    return { profileName: name };
  };

  await processCommand('/profile list', ctx);
  await processCommand('/profile inspect', ctx);
  await processCommand('/profile use treasury', ctx);
  await processCommand('/profile inspect', ctx);
  await processCommand('/profile inspect default', ctx);
  await processCommand('/settings', ctx);

  const joined = stripAnsi(outputs.join('\n---\n'));

  assert.match(joined, /default \[current, default\]/);
  assert.match(joined, /default \[current, default\] · OpenAI: GPT-4\.1 \(openai\/gpt-4\.1\)/);
  assert.match(joined, /Switched this session and new sessions to profile "treasury"\./);
  assert.match(joined, /Profile: default \[current, default\]/);
  assert.match(joined, /Profile: treasury \[current, default\]/);
  assert.match(joined, /Model:\s+OpenAI: GPT-4\.1 \(openai\/gpt-4\.1\)/);
  assert.match(joined, /Model:\s+Qwen: Qwen3\.6 Plus Preview \(free\) \(qwen\/qwen3\.6-plus-preview:free\)/);
  assert.match(joined, /This Session:\s+YES/);
  assert.match(joined, /MPP State:\s+missing/);
  assert.doesNotMatch(joined, /Profile Drift:/);
  assert.match(joined, /Session Profile:\s+treasury/);
  assert.match(joined, /Default Profile:\s+treasury/);
});

test('payment help and status explain debt_accumulation and token behavior', async () => {
  const { ctx, outputs } = makeCtx();

  await processCommand('/help', ctx);
  await processCommand('/payment', ctx);
  await processCommand('/payment mode debt_accumulation', ctx);

  const joined = stripAnsi(outputs.join('\n---\n'));

  assert.match(joined, /\/payment\s+Show PAYG status, mode guide, and token usage/);
  assert.match(joined, /\/payment mode <M>\s+Set mode: pay_per_request or debt_accumulation/);
  assert.match(joined, /How PAYG Works/);
  assert.match(joined, /Selected Token:\s+SOL on solana is the asset used when PAYG settles charges\./);
  assert.match(joined, /Current Mode:\s+Requests can accrue debt until the server-side debt ceiling is reached/);
  assert.match(joined, /pay_per_request:\s+Settle each paid request immediately\./);
  assert.match(joined, /debt_accumulation:\s+Allow debt to build up until the server-side ceiling is reached\./);
  assert.match(joined, /Payment mode set to: debt_accumulation/);
});

test('model preferences persist in session store without losing auth session', () => {
  const authSession = {
    authToken: 'token-123',
    user: { vaultId: 'vault-123', identifier: 'user-123' },
    expiresAt: Date.now() + 60_000,
  };

  sessionStore.saveSession(authSession);
  sessionStore.saveSessionPreferences({ model: 'openai/gpt-4.1' });

  const storedSession = sessionStore.loadSession();
  const storedPreferences = sessionStore.loadSessionPreferences();

  assert.equal(storedSession.authToken, 'token-123');
  assert.equal(storedPreferences.model, 'openai/gpt-4.1');

  sessionStore.clearSession();

  assert.equal(sessionStore.loadSession(), null);
  assert.equal(sessionStore.loadSessionPreferences().model, 'openai/gpt-4.1');
});

test('model helpers format price, trim descriptions, and build openrouter urls', () => {
  const model = {
    id: 'deepseek/deepseek-v3.2',
    canonical_slug: 'deepseek/deepseek-v3.2',
    pricing: { prompt: '0.00000026', completion: '0.00000038' },
    description: 'x'.repeat(260),
  };

  const normalized = {
    id: model.id,
    canonicalSlug: model.canonical_slug,
    promptPrice: Number(model.pricing.prompt),
    completionPrice: Number(model.pricing.completion),
    url: modelHelpers.getOpenRouterModelUrl(model),
    description: model.description,
  };

  assert.equal(modelHelpers.getOpenRouterModelUrl(model), 'https://openrouter.ai/deepseek/deepseek-v3.2');
  assert.equal(modelHelpers.formatModelPrice(normalized), '$0.26/M in · $0.38/M out');
  assert.equal(modelHelpers.trimModelDescription(normalized.description, 200).length, 200);
});

test('model commands update the active model and show default choices', async () => {
  const { ctx, outputs } = makeCtx();

  await processCommand('/models', ctx);
  await processCommand('/model', ctx);
  await processCommand('/models use 2', ctx);
  await processCommand('/model', ctx);
  await processCommand('/model clear', ctx);
  await processCommand('/model', ctx);

  const joined = stripAnsi(outputs.join('\n---\n'));

  assert.match(joined, /Model Selection/);
  assert.match(joined, /Default Models/);
  assert.match(joined, /Anthropic: Claude Sonnet 4\.6/);
  assert.match(joined, /Search OpenRouter with \/models search <query>\./);
  assert.match(joined, /https:\/\/openrouter\.ai\/anthropic\/claude.*sonnet/);
  assert.match(joined, /Current model:\s+MoonshotAI: Kimi K2\.5 \(moonshotai\/kimi-k2\.5\) \(default\)/);
  assert.match(joined, /Model set to: anthropic\/claude-sonnet-4\.6 \(Anthropic: Claude Sonnet 4\.6\)/);
  assert.match(joined, /Current model:\s+Anthropic: Claude Sonnet 4\.6 \(anthropic\/claude-sonnet-4\.6\)/);
  assert.match(joined, /Model reset to default: moonshotai\/kimi-k2\.5/);
  assert.match(joined, /Current model:\s+MoonshotAI: Kimi K2\.5 \(moonshotai\/kimi-k2\.5\) \(default\)/);
});

test('model command resolves numeric selection from the last search results and shows its label', async () => {
  const { ctx, outputs } = makeCtx({
    settings: {
      selectedTools: [],
      model: 'openai/gpt-4.1',
      modelLabel: 'OpenAI: GPT-4.1',
      stream: true,
      debug: false,
      retainHistory: true,
      glowEnabled: true,
      log: false,
    },
    lastModelSearchResults: [
      { id: 'qwen/qwen-plus', label: 'Qwen: Qwen-Plus' },
      { id: 'qwen/qwen-plus-2025-07-28', label: 'Qwen: Qwen Plus 0728' },
      { id: 'qwen/qwen-plus-2025-07-28:thinking', label: 'Qwen: Qwen Plus 0728 (thinking)' },
      { id: 'qwen/qwen3-coder-flash', label: 'Qwen: Qwen3 Coder Flash' },
      { id: 'qwen/qwen3-coder-plus', label: 'Qwen: Qwen3 Coder Plus' },
      { id: 'qwen/qwen3.6-plus-preview:free', label: 'Qwen: Qwen3.6 Plus Preview (free)' },
    ],
  });

  await processCommand('/model 6', ctx);
  await processCommand('/model', ctx);

  const joined = stripAnsi(outputs.join('\n---\n'));

  assert.match(joined, /Model set to: qwen\/qwen3\.6-plus-preview:free \(Qwen: Qwen3\.6 Plus Preview \(free\)\)/);
  assert.match(joined, /Current model:\s+Qwen: Qwen3\.6 Plus Preview \(free\) \(qwen\/qwen3\.6-plus-preview:free\)/);
});

test('model command can surface ambiguous exotic matches and then switch by number', async () => {
  const { ctx, outputs } = makeCtx({
    settings: {
      selectedTools: [],
      model: 'openai/gpt-4.1',
      modelLabel: 'OpenAI: GPT-4.1',
      stream: true,
      debug: false,
      retainHistory: true,
      glowEnabled: true,
      log: false,
    },
    client: {
      async getPaygStatus() {
        return {
          enabled: true,
          mode: 'debt_accumulation',
          payment_token: 'SOL',
          payment_chain: 'solana',
          is_blocked: false,
          total_debt_usd: 0,
          total_paid_usd: 0,
          debt_ceiling_usd: 100,
          pending_charges: 0,
          available_tokens: ['SOL'],
        };
      },
      async configurePayg() {
        return { success: true };
      },
    },
  });

  await processCommand('/model deepseek', ctx);
  await processCommand('/model 1', ctx);
  await processCommand('/model', ctx);

  const joined = stripAnsi(outputs.join('\n---\n'));

  assert.match(joined, /Multiple models matched "deepseek"/);
  assert.match(joined, /Pick one with \/model <number\|id>\./);
  assert.match(joined, /Model set to: .+\(.*DeepSeek.*\)/);
  assert.match(joined, /Current model:\s+.*DeepSeek.*\(.+\)/);
});

test('mpp command advertises scope and executes the MPP plugin', async () => {
  const { ctx, outputs } = makeCtx({
    pluginManager: {
      plugins: new Map([
        ['hustle-mpp', {
          enabled: true,
          plugin: {
            executors: {
              async mpp_call({ url, body, paymentMethod }) {
                return {
                  ok: true,
                  status: 200,
                  url,
                  paymentMethod: paymentMethod || 'tempo',
                  method: body ? 'POST' : 'GET',
                  receipt: {
                    method: paymentMethod || 'tempo',
                    status: 'success',
                    reference: '0xabc',
                    timestamp: '2026-03-31T00:00:00.000Z',
                  },
                  data: body ? JSON.parse(body) : null,
                };
              },
              async mpp_services() {
                return {
                  ok: true,
                  directoryUrl: 'https://mpp.dev/api/services',
                  count: 1,
                  services: [
                    {
                      id: 'parallel',
                      name: 'Parallel',
                      serviceUrl: 'https://parallelmpp.dev',
                      categories: ['ai', 'search'],
                      paidEndpointCount: 3,
                    },
                  ],
                };
              },
              async mpp_service_info({ id }) {
                return {
                  ok: true,
                  service: {
                    id,
                    name: 'Parallel',
                    serviceUrl: 'https://parallelmpp.dev',
                    endpoints: [
                      {
                        method: 'POST',
                        path: '/api/search',
                        payment: {
                          method: 'tempo',
                          amount: '1000000',
                        },
                      },
                    ],
                  },
                };
              },
              async mpp_state() {
                return {
                  ok: true,
                  tempo: {
                    channels: [
                      {
                        channelId: '0xchan',
                        recipient: '0xpayee',
                        currency: '0x20c0',
                        cumulativeAmountRaw: '1000000',
                      },
                    ],
                  },
                };
              },
              async mpp_tempo_clear() {
                return {
                  ok: true,
                  tempo: { channels: [] },
                };
              },
            },
          },
        }],
      ]),
    },
  });

  await processCommand('/help', ctx);
  await processCommand('/mpp', ctx);
  await processCommand('/mpp services parallel', ctx);
  await processCommand('/mpp service parallel', ctx);
  await processCommand('/mpp state', ctx);
  await processCommand('/mpp call https://parallelmpp.dev/api/search {"query":"agent payments"}', ctx);
  await processCommand('/mpp state clear', ctx);

  const joined = stripAnsi(outputs.join('\n---\n'));

  assert.match(joined, /\/mpp\s+MPP client plugin — status and paid endpoint calls/);
  assert.match(joined, /\/mpp services \[query\]\s+Browse public MPP services from the official directory/);
  assert.match(joined, /MPP Client Plugin/);
  assert.match(joined, /402 challenge → Authorization: Payment → Payment-Receipt/);
  assert.match(joined, /Tempo crypto via/);
  assert.match(joined, /mpp\.dev\/api\/services/);
  assert.match(joined, /Parallel/);
  assert.match(joined, /MPP Profile State/);
  assert.match(joined, /cumulativeRaw/);
  assert.match(joined, /parallelmpp\.dev\/api\/search/);
  assert.match(joined, /"reference": "0xabc"/);
  assert.match(joined, /Cleared persisted Tempo channel hints for the active profile\./);
});

test('agent mode requires --profile when more than one profile exists', () => {
  profile.createProfile('default');
  profile.createProfile('treasury');
  profile.setActiveProfile('default');

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, '--agent', '-m', 'What are my wallet addresses?'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: TEST_HOME },
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 1);
  assert.match(stripAnsi(result.stderr), /Multiple profiles detected\. In agent mode you must pass --profile <name>\./);
});

test('restore-auth creates an explicit target profile when it does not exist yet', () => {
  const backupPath = path.join(TEST_HOME, 'backup.json');
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        env: 'EMBLEM_PASSWORD=encrypted\n',
        envKeys: 'DOTENV_PRIVATE_KEY=key\n',
        secrets: '{"secret":true}\n',
      },
      null,
      2
    )
  );

  const result = spawnSync(
    process.execPath,
    [CLI_PATH, '--profile', 'treasury', '--restore-auth', backupPath],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: TEST_HOME },
      encoding: 'utf8',
    }
  );

  const restoredPaths = profile.getProfilePaths('treasury');

  assert.equal(result.status, 0);
  assert.match(stripAnsi(result.stdout), /Auth restored into profile "treasury"\./);
  assert.equal(fs.existsSync(restoredPaths.env), true);
  assert.equal(fs.existsSync(restoredPaths.envKeys), true);
  assert.equal(fs.existsSync(restoredPaths.secrets), true);
});

test('deleteProfile can remove a noncurrent profile when active-profile is missing', () => {
  profile.createProfile('default');
  profile.createProfile('treasury');
  profile.createProfile('ops');
  profile.setCurrentProfile('default');
  fs.rmSync(path.join(EMBLEMAI_DIR, 'active-profile'), { force: true });

  assert.doesNotThrow(() => profile.deleteProfile('treasury'));
  assert.equal(profile.profileExists('treasury'), false);
  assert.equal(profile.profileExists('default'), true);
  assert.equal(profile.profileExists('ops'), true);
});

test('needsRefresh returns true when session is within the refresh buffer', () => {
  const fresh = { expiresAt: Date.now() + 10 * 60 * 1000 }; // 10 min out
  const expiring = { expiresAt: Date.now() + 2 * 60 * 1000 }; // 2 min out
  const expired = { expiresAt: Date.now() - 1000 };

  assert.equal(sessionStore.needsRefresh(fresh), false);
  assert.equal(sessionStore.needsRefresh(expiring), true);
  assert.equal(sessionStore.needsRefresh(expired), true);
});

test('isSessionExpired returns true only when past expiresAt', () => {
  const valid = { expiresAt: Date.now() + 60_000 };
  const expired = { expiresAt: Date.now() - 1000 };

  assert.equal(sessionStore.isSessionExpired(valid), false);
  assert.equal(sessionStore.isSessionExpired(expired), true);
});
