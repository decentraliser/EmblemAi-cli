const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_WEB_URL = 'https://openrouter.ai';
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MODEL_INDEX = 0;

export const DEFAULT_MODEL_CHOICES = Object.freeze([
  {
    id: 'moonshotai/kimi-k2.5',
    label: 'MoonshotAI: Kimi K2.5',
    notes: 'Great for coding and reasoning, with strong tool use.',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Anthropic: Claude Sonnet 4.6',
    notes: 'Stronger reasoning and tool use, with slightly higher latency.',
  },
  {
    id: 'anthropic/claude-opus-4.6',
    label: 'Anthropic: Claude Opus 4.6',
    notes: 'Best for complex reasoning and tool use, with higher latency.',
  },
  {
    id: 'x-ai/grok-4.1-fast',
    label: 'xAI: Grok 4.1 Fast',
    notes: 'Fast agentic workflows with tool support.',
  },
]);

let cachedModels = null;
let cachedAt = 0;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModelLabel(label, modelId) {
  const normalizedLabel = normalizeString(label);
  return normalizedLabel && normalizedLabel !== normalizeString(modelId) ? normalizedLabel : null;
}

function modelOutputsText(model) {
  const outputModalities = model?.architecture?.output_modalities;
  if (!Array.isArray(outputModalities) || outputModalities.length === 0) {
    return true;
  }
  return outputModalities.includes('text');
}

function normalizeDescription(description) {
  return normalizeString(description)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ');
}

function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeCanonicalSlug(model) {
  return normalizeString(model?.canonical_slug) || normalizeString(model?.canonicalSlug) || normalizeString(model?.id);
}

function normalizeOpenRouterModel(model) {
  const canonicalSlug = normalizeCanonicalSlug(model);
  return {
    id: normalizeString(model?.id),
    canonicalSlug,
    name: normalizeString(model?.name) || normalizeString(model?.id),
    description: normalizeDescription(model?.description),
    contextLength: Number.isFinite(model?.context_length) ? model.context_length : null,
    supportsTools: Array.isArray(model?.supported_parameters) && model.supported_parameters.includes('tools'),
    promptPrice: normalizeNumber(model?.pricing?.prompt),
    completionPrice: normalizeNumber(model?.pricing?.completion),
    url: canonicalSlug ? `${OPENROUTER_WEB_URL}/${canonicalSlug}` : null,
  };
}

function fuzzySubsequenceScore(text, query) {
  if (!text || !query) return 0;
  let score = 0;
  let queryIndex = 0;
  let streak = 0;

  for (let i = 0; i < text.length && queryIndex < query.length; i += 1) {
    if (text[i] === query[queryIndex]) {
      streak += 1;
      score += 8 + streak * 3;
      queryIndex += 1;
    } else {
      streak = 0;
    }
  }

  return queryIndex === query.length ? score : 0;
}

function scoreField(field, query, weight) {
  if (!field || !query) return 0;
  const normalizedField = field.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  if (normalizedField === normalizedQuery) return weight * 100;
  if (normalizedField.startsWith(normalizedQuery)) return weight * 40;
  if (normalizedField.includes(normalizedQuery)) return weight * 24;

  return fuzzySubsequenceScore(normalizedField, normalizedQuery) * weight;
}

function scoreModel(model, query) {
  const normalizedQuery = normalizeString(query).toLowerCase();
  if (!normalizedQuery) return 0;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const fields = [
    { value: model.id, weight: 12 },
    { value: model.name, weight: 10 },
    { value: model.description, weight: 2 },
  ];

  let score = 0;

  for (const field of fields) {
    score += scoreField(field.value, normalizedQuery, field.weight);
  }

  for (const token of tokens) {
    let matchedToken = false;
    for (const field of fields) {
      const tokenScore = scoreField(field.value, token, field.weight);
      if (tokenScore > 0) matchedToken = true;
      score += tokenScore;
    }
    if (!matchedToken) return 0;
  }

  return score;
}

export function formatContextLength(contextLength) {
  if (!Number.isFinite(contextLength) || contextLength <= 0) return null;
  if (contextLength >= 1_000_000) {
    const millions = contextLength / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (contextLength >= 1_000) {
    const thousands = contextLength / 1_000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }
  return String(contextLength);
}

export function getModelDisplayLabel(model) {
  return normalizeString(model?.label) || normalizeString(model?.name) || normalizeString(model?.id);
}

export function getModelFriendlyName(model) {
  const label = getModelDisplayLabel(model);
  const colonIndex = label.indexOf(':');
  if (colonIndex === -1) return label;
  return normalizeString(label.slice(colonIndex + 1)) || label;
}

export function getOpenRouterModelUrl(model) {
  const canonicalSlug = normalizeCanonicalSlug(model);
  return canonicalSlug ? `${OPENROUTER_WEB_URL}/${canonicalSlug}` : null;
}

function formatCompactDollar(value) {
  if (value === 0) return '0';
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatModelPrice(model) {
  const parts = [];
  if (Number.isFinite(model?.promptPrice)) {
    parts.push(`$${formatCompactDollar(model.promptPrice * 1_000_000)}/M in`);
  }
  if (Number.isFinite(model?.completionPrice)) {
    parts.push(`$${formatCompactDollar(model.completionPrice * 1_000_000)}/M out`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function trimModelDescription(description, maxLength = 200) {
  const normalized = normalizeDescription(description);
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function createModelSelection(model) {
  const id = resolveModelId(model?.id || model?.model);
  return {
    id,
    label: normalizeModelLabel(getModelDisplayLabel(model), id),
  };
}

export function getDefaultModelChoice() {
  const model = DEFAULT_MODEL_CHOICES[DEFAULT_MODEL_INDEX];
  return {
    ...model,
    name: model.label,
    contextLength: null,
    supportsTools: true,
    promptPrice: null,
    completionPrice: null,
    url: getOpenRouterModelUrl(model),
    isDefault: true,
  };
}

export function getDefaultModelId() {
  return getDefaultModelChoice().id;
}

export function resolveModelId(modelId) {
  return normalizeString(modelId) || getDefaultModelId();
}

export function describeConfiguredModel(modelId, modelLabel = null) {
  const resolvedId = resolveModelId(modelId);
  const known = DEFAULT_MODEL_CHOICES.find((model) => model.id === resolvedId);
  const fallbackLabel = normalizeModelLabel(modelLabel, resolvedId);

  if (known) {
    return {
      ...known,
      id: resolvedId,
      name: known.label,
      contextLength: null,
      supportsTools: true,
      isDefault: resolvedId === getDefaultModelId(),
    };
  }

  return {
    id: resolvedId,
    label: fallbackLabel || resolvedId,
    name: fallbackLabel || resolvedId,
    notes: '',
    contextLength: null,
    supportsTools: true,
    isDefault: resolvedId === getDefaultModelId(),
  };
}

export function getDefaultModelChoices(openRouterModels = null) {
  const byId = Array.isArray(openRouterModels)
    ? new Map(openRouterModels.map((model) => [model.id, model]))
    : null;

  return DEFAULT_MODEL_CHOICES.map((model) => {
    const openRouterModel = byId?.get(model.id);
    return {
      ...model,
      canonicalSlug: openRouterModel?.canonicalSlug || normalizeCanonicalSlug(model),
      name: openRouterModel?.name || model.label,
      description: openRouterModel?.description || model.notes,
      contextLength: openRouterModel?.contextLength ?? null,
      supportsTools: openRouterModel?.supportsTools ?? true,
      promptPrice: openRouterModel?.promptPrice ?? null,
      completionPrice: openRouterModel?.completionPrice ?? null,
      url: openRouterModel?.url || getOpenRouterModelUrl(model),
      isDefault: model.id === getDefaultModelId(),
    };
  });
}

export async function fetchOpenRouterModels({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedModels && now - cachedAt < MODEL_CACHE_TTL_MS) {
    return cachedModels;
  }

  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}`);
  }

  const payload = await response.json();
  const models = Array.isArray(payload?.data)
    ? payload.data
        .filter(modelOutputsText)
        .map(normalizeOpenRouterModel)
        .filter((model) => model.id)
    : [];

  cachedModels = models;
  cachedAt = now;
  return models;
}

export function searchOpenRouterModels(query, models, limit = 8) {
  const normalizedQuery = normalizeString(query);
  if (!normalizedQuery) return [];

  return [...models]
    .map((model) => ({ model, score: scoreModel(model, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if ((right.model.contextLength || 0) !== (left.model.contextLength || 0)) {
        return (right.model.contextLength || 0) - (left.model.contextLength || 0);
      }
      return left.model.id.localeCompare(right.model.id);
    })
    .slice(0, limit)
    .map((entry) => entry.model);
}
