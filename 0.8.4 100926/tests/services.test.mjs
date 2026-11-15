// The Search Console, Analytics and CallRail logic used to live inside the
// service worker, where it could only be exercised by clicking through a
// signed-in browser. These are the cases that were untestable before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallrailApi, CALLRAIL_PAGE_GUARD } from '../callrail-api.js';
import { createGscApi, covers, buildSearchAnalyticsBody, weightedTotals, normalizeGscDataState } from '../gsc-api.js';
import { createGaApi, buildRunReportBody, normalizeKeyEvents, GA_PAGE_GUARD } from '../ga-api.js';

// ---------- CallRail ----------

test('CallRail paging follows the page counter to the end and stops on a short page', async () => {
  const pages = [
    { companies: Array.from({ length: 250 }, (_, i) => ({ id: i })), total_records: 400 },
    { companies: Array.from({ length: 150 }, (_, i) => ({ id: 250 + i })), total_records: 400 }
  ];
  const seen = [];
  const api = createCallrailApi({ request: async (path, params) => { seen.push(params.page); return pages[params.page - 1]; } });
  const { companies } = await api.listCompanies('acc');
  assert.equal(companies.length, 400, 'an agency past the first page must not silently lose the tail');
  assert.deepEqual(seen, [1, 2]);
});

test('CallRail paging cannot loop forever when the server keeps returning full pages', async () => {
  let calls = 0;
  const api = createCallrailApi({
    request: async () => { calls++; return { companies: Array.from({ length: 250 }, () => ({})), total_records: 1e9 }; }
  });
  const { companies } = await api.listCompanies('acc');
  assert.equal(calls, CALLRAIL_PAGE_GUARD);
  assert.equal(companies.length, CALLRAIL_PAGE_GUARD * 250);
});

test('a missing CallRail transcript is a state, not an empty panel', async () => {
  const detail = body => createCallrailApi({ request: async () => body }).callDetail({ accountId: 'a', callId: '1' });

  const none = await detail({ id: '1' });
  assert.equal(none.transcriptState, 'unavailable');
  assert.equal(none.transcript, null);

  const lines = await detail({ transcription: { lines: [{ role: 'agent', text: 'Hello' }, { text: '' }] } });
  assert.equal(lines.transcriptState, 'ready');
  assert.deepEqual(lines.transcript, [{ role: 'agent', text: 'Hello', startTime: null }]);

  const empty = await detail({ transcription: { lines: [] } });
  assert.equal(empty.transcriptState, 'empty');

  const plain = await detail({ transcription: '  spoken words  ' });
  assert.equal(plain.transcriptState, 'ready');
  assert.equal(plain.transcript[0].text, 'spoken words');
});

test('a call summary counts returning callers without going negative and only asks for voicemails when told to', async () => {
  const calls = [];
  const api = createCallrailApi({
    request: async (path, params) => {
      calls.push(params.answer_status);
      if (params.answer_status === 'voicemail') return { grouped_results: [{ key: 'google', total_calls: 3 }] };
      return { grouped_results: [
        { key: 'google', total_calls: 10, answered_calls: 8, missed_calls: 2, first_time_callers: 12 },
        { key: 'bing', total_calls: 20, answered_calls: 20, missed_calls: 0, first_time_callers: 5 }
      ] };
    }
  });

  const quiet = await api.callSummary({ accountId: 'a', group_by: 'source', start_date: '2026-01-01', end_date: '2026-01-31' });
  assert.deepEqual(calls, ['all'], 'no second request unless voicemails were asked for');
  assert.equal(quiet.rows[0].key, 'bing', 'rows are ordered by total calls');
  assert.equal(quiet.rows[1].returning_callers, 0, 'more first-time callers than calls must not go negative');
  assert.equal(quiet.rows[0].voicemails, 0);

  const withVm = await api.callSummary({ accountId: 'a', group_by: 'source', include_voicemails: true });
  assert.equal(withVm.meta.includesVoicemails, true);
  assert.equal(withVm.rows.find(r => r.key === 'google').voicemails, 3);
});

// ---------- Search Console ----------

test('a domain property covers its subdomains, a prefix property does not overreach', () => {
  assert.equal(covers('sc-domain:example.com', 'https://shop.example.com/a'), true);
  assert.equal(covers('sc-domain:example.com', 'https://example.com/'), true);
  assert.equal(covers('sc-domain:example.com', 'https://notexample.com/'), false);
  assert.equal(covers('https://example.com/shop/', 'https://example.com/shop/item'), true);
  assert.equal(covers('https://example.com/shop/', 'https://example.com/blog'), false);
  assert.equal(covers('sc-domain:example.com', 'not a url'), false);
});

test('the Search Console query body matches what was asked for', () => {
  const plain = buildSearchAnalyticsBody({ startDate: '2026-01-01', endDate: '2026-01-31', pageOnly: false });
  assert.equal(plain.body.aggregationType, 'byProperty', 'a property total must be aggregated by property');
  assert.equal(plain.body.rowLimit, 1);
  assert.equal(plain.hasDimensions, false);

  const page = buildSearchAnalyticsBody({ pageUrl: 'https://example.com/a', startDate: '2026-01-01', endDate: '2026-01-31', pageOnly: true });
  assert.equal(page.body.dimensionFilterGroups[0].filters[0].expression, 'https://example.com/a');

  const dims = buildSearchAnalyticsBody({ startDate: '2026-01-01', endDate: '2026-01-31', dimensions: ['query'], rowLimit: '250' });
  assert.deepEqual(dims.body.dimensions, ['query']);
  assert.equal(dims.body.rowLimit, 250);
  assert.equal('aggregationType' in dims.body, false);

  assert.equal(normalizeGscDataState('all'), 'all');
  assert.equal(normalizeGscDataState('anything else'), 'final');
});

test('average position is impression-weighted, the way Search Console computes it', () => {
  const totals = weightedTotals([
    { clicks: 1, impressions: 4, position: 90 },
    { clicks: 99, impressions: 40000, position: 2 }
  ]);
  assert.equal(totals.clicks, 100);
  assert.equal(totals.impressions, 40004);
  assert.ok(totals.position < 2.01, `a plain mean would give 46; got ${totals.position}`);
  assert.ok(Math.abs(totals.ctr - 100 / 40004) < 1e-12);
  assert.equal(weightedTotals([{ clicks: 0, impressions: 0 }]).position, 0, 'no impressions must not divide by zero');
});

test('an empty property-level result falls back to a by-date query and totals it', async () => {
  const bodies = [];
  const api = createGscApi({
    request: async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (!body.dimensions) return { rows: [] };
      return { rows: [{ clicks: 2, impressions: 10, position: 5 }, { clicks: 3, impressions: 30, position: 1 }] };
    }
  });
  const data = await api.searchAnalytics('https://example.com/', null, '2026-01-01', '2026-01-31', false);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].dimensions, ['date']);
  assert.equal(data.rows[0].clicks, 5);
  assert.equal(data.rows[0].impressions, 40);
});

// ---------- GA4 ----------

test('GA4 property listing follows nextPageToken for accounts and properties', async () => {
  const api = createGaApi({
    request: async url => {
      const target = new URL(url);
      if (target.pathname.endsWith('/accounts')){
        return target.searchParams.get('pageToken')
          ? { accounts: [{ name: 'accounts/2', displayName: 'B' }] }
          : { accounts: [{ name: 'accounts/1', displayName: 'A' }], nextPageToken: 'more' };
      }
      const parent = target.searchParams.get('filter').split(':')[1];
      return { properties: [{ name: `properties/${parent.split('/')[1]}0`, displayName: `P${parent.split('/')[1]}` }] };
    }
  });
  const list = await api.listProperties();
  assert.equal(list.length, 2, 'an account on the second page must not be dropped');
  assert.deepEqual(list.map(p => p.account), ['A', 'B'], 'sorted by account then property');
  assert.deepEqual(list.map(p => p.id), ['10', '20']);
});

test('one failing account does not lose the rest of the estate', async () => {
  const api = createGaApi({
    request: async url => {
      const filter = new URL(url).searchParams.get('filter');
      if (!filter) return { accounts: [{ name: 'accounts/1', displayName: 'A' }, { name: 'accounts/2', displayName: 'B' }] };
      if (filter === 'parent:accounts/1') throw Object.assign(new Error('403'), { httpStatus: 403 });
      return { properties: [{ name: 'properties/20', displayName: 'Works' }] };
    }
  });
  const list = await api.listProperties();
  assert.deepEqual(list.map(p => p.displayName), ['Works']);
});

test('GA4 paging is bounded', async () => {
  let calls = 0;
  const api = createGaApi({ request: async () => { calls++; return { accounts: [{ name: 'accounts/1', displayName: 'A' }], nextPageToken: 'always' }; } });
  await api.pagedList(() => new URL('https://analyticsadmin.googleapis.com/v1beta/accounts'), 'accounts');
  assert.equal(calls, GA_PAGE_GUARD, 'a server that always returns a page token must not spin forever');
});

test('the run-report body carries filters, limits and ordering, and defaults sensibly', () => {
  const plain = buildRunReportBody({ startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.deepEqual(plain.dimensions, [{ name: 'date' }]);
  assert.deepEqual(plain.metrics.map(m => m.name), ['activeUsers', 'sessions', 'screenPageViews', 'eventCount']);
  assert.equal('limit' in plain, false);

  const full = buildRunReportBody({
    startDate: '2026-01-01', endDate: '2026-01-31',
    dimensions: ['sessionDefaultChannelGroup'], metrics: ['sessions'],
    inListFilter: { fieldName: 'sessionDefaultChannelGroup', values: ['Organic Search'] },
    rowLimit: '25.9', orderByMetric: 'sessions'
  });
  assert.equal(full.limit, '25', 'a fractional row limit is floored, not passed through');
  assert.equal(full.dimensionFilter.filter.inListFilter.caseSensitive, false);
  assert.equal(full.orderBys[0].desc, true);

  const ignored = buildRunReportBody({ startDate: 'a', endDate: 'b', inListFilter: { fieldName: 'x', values: [] } });
  assert.equal('dimensionFilter' in ignored, false, 'an empty value list is not a filter');
});

test('key events are named, deduplicated of blanks and sorted', () => {
  const rows = normalizeKeyEvents([
    { name: 'properties/1/keyEvents/purchase', custom: true },
    { eventName: 'add_to_cart', countingMethod: 'ONCE_PER_EVENT' },
    { name: 'properties/1/keyEvents/' }
  ]);
  assert.deepEqual(rows.map(r => r.eventName), ['add_to_cart', 'purchase']);
  assert.equal(rows[1].custom, true);
});
