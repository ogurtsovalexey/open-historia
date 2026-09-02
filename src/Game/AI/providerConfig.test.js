import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_OPTIONS,
  getProviderSettings,
  getStoredProvider,
  setProviderField,
  setStoredProvider,
} from './providerConfig.js';

const installStorage = () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  return values;
};

test('strategic and utility roles can use independent providers and credentials', () => {
  const values = installStorage();
  setStoredProvider('openai', 'strategic');
  setProviderField('openai', 'apiKey', 'strategic-key', 'strategic');
  setProviderField('openai', 'model', 'strategic-model', 'strategic');
  setStoredProvider('anthropic', 'utility');
  setProviderField('anthropic', 'apiKey', 'utility-key', 'utility');
  setProviderField('anthropic', 'model', 'utility-model', 'utility');

  assert.equal(getStoredProvider('strategic'), 'openai');
  assert.equal(getStoredProvider('utility'), 'anthropic');
  assert.equal(getProviderSettings('openai', 'strategic').apiKey, 'strategic-key');
  assert.equal(getProviderSettings('anthropic', 'utility').apiKey, 'utility-key');
  assert.equal(getProviderSettings('anthropic', 'utility').model, 'utility-model');
  assert.equal(values.get('utility_anthropic_api_key'), 'utility-key');
  assert.equal(values.get('anthropic_api_key'), undefined);
});

test('an unconfigured utility role inherits the strategic profile for old saves', () => {
  installStorage();
  setStoredProvider('gemini');
  setProviderField('gemini', 'apiKey', 'existing-key');
  assert.equal(getStoredProvider('utility'), 'gemini');
  assert.equal(getProviderSettings('gemini', 'utility').apiKey, 'existing-key');
});

test('Codex subscription is independently configurable without storing a ChatGPT token', () => {
  const values = installStorage();
  setStoredProvider('codex-subscription', 'strategic');
  setProviderField('codex-subscription', 'model', 'gpt-5.6-terra', 'strategic');
  setProviderField('codex-subscription', 'effort', 'high', 'strategic');
  setStoredProvider('codex-subscription', 'utility');
  setProviderField('codex-subscription', 'model', 'gpt-5.6-luna', 'utility');

  assert.deepEqual(getProviderSettings('codex-subscription', 'strategic'), {
    provider: 'codex-subscription', apiKey: '', endpoint: '', model: 'gpt-5.6-terra', customParams: '', effort: 'high',
  });
  assert.equal(getProviderSettings('codex-subscription', 'utility').model, 'gpt-5.6-luna');
  assert.equal(PROVIDER_OPTIONS.find((entry) => entry.value === 'codex-subscription').desktopOnly, true);
  assert.equal([...values.keys()].some((key) => /token|api_key/i.test(key)), false);
});
