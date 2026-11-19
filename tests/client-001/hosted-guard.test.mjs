import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const code = readFileSync(new URL('../../POS/js/sync/hosted-canonical-guard.js', import.meta.url), 'utf8');

function simulate({ path = '/app/index.html', hostname = 'cliente-001-pos-web.example.workers.dev', config, entries = {} } = {}) {
  let redirect = null;
  const state = Object.create(null);
  const origin = 'https://' + hostname;
  const page = {
    location: { pathname: path, hostname, origin, replace(value) { redirect = value; } },
    document: { documentElement: { dataset: state } },
    localStorage: { getItem(key) { return entries[key] ?? null; } },
    NA_HOSTED_CONFIG: config
  };
  runInNewContext(code, { window: page, URL, Number });
  return { redirect, state };
}

const host = 'cliente-001-pos-web.example.workers.dev';
const config = { environment: 'production', hostedHost: host, apiOrigin: 'https://' + host };

test('POS /app fails closed when runtime-config.js is missing', () => {
  const result = simulate();
  assert.equal(result.state.naHostedCanon, 'config-error');
  assert.equal(result.redirect, 'https://' + host + '/');
});

test('POS /app fails closed when runtime config has a different host', () => {
  const result = simulate({ config: { ...config, hostedHost: 'incorrect.example' } });
  assert.equal(result.state.naHostedCanon, 'config-error');
  assert.equal(result.redirect, 'https://' + host + '/');
});

test('POS /app requires client-specific activation', () => {
  const result = simulate({ config });
  assert.equal(result.state.naHostedCanon, 'activation-required');
  assert.equal(result.redirect, 'https://' + host + '/');
});

test('POS /app permits only a matching session and authority', () => {
  const entries = {
    na_canonical_binding: JSON.stringify({
      endpoint: config.apiOrigin, promotion_id: 'cliente001', authority_epoch: 1, revision: 1
    }),
    na_cloud_sync_credentials: JSON.stringify({
      endpoint: config.apiOrigin, token: 'test-token'
    })
  };
  const result = simulate({ config, entries });
  assert.equal(result.state.naHostedCanon, 'bound');
  assert.equal(result.state.naHostedEnvironment, 'production');
  assert.equal(result.redirect, null);
});

test('local POS entry point is not redirected by hosted guard', () => {
  const result = simulate({ hostname: '127.0.0.1', path: '/POS/index.html' });
  assert.equal(result.redirect, null);
  assert.equal(result.state.naHostedCanon, undefined);
});
