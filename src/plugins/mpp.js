/**
 * mpp.js — Machine Payments Protocol client plugin for Emblem Agent Wallet CLI
 *
 * Grounded in the official MPP docs and the reference `mppx` SDK:
 * https://docs.stripe.com/payments/machine/mpp
 * https://mpp.dev/quickstart/client
 */

import { Receipt } from 'mppx';
import { Mppx, tempo } from 'mppx/client';
import { parseUnits } from 'viem';
import {
  clearTempoChannels,
  findTempoChannel,
  forgetTempoChannel,
  listTempoChannels,
  readMppState,
  rememberTempoChannel,
} from '../mpp-state.js';

const DEFAULT_SERVICE_DIRECTORY_URL = 'https://mpp.dev/api/services';

function hasHeader(headers, key) {
  const needle = key.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === needle);
}

function parseJsonObjectString(value, label) {
  if (!value) return {};

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be a JSON object string`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object string`);
  }

  return parsed;
}

function parseHeaders(value) {
  return Object.fromEntries(
    Object.entries(parseJsonObjectString(value, 'headers')).map(([key, headerValue]) => [key, String(headerValue)]),
  );
}

function parseBody(value) {
  if (value === undefined || value === null || value === '') {
    return { body: undefined, isJson: false };
  }

  try {
    return {
      body: JSON.stringify(JSON.parse(value)),
      isJson: true,
    };
  } catch {
    return {
      body: String(value),
      isJson: false,
    };
  }
}

function normalizeRequestMethod(method, hasBody) {
  if (!method) return hasBody ? 'POST' : 'GET';
  return String(method).trim().toUpperCase();
}

function normalizePaymentMethod(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized !== 'tempo') {
    throw new Error('paymentMethod must be "tempo"');
  }
  return normalized;
}

function normalizePaymentMode(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized !== 'push' && normalized !== 'pull') {
    throw new Error('paymentMode must be "push" or "pull"');
  }
  return normalized;
}

export function resolveTempoChargeMode(paymentMethod, paymentMode) {
  if (paymentMethod !== 'tempo') return paymentMode;
  return paymentMode || 'push';
}

function normalizeSessionAction(value) {
  if (!value) return undefined;
  const normalized = String(value).trim();
  if (!['open', 'topUp', 'voucher', 'close'].includes(normalized)) {
    throw new Error('action must be one of: open, topUp, voucher, close');
  }
  return normalized;
}

function toSerializable(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toSerializable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, toSerializable(child)]),
    );
  }
  return value;
}

function summarizeChallenge(challenge) {
  if (!challenge) return undefined;
  return toSerializable({
    id: challenge.id,
    method: challenge.method,
    intent: challenge.intent,
    realm: challenge.realm,
    expires: challenge.expires,
    request: challenge.request,
  });
}

function getChallengeMethodDetails(request) {
  if (!request || typeof request !== 'object') return {};
  const details = request.methodDetails;
  if (!details || typeof details !== 'object') return {};
  return details;
}

function parseOptionalNumber(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

function normalizeRawAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function resolveTempoPersistedDepositRaw(challenge, args = {}, existingDepositRaw = null) {
  const saved = normalizeRawAmount(existingDepositRaw);
  if (saved) return saved;

  const request = challenge?.request;
  const decimals = Number.isFinite(Number(request?.decimals)) ? Number(request.decimals) : 6;
  const suggestedDepositRaw = normalizeRawAmount(request?.suggestedDeposit);
  const maxDepositRaw = args.maxDeposit
    ? parseUnits(String(args.maxDeposit), decimals).toString()
    : null;
  const depositRaw = args.deposit
    ? parseUnits(String(args.deposit), decimals).toString()
    : null;

  if (suggestedDepositRaw && maxDepositRaw) {
    return BigInt(suggestedDepositRaw) < BigInt(maxDepositRaw)
      ? suggestedDepositRaw
      : maxDepositRaw;
  }

  if (suggestedDepositRaw) return suggestedDepositRaw;
  if (maxDepositRaw) return maxDepositRaw;
  return depositRaw;
}

async function parseResponseData(response) {
  if (response.status === 204) {
    return { responseType: 'empty', data: null };
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return {
        responseType: 'json',
        data: await response.json(),
      };
    } catch {
      return {
        responseType: 'empty',
        data: null,
      };
    }
  }

  const text = await response.text();
  return {
    responseType: text.length > 0 ? 'text' : 'empty',
    data: text.length > 0 ? text : null,
  };
}

function servicePath(endpoint) {
  if (!endpoint || typeof endpoint.path !== 'string') return '';
  return endpoint.path;
}

function servicePaymentSummary(endpoint) {
  if (!endpoint?.payment) return null;
  const payment = endpoint.payment;
  return {
    method: payment.method || null,
    intent: payment.intent || null,
    currency: payment.currency || null,
    amount: payment.amount || null,
    decimals: payment.decimals ?? null,
    description: payment.description || null,
  };
}

function serviceSummary(service) {
  const paidEndpoints = Array.isArray(service.endpoints)
    ? service.endpoints.filter((endpoint) => endpoint?.payment)
    : [];

  return {
    id: service.id || null,
    name: service.name || null,
    serviceUrl: service.serviceUrl || service.url || null,
    description: service.description || null,
    status: service.status || null,
    categories: Array.isArray(service.categories) ? service.categories : [],
    tags: Array.isArray(service.tags) ? service.tags : [],
    realm: service.realm || null,
    provider: service.provider?.name || null,
    docs: service.docs?.homepage || null,
    paymentMethods: service.methods ? Object.keys(service.methods) : [],
    paidEndpointCount: paidEndpoints.length,
    samplePaidEndpoints: paidEndpoints.slice(0, 3).map((endpoint) => ({
      method: endpoint.method || null,
      path: servicePath(endpoint),
      description: endpoint.description || null,
      payment: servicePaymentSummary(endpoint),
    })),
  };
}

function scoreService(service, query) {
  if (!query) return 1;

  const haystack = [
    service.id,
    service.name,
    service.description,
    service.serviceUrl,
    service.url,
    service.realm,
    ...(Array.isArray(service.categories) ? service.categories : []),
    ...(Array.isArray(service.tags) ? service.tags : []),
    service.provider?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function filterServices(services, options = {}) {
  const query = options.query ? String(options.query).trim() : '';
  const category = options.category ? String(options.category).trim().toLowerCase() : '';
  const tag = options.tag ? String(options.tag).trim().toLowerCase() : '';
  const method = options.method ? String(options.method).trim().toLowerCase() : '';
  const status = options.status ? String(options.status).trim().toLowerCase() : '';
  const limit = Math.max(1, Math.min(parseOptionalNumber(options.limit, 'limit') ?? 10, 50));

  const filtered = services
    .filter((service) => {
      if (status && String(service.status || '').toLowerCase() !== status) return false;
      if (category && !Array.isArray(service.categories)) return false;
      if (category && !service.categories.some((value) => String(value).toLowerCase() === category)) return false;
      if (tag && !Array.isArray(service.tags)) return false;
      if (tag && !service.tags.some((value) => String(value).toLowerCase() === tag)) return false;
      if (method && !service.methods?.[method]) return false;
      return scoreService(service, query) > 0;
    })
    .sort((left, right) => {
      const diff = scoreService(right, query) - scoreService(left, query);
      if (diff !== 0) return diff;
      return String(left.name || left.id || '').localeCompare(String(right.name || right.id || ''));
    })
    .slice(0, limit);

  return filtered.map(serviceSummary);
}

function normalizeServiceId(value) {
  return String(value || '').trim().toLowerCase();
}

function pickService(services, identifier) {
  const needle = normalizeServiceId(identifier);
  if (!needle) return null;

  const exact = services.find((service) => normalizeServiceId(service.id) === needle);
  if (exact) return exact;

  const byName = services.find((service) => normalizeServiceId(service.name) === needle);
  if (byName) return byName;

  const scored = services
    .map((service) => ({ service, score: scoreService(service, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.service || null;
}

function serviceDetails(service) {
  return {
    ...serviceSummary(service),
    methods: service.methods || {},
    endpoints: Array.isArray(service.endpoints)
      ? service.endpoints.map((endpoint) => ({
          method: endpoint.method || null,
          path: servicePath(endpoint),
          description: endpoint.description || null,
          payment: servicePaymentSummary(endpoint),
        }))
      : [],
  };
}

async function fetchServices(directoryUrl) {
  const response = await fetch(directoryUrl);
  if (!response.ok) {
    throw new Error(`MPP service directory request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.services)) {
    throw new Error('MPP service directory returned an unexpected payload');
  }

  return payload.services;
}

function buildTempoSessionContext(args, action) {
  const context = {};

  if (action) context.action = action;
  if (args.channelId) context.channelId = String(args.channelId);
  if (args.cumulativeAmountRaw) context.cumulativeAmountRaw = String(args.cumulativeAmountRaw);
  if (args.cumulativeAmount) context.cumulativeAmount = String(args.cumulativeAmount);
  if (args.transaction) context.transaction = String(args.transaction);
  if (args.authorizedSigner) context.authorizedSigner = String(args.authorizedSigner);
  if (args.additionalDepositRaw) context.additionalDepositRaw = String(args.additionalDepositRaw);
  if (args.additionalDeposit) context.additionalDeposit = String(args.additionalDeposit);

  return Object.keys(context).length > 0 ? context : undefined;
}

function buildTempoChargeContext(paymentMode) {
  if (!paymentMode) return undefined;
  return { mode: paymentMode };
}

function buildTempoResumeContext(challenge, state) {
  if (challenge?.intent !== 'session') return undefined;
  const request = challenge?.request;
  const methodDetails = request?.methodDetails;
  const recipient = typeof request?.recipient === 'string' ? request.recipient : '';
  const currency = typeof request?.currency === 'string' ? request.currency : '';
  const chainId = methodDetails?.chainId;
  const escrowContract = typeof methodDetails?.escrowContract === 'string'
    ? methodDetails.escrowContract
    : undefined;

  const saved = findTempoChannel({
    recipient,
    currency,
    chainId,
    escrowContract,
  }, state);

  if (!saved) return undefined;

  return {
    channelId: saved.channelId,
    cumulativeAmountRaw: saved.cumulativeAmount,
    ...(saved.depositRaw ? { depositRaw: saved.depositRaw } : {}),
  };
}

function formatTempoChannel(entry) {
  return {
    channelId: entry.channelId,
    recipient: entry.recipient,
    currency: entry.currency,
    chainId: entry.chainId,
    escrowContract: entry.escrowContract,
    cumulativeAmountRaw: entry.cumulativeAmount,
    depositRaw: entry.depositRaw,
    updatedAt: entry.updatedAt,
  };
}

/**
 * @typedef {import('mppx').Challenge.Challenge<Record<string, unknown>>} MppChallenge
 */

export function createMppPlugin(config = {}) {
  async function executeServices(args = {}) {
    try {
      const services = await fetchServices(config.directoryUrl || DEFAULT_SERVICE_DIRECTORY_URL);
      return {
        ok: true,
        directoryUrl: config.directoryUrl || DEFAULT_SERVICE_DIRECTORY_URL,
        count: services.length,
        services: filterServices(services, args),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function executeServiceInfo(args = {}) {
    if (!args.id && !args.query) {
      return { error: 'id or query is required' };
    }

    try {
      const services = await fetchServices(config.directoryUrl || DEFAULT_SERVICE_DIRECTORY_URL);
      const service = pickService(services, args.id || args.query);
      if (!service) {
        return {
          ok: false,
          message: 'No matching MPP service found.',
        };
      }

      return {
        ok: true,
        service: serviceDetails(service),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function executeState() {
    try {
      const state = readMppState();
      return {
        ok: true,
        tempo: {
          channels: listTempoChannels(state).map(formatTempoChannel),
        },
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function executeCall(args = {}) {
    if (!config.authSdk) {
      return { error: 'MPP plugin requires an authenticated Emblem auth SDK instance.' };
    }

    if (!args.url) {
      return { error: 'url is required' };
    }

    try {
      /** @type {import('viem').Account} */
      const account = await config.authSdk.toViemAccount();
      const paymentMethod = normalizePaymentMethod(args.paymentMethod) || 'tempo';
      const paymentMode = resolveTempoChargeMode(
        paymentMethod,
        normalizePaymentMode(args.paymentMode),
      );
      const action = normalizeSessionAction(args.action);
      const tempoChargeContext = buildTempoChargeContext(paymentMode);
      const tempoSessionContext = buildTempoSessionContext(args, action);
      const extraHeaders = parseHeaders(args.headers);
      const parsedBody = parseBody(args.body);
      const method = normalizeRequestMethod(args.method, parsedBody.body !== undefined);

      if ((method === 'GET' || method === 'HEAD') && parsedBody.body !== undefined) {
        throw new Error(`HTTP ${method} requests cannot include a body`);
      }

      const headers = { ...extraHeaders };
      if (parsedBody.body !== undefined && !hasHeader(headers, 'Content-Type')) {
        headers['Content-Type'] = parsedBody.isJson
          ? 'application/json'
          : 'text/plain; charset=utf-8';
      }

      const state = readMppState();
      const tempoUpdates = [];
      let challengeSummary;
      /** @type {MppChallenge | undefined} */
      let lastChallenge;

      const tempoMethods = tempo({
        account,
        ...(args.deposit ? { deposit: String(args.deposit) } : {}),
        ...(args.maxDeposit ? { maxDeposit: String(args.maxDeposit) } : {}),
        ...(paymentMode ? { mode: paymentMode } : {}),
        onChannelUpdate: (entry) => {
          const serialized = toSerializable(entry);
          tempoUpdates.push(serialized);

          if (!serialized?.channelId) return;

          if (serialized.opened === false) {
            forgetTempoChannel(serialized.channelId);
            return;
          }

          const challengeRequest = challengeSummary?.request;
          rememberTempoChannel({
            channelId: serialized.channelId,
            recipient: challengeRequest?.recipient,
            currency: challengeRequest?.currency,
            chainId: serialized.chainId,
            escrowContract: serialized.escrowContract,
            cumulativeAmount: serialized.cumulativeAmount,
            depositRaw: resolveTempoPersistedDepositRaw(lastChallenge, args),
            opened: serialized.opened !== false,
            updatedAt: new Date().toISOString(),
          });
        },
      });

      const onChallenge = async (challenge, helpers) => {
        lastChallenge = challenge;
        challengeSummary = summarizeChallenge(challenge);

        if (challenge.method === 'tempo' && challenge.intent === 'charge') {
          if (tempoChargeContext) {
            return helpers.createCredential(tempoChargeContext);
          }
          return undefined;
        }

        if (challenge.method === 'tempo' && challenge.intent === 'session') {
          if (tempoSessionContext) {
            return helpers.createCredential(tempoSessionContext);
          }
          const resumeContext = buildTempoResumeContext(challenge, state);
          if (resumeContext) {
            return helpers.createCredential(resumeContext);
          }
          return undefined;
        }

        return undefined;
      };

      const tempoMppx = Mppx.create({
        polyfill: false,
        methods: [tempoMethods],
        onChallenge,
      });
      const tempoRequestContext = tempoSessionContext || tempoChargeContext;
      const response = await tempoMppx.fetch(args.url, {
        method,
        headers,
        ...(parsedBody.body !== undefined ? { body: parsedBody.body } : {}),
        ...(tempoRequestContext ? { context: tempoRequestContext } : {}),
      });

      let receipt;
      try {
        receipt = toSerializable(Receipt.fromResponse(response));
      } catch {
        receipt = undefined;
      }

      const challengeRequest = lastChallenge ? lastChallenge.request : undefined;
      const challengeMethodDetails = getChallengeMethodDetails(challengeRequest);
      const challengeMethod = lastChallenge ? lastChallenge.method : undefined;

      if (receipt?.method === 'tempo' && receipt?.channelId && receipt?.status === 'success') {
        if (receipt.status === 'success' && receipt.channelId && receipt.intent === 'session') {
          const existing = findTempoChannel({
            recipient: challengeRequest?.recipient,
            currency: challengeRequest?.currency,
            chainId: challengeMethodDetails.chainId,
            escrowContract: challengeMethodDetails.escrowContract,
          }, state);

          if (receipt.reference === receipt.channelId && receipt.spent === receipt.acceptedCumulative) {
            rememberTempoChannel({
              channelId: receipt.channelId,
              recipient: challengeRequest?.recipient,
              currency: challengeRequest?.currency,
              chainId: challengeMethodDetails.chainId,
              escrowContract: challengeMethodDetails.escrowContract,
              cumulativeAmount: receipt.acceptedCumulative,
              depositRaw: resolveTempoPersistedDepositRaw(lastChallenge, args, existing?.depositRaw),
              opened: true,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      const parsedResponse = await parseResponseData(response);

      return {
        ok: response.ok,
        requestedPaymentMethod: paymentMethod,
        paymentMethod: receipt?.method || challengeMethod || paymentMethod,
        status: response.status,
        statusText: response.statusText,
        url: response.url || args.url,
        method,
        responseType: parsedResponse.responseType,
        contentType: response.headers.get('content-type') || null,
        challenge: challengeSummary,
        receipt,
        tempoResume: paymentMethod === 'tempo'
          ? buildTempoResumeContext(lastChallenge, readMppState())
          : undefined,
        channelUpdates: tempoUpdates.length > 0 ? tempoUpdates : undefined,
        data: parsedResponse.data,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    name: 'hustle-mpp',
    version: '0.2.0',
    tools: [
      {
        name: 'mpp_call',
        description: 'Call an MPP payment-gated HTTP endpoint using the official 402 -> Authorization: Payment -> Payment-Receipt flow via mppx/client with Tempo payments.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Full MPP endpoint URL to call.' },
            method: { type: 'string', description: 'Optional HTTP method. Defaults to GET when no body is supplied, otherwise POST.' },
            body: { type: 'string', description: 'Optional raw string or JSON string request body.' },
            headers: { type: 'string', description: 'Optional JSON string of extra request headers.' },
            paymentMethod: { type: 'string', description: 'MPP method to prefer. Only "tempo" is currently supported.' },
            deposit: { type: 'string', description: 'Optional Tempo session deposit amount in human-readable units, e.g. "5".' },
            maxDeposit: { type: 'string', description: 'Optional cap for auto-managed Tempo session deposits.' },
            paymentMode: { type: 'string', description: 'Optional Tempo payment transport mode: "push" or "pull".' },
            action: { type: 'string', description: 'Optional manual Tempo session action: open, topUp, voucher, close.' },
            channelId: { type: 'string', description: 'Optional session channel ID for manual session flows.' },
            cumulativeAmountRaw: { type: 'string', description: 'Optional raw cumulative amount for manual voucher/close flows. Prefer this when reusing values from receipts or persisted state.' },
            cumulativeAmount: { type: 'string', description: 'Optional cumulative amount for manual voucher/close flows.' },
            transaction: { type: 'string', description: 'Optional serialized transaction for manual open/topUp flows.' },
            authorizedSigner: { type: 'string', description: 'Optional authorized signer address for session vouchers.' },
            additionalDepositRaw: { type: 'string', description: 'Optional raw additional deposit amount for manual topUp flows. Prefer this when reusing on-chain/raw values.' },
            additionalDeposit: { type: 'string', description: 'Optional additional deposit amount for manual topUp flows.' },
          },
          required: ['url'],
        },
      },
      {
        name: 'mpp_services',
        description: 'List public MPP services from the official machine-readable directory at mpp.dev/api/services.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional free-text search across id, name, description, categories, and tags.' },
            category: { type: 'string', description: 'Optional category filter, e.g. "ai" or "blockchain".' },
            tag: { type: 'string', description: 'Optional tag filter, e.g. "email" or "prices".' },
            method: { type: 'string', description: 'Optional payment method filter, e.g. "tempo".' },
            status: { type: 'string', description: 'Optional status filter, e.g. "active".' },
            limit: { type: 'number', description: 'Maximum results to return (default 10, max 50).' },
          },
        },
      },
      {
        name: 'mpp_service_info',
        description: 'Inspect one public MPP service and its paid endpoints using the official service directory.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Exact service id when known.' },
            query: { type: 'string', description: 'Fallback query when the exact id is not known.' },
          },
        },
      },
      {
        name: 'mpp_state',
        description: 'Show persisted per-profile MPP state including resumable Tempo channels.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mpp_tempo_clear',
        description: 'Clear persisted Tempo resume hints for the active profile.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ],
    executors: {
      mpp_call: executeCall,
      mpp_services: executeServices,
      mpp_service_info: executeServiceInfo,
      mpp_state: executeState,
      mpp_tempo_clear: async () => {
        try {
          const state = clearTempoChannels();
          return {
            ok: true,
            tempo: {
              channels: listTempoChannels(state).map(formatTempoChannel),
            },
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    hooks: {
      onRegister: () => {
        console.log('[mpp] Plugin loaded v0.2.0. Tempo discovery, charging, and resume support enabled.');
      },
    },
  };
}
