import fs from 'fs';
import { ensureProfileDir, getProfilePaths } from './profile.js';

function defaultState() {
  return {
    version: 1,
    tempo: {
      channels: {},
    },
  };
}

function getStateFile() {
  return getProfilePaths().mppState;
}

function normalizeChannel(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const channelId = typeof raw.channelId === 'string' ? raw.channelId.trim() : '';
  const recipient = typeof raw.recipient === 'string' ? raw.recipient.trim().toLowerCase() : '';
  const currency = typeof raw.currency === 'string' ? raw.currency.trim().toLowerCase() : '';
  const chainId = Number.isFinite(Number(raw.chainId)) ? Number(raw.chainId) : 0;
  const cumulativeAmount = raw.cumulativeAmount === undefined || raw.cumulativeAmount === null
    ? ''
    : String(raw.cumulativeAmount).trim();

  if (!channelId || !recipient || !currency || !cumulativeAmount) {
    return null;
  }

  return {
    channelId,
    recipient,
    currency,
    chainId,
    escrowContract: typeof raw.escrowContract === 'string' && raw.escrowContract.trim()
      ? raw.escrowContract.trim().toLowerCase()
      : null,
    cumulativeAmount,
    depositRaw: raw.depositRaw === undefined || raw.depositRaw === null || raw.depositRaw === ''
      ? null
      : String(raw.depositRaw).trim(),
    opened: raw.opened !== false,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
      ? raw.updatedAt
      : new Date().toISOString(),
  };
}

function normalizeState(raw) {
  const next = defaultState();
  if (!raw || typeof raw !== 'object') return next;

  const version = Number(raw.version);
  next.version = Number.isFinite(version) && version > 0 ? version : 1;

  const channels = raw.tempo?.channels;
  if (!channels || typeof channels !== 'object') return next;

  for (const [channelId, value] of Object.entries(channels)) {
    const normalized = normalizeChannel({
      ...(value && typeof value === 'object' ? value : {}),
      channelId: value?.channelId || channelId,
    });
    if (!normalized || normalized.opened === false) continue;
    next.tempo.channels[normalized.channelId] = normalized;
  }

  return next;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? JSON.parse(raw) : defaultState();
}

export function getMppStatePath() {
  return getStateFile();
}

export function readMppState() {
  try {
    const filePath = getStateFile();
    if (!fs.existsSync(filePath)) return defaultState();
    return normalizeState(readJson(filePath));
  } catch {
    return defaultState();
  }
}

export function writeMppState(state) {
  ensureProfileDir();
  const filePath = getStateFile();
  const normalized = normalizeState(state);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  fs.chmodSync(filePath, 0o600);
  return normalized;
}

function updateMppState(mutator) {
  const current = readMppState();
  const next = mutator(current) || current;
  return writeMppState(next);
}

export function rememberTempoChannel(channel) {
  return updateMppState((state) => {
    const normalized = normalizeChannel(channel);
    if (!normalized) return state;
    if (normalized.opened === false) {
      delete state.tempo.channels[normalized.channelId];
      return state;
    }
    state.tempo.channels[normalized.channelId] = normalized;
    return state;
  });
}

export function forgetTempoChannel(channelId) {
  if (!channelId) return readMppState();

  return updateMppState((state) => {
    delete state.tempo.channels[String(channelId)];
    return state;
  });
}

export function clearTempoChannels() {
  return updateMppState((state) => {
    state.tempo.channels = {};
    return state;
  });
}

export function listTempoChannels(state = readMppState()) {
  return Object.values(normalizeState(state).tempo.channels)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export function findTempoChannel(criteria, state = readMppState()) {
  if (!criteria || typeof criteria !== 'object') return null;

  const recipient = typeof criteria.recipient === 'string' ? criteria.recipient.trim().toLowerCase() : '';
  const currency = typeof criteria.currency === 'string' ? criteria.currency.trim().toLowerCase() : '';
  const hasChainId = criteria.chainId !== undefined && criteria.chainId !== null;
  const chainId = hasChainId ? Number(criteria.chainId) : null;
  const escrowContract = typeof criteria.escrowContract === 'string' && criteria.escrowContract.trim()
    ? criteria.escrowContract.trim().toLowerCase()
    : null;

  if (!recipient || !currency) return null;

  const channels = listTempoChannels(state).filter((channel) => {
    if (channel.recipient !== recipient) return false;
    if (channel.currency !== currency) return false;
    if (chainId !== null && channel.chainId !== chainId) return false;
    if (escrowContract && channel.escrowContract && channel.escrowContract !== escrowContract) return false;
    return true;
  });

  if (channels.length === 0) return null;

  if (escrowContract) {
    const exactEscrow = channels.find((channel) => channel.escrowContract === escrowContract);
    if (exactEscrow) return exactEscrow;
  }

  return channels[0];
}
