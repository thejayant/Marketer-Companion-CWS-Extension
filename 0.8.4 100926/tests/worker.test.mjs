// Loads the real service worker against stubbed Chrome APIs and drives its
// message router. This covers the wiring the module tests cannot see: that the
// extracted Search Console, Analytics and CallRail modules are reached, that
// the shared scheduler retries a read, and that the cache serves a second
// identical call without hitting the network again.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = { local: {}, session: {} };
const area = name => ({
  get: async keys => {
    if (!keys) return { ...store[name] };
    if (typeof keys === 'string') return { [keys]: store[name][keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, store[name][k]]));
    return { ...keys, ...store[name] };
  },
  set: async values => { Object.assign(store[name], values); },
  remove: async keys => { for (const k of [].concat(keys)) delete store[name][k]; }
});

let onMessage = null;
globalThis.chrome = {
  runtime: {
    id: 'test',
    lastError: null,
    getManifest: () => ({ version: '0.8.4' }),
    getPlatformInfo: async () => ({ os: 'win' }),
    onMessage: { addListener: fn => { onMessage = fn; } },
    onInstalled: { addListener: () => {} },
    onConnect: { addListener: () => {} }
  },
  storage: { local: area('local'), session: area('session') },
  identity: {
    getAuthToken: async () => ({ token: 'test-token' }),
    removeCachedAuthToken: async () => {},
    clearAllCachedAuthTokens: async () => {},
    launchWebAuthFlow: async () => '',
    getRedirectURL: () => 'https://test.chromiumapp.org/'
  },
  tabs: { query: async () => [] },
  scripting: { executeScript: async () => [] },
  action: { onClicked: { addListener: () => {} } },
  sidePanel: { setPanelBehavior: async () => {}, open: async () => {} }
};

const calls = [];
let responder = () => ({ ok: true, body: {} });
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method || 'GET' });
  const result = responder(String(url), options, calls.length);
  return {
    ok: result.ok !== false,
    status: result.status || (result.ok === false ? 500 : 200),
    url: String(url),
    headers: { get: name => (result.headers || {})[name] ?? null },
    text: async () => JSON.stringify(result.body ?? {}),
    json: async () => result.body ?? {}
  };
};

await import('../background.js');

const send = message => new Promise(resolve => {
  const kept = onMessage(message, { id: 'test' }, resolve);
  assert.equal(kept, true, 'the router must keep the message channel open');
});

test('the worker loads and registers a message router', () => {
  assert.equal(typeof onMessage, 'function');
});

test('listSites reaches the extracted Search Console module', async () => {
  calls.length = 0;
  responder = () => ({ body: { siteEntry: [{ siteUrl: 'https://example.com/' }] } });
  const response = await send({ type: 'listSites', forceRefresh: true });
  assert.equal(response.ok, true, response.error);
  assert.deepEqual(response.data, [{ siteUrl: 'https://example.com/' }]);
  assert.equal(calls[0].url, 'https://www.googleapis.com/webmasters/v3/sites');
});

test('a second identical call is served from the cache without another request', async () => {
  calls.length = 0;
  responder = () => ({ body: { siteEntry: [{ siteUrl: 'https://example.com/' }] } });
  const first = await send({ type: 'listSites' });
  const requestsAfterFirst = calls.length;
  const second = await send({ type: 'listSites' });
  assert.deepEqual(second.data, first.data);
  assert.equal(calls.length, requestsAfterFirst, 'the cached list must not re-spend quota');
  assert.equal(second.cache.source, 'cache');
});

test('a rate-limited read is retried by the shared scheduler', async () => {
  calls.length = 0;
  responder = (url, options, attempt) => attempt === 1
    ? { ok: false, status: 429, headers: { 'Retry-After': '0' }, body: { error: { message: 'rate' } } }
    : { body: { siteEntry: [{ siteUrl: 'https://retried.example/' }] } };
  const response = await send({ type: 'listSites', forceRefresh: true });
  assert.equal(response.ok, true, response.error);
  assert.equal(calls.length, 2, 'the first 429 should have been retried, not surfaced');
  assert.deepEqual(response.data, [{ siteUrl: 'https://retried.example/' }]);
});

test('GA4 property listing reaches the extracted module and follows its own URLs', async () => {
  calls.length = 0;
  responder = url => url.includes('/accounts')
    ? { body: { accounts: [{ name: 'accounts/1', displayName: 'Acme' }] } }
    : { body: { properties: [{ name: 'properties/42', displayName: 'Site' }] } };
  const response = await send({ type: 'gaListProperties', forceRefresh: true });
  assert.equal(response.ok, true, response.error);
  assert.deepEqual(response.data, [{ id: '42', displayName: 'Site', account: 'Acme' }]);
  assert.ok(calls.some(c => c.url.includes('analyticsadmin.googleapis.com')));
});

test('a CallRail read reaches the extracted module and pages it', async () => {
  calls.length = 0;
  store.session.callrailApiKey = 'test-key';
  responder = () => ({ body: { accounts: [{ id: 'ACC1', name: 'Acme' }], total_records: 1 } });
  const response = await send({ type: 'callrailListAccounts', forceRefresh: true });
  assert.equal(response.ok, true, response.error);
  assert.deepEqual(response.data.accounts, [{ id: 'ACC1', name: 'Acme' }]);
  assert.ok(calls[0].url.startsWith('https://api.callrail.com/v3/a.json'), calls[0].url);
});

test('a failed refresh serves the last good result, marked stale', async () => {
  calls.length = 0;
  responder = () => ({ body: { siteEntry: [{ siteUrl: 'https://cached.example/' }] } });
  await send({ type: 'listSites', forceRefresh: true });

  responder = () => ({ ok: false, status: 403, body: { error: { message: 'insufficient permission' } } });
  const response = await send({ type: 'listSites', forceRefresh: true });
  assert.equal(response.ok, true, 'a transient failure should not wipe a working report');
  assert.deepEqual(response.data, [{ siteUrl: 'https://cached.example/' }]);
  assert.equal(response.cache.stale, true, 'and the UI must be told the copy is stale');
});

test('an error with nothing cached is reported with its taxonomy instead of throwing', async () => {
  for (const key of Object.keys(store.local)) if (key.startsWith('api_cache:') || key === '__api_cache_index__') delete store.local[key];
  calls.length = 0;
  responder = () => ({ ok: false, status: 403, body: { error: { message: 'insufficient permission' } } });
  const response = await send({ type: 'listSites', forceRefresh: true });
  assert.equal(response.ok, false);
  assert.equal(typeof response.error, 'string');
  assert.equal(response.retryable, false, '403 is the account\'s problem, not a transient one');
  assert.equal(calls.length, 1, 'and it must not be retried');
});
