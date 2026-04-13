import test from 'node:test';
import assert from 'node:assert/strict';

import { createMppPlugin, resolveTempoChargeMode, resolveTempoPersistedDepositRaw } from '../src/plugins/mpp.js';

test('resolveTempoPersistedDepositRaw converts human deposit input into raw units', () => {
  const challenge = {
    request: {
      decimals: 6,
    },
  };

  assert.equal(
    resolveTempoPersistedDepositRaw(challenge, { deposit: '0.01' }),
    '10000',
  );
});

test('resolveTempoPersistedDepositRaw matches mppx maxDeposit capping against suggestedDeposit', () => {
  const challenge = {
    request: {
      decimals: 6,
      suggestedDeposit: '20000',
    },
  };

  assert.equal(
    resolveTempoPersistedDepositRaw(challenge, { maxDeposit: '0.015' }),
    '15000',
  );
});

test('resolveTempoPersistedDepositRaw preserves an already persisted raw deposit value', () => {
  const challenge = {
    request: {
      decimals: 6,
      suggestedDeposit: '20000',
    },
  };

  assert.equal(
    resolveTempoPersistedDepositRaw(challenge, { deposit: '0.01' }, '42000'),
    '42000',
  );
});

test('resolveTempoChargeMode defaults Tempo charge calls to push mode', () => {
  assert.equal(resolveTempoChargeMode('tempo', undefined), 'push');
  assert.equal(resolveTempoChargeMode('tempo', 'pull'), 'pull');
  assert.equal(resolveTempoChargeMode(undefined, undefined), undefined);
});

test('createMppPlugin exposes a tool definition for every executor', () => {
  const plugin = createMppPlugin({ authSdk: {} });
  const toolNames = new Set(plugin.tools.map((tool) => tool.name));

  for (const executorName of Object.keys(plugin.executors)) {
    assert.equal(toolNames.has(executorName), true, `missing tool definition for executor ${executorName}`);
  }
});
