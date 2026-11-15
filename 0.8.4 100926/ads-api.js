import { getReport, buildReportQuery, reportDates, comparisonDates, validateFilters, aggregateRows, applyRowFilters, summarizeRows, dailySeries, rowKey } from './ads-reporting.js';
import { createScheduler } from './net.js';

export function adsId(value, label = 'Customer ID', optional = false) {
  const id = String(value || '').replace(/[\s-]/g, '');
  if (optional && !id) return '';
  if (!/^\d{10}$/.test(id)) throw new Error(`${label} must contain ten digits.`);
  return id;
}

// Injection keeps the existing OAuth/401 handling and makes pagination and
// report completeness testable without a signed-in Chrome session.
export function createAdsApi({ request, getConfig, maxRows = 100000, pace = 0, sleep }) {
  // Pacing and retries come from the shared scheduler. Ads used to give up on
  // any Retry-After over two seconds, which turned an ordinary quota pause into
  // a failed report; the scheduler waits up to its ceiling and reports the rest.
  const scheduler = createScheduler({ pace, ...(sleep ? { sleep } : {}) });
  async function call(path, options, loginCustomerId = '') {
    return await scheduler.run('ads', async () => {
      try { return await request(path, options, loginCustomerId); }
      catch (error) {
        const raw = String(error.detail || error.message || error);
        if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION/.test(raw)) {
          error.message = 'The OAuth client’s Google Cloud project is not approved for production Google Ads access. Open the Google Ads API overview in that Cloud project and request production access.';
          error.userMessage = error.message;
          throw error;
        }
        if (/REQUESTED_METRICS_FOR_MANAGER/.test(raw)) { error.message = 'Choose a client account. Manager accounts do not provide campaign performance metrics.'; error.userMessage = error.message; throw error; }
        throw error;
      }
    });
  }
  async function searchAll(customerId, query, loginCustomerId = '') {
    const rows = [];
    const seen = new Set();
    let pageToken = '';
    let pages = 0;
    do {
      if (++pages > 100) throw new Error('This report exceeds the page limit. Narrow the dates or select campaigns; no partial totals were returned.');
      const data = await call(`customers/${adsId(customerId)}/googleAds:search`, { method: 'POST', body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }) }, loginCustomerId);
      rows.push(...(data.results || []));
      if (rows.length > maxRows) throw new Error(`This report exceeds ${maxRows.toLocaleString()} daily rows. Narrow the dates or select campaigns; no partial totals were returned.`);
      pageToken = data.nextPageToken || '';
      if (pageToken && seen.has(pageToken)) throw new Error('Google returned a repeated page token. Retry the report; no partial totals were returned.');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return rows;
  }
  async function customer(customerId, loginCustomerId = '') {
    const id = adsId(customerId);
    const rows = await searchAll(id, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer', loginCustomerId);
    const value = rows[0]?.customer;
    if (!value?.currencyCode || !value?.timeZone) throw new Error('Account currency or timezone could not be loaded. Reload accounts and try again.');
    return { customerId: id, descriptiveName: value.descriptiveName || id, currencyCode: value.currencyCode, timeZone: value.timeZone, manager: !!value.manager, status: value.status || '', loginCustomerId };
  }
  async function listCustomers() {
    const cfg = await getConfig();
    const configured = adsId(cfg.loginCustomerId, 'Manager customer ID', true);
    const data = await call('customers:listAccessibleCustomers', {}, '');
    const roots = [...new Set([...(configured ? [configured] : []), ...(data.resourceNames || []).map(name => name.split('/').pop())])];
    const accounts = new Map();
    const warnings = [];
    // Process the configured manager first so its access route wins when the
    // same client is also returned under another manager or direct access.
    for (const root of roots) {
      try {
        const self = await customer(root);
        if (!accounts.has(root)) accounts.set(root, self);
        if (!self.manager) continue;
        // customer_client exposes the complete reachable hierarchy through
        // level; omitting the old <=1 condition includes nested MCC clients.
        const rows = await searchAll(root, 'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level, customer_client.status, customer_client.currency_code, customer_client.time_zone FROM customer_client WHERE customer_client.level > 0 ORDER BY customer_client.level, customer_client.descriptive_name', root);
        for (const row of rows) {
          const value = row.customerClient;
          if (!value?.id) continue;
          const id = adsId(value.id);
          if (!accounts.has(id)) accounts.set(id, { customerId: id, descriptiveName: value.descriptiveName || id, currencyCode: value.currencyCode, timeZone: value.timeZone, manager: !!value.manager, level: Number(value.level || 0), status: value.status || '', loginCustomerId: root });
        }
      } catch (error) { warnings.push(`Account ${root}: ${error.message}`); }
    }
    return { customers: [...accounts.values()].sort((a, b) => Number(a.manager) - Number(b.manager) || a.descriptiveName.localeCompare(b.descriptiveName)), warning: warnings.join(' ') };
  }
  async function options({ customerId, loginCustomerId }) {
    const id = adsId(customerId);
    const login = adsId(loginCustomerId, 'Manager customer ID', true);
    const account = await customer(id, login);
    if (account.manager) throw new Error('Choose a client account to load campaign filters.');
    const definitions = {
      campaigns: 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign ORDER BY campaign.name',
      adGroups: 'SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status FROM ad_group ORDER BY ad_group.name',
      conversionActions: 'SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category FROM conversion_action ORDER BY conversion_action.name',
      countries: "SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED' ORDER BY geo_target_constant.name"
    };
    const settled = await Promise.allSettled(Object.entries(definitions).map(async ([key, query]) => [key, await searchAll(id, query, login)]));
    const result = { account, campaigns: [], adGroups: [], conversionActions: [], countries: [], warnings: [] };
    settled.forEach((item, index) => {
      if (item.status === 'fulfilled') result[item.value[0]] = item.value[1];
      else result.warnings.push(`${Object.keys(definitions)[index]} filters could not load: ${item.reason.message}`);
    });
    return result;
  }
  async function run(input) {
    const id = adsId(input.customerId);
    const login = adsId(input.loginCustomerId, 'Manager customer ID', true);
    const definition = getReport(input.preset);
    const filters = validateFilters(definition, input.filters || {});
    const account = await customer(id, login);
    if (account.manager) throw new Error('Choose a client account. Manager accounts cannot run performance reports.');
    const range = reportDates(input.range || '30', account.timeZone, input.custom || {});
    const previous = comparisonDates(input.compareMode || 'none', range, input.compareCustom || {});
    if (previous) reportDates('custom', account.timeZone, previous);
    const query = period => buildReportQuery(input.preset, period, filters).replaceAll('{CUSTOMER}', id);
    // Sequencing the periods avoids bursts of large reporting requests.
    const raw = await searchAll(id, query(range), login);
    let rows = applyRowFilters(aggregateRows(raw, definition), definition, filters);
    const keys = new Set(rows.map(row => row.key));
    const warnings = [];
    async function mergeDiagnostics(targetRows, period) {
      if (!definition.diagnostics) return;
      const diagnostics = await searchAll(id, buildReportQuery(input.preset, period, filters, true).replaceAll('{CUSTOMER}', id), login);
      const map = new Map(diagnostics.map(row => [String(row.campaign?.id), row.metrics || {}]));
      targetRows.forEach(row => {
        const value = map.get(String(row.dimensions['campaign.id'])) || {};
        for (const field of definition.diagnostics) {
          const key = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
          row.metrics[key] = value[key] == null ? null : Number(value[key]);
        }
      });
    }
    await mergeDiagnostics(rows, range);
    let previousRows = [], previousSummary = null, previousSeries = [];
    if (previous) {
      const previousRaw = await searchAll(id, query(previous), login);
      // With metric conditions, compare the selected current-period cohort.
      // Otherwise use the same filters independently in both periods, keeping
      // previous-only activity in historical account/report totals.
      const groupedPrevious = aggregateRows(previousRaw, definition);
      previousRows = filters.thresholds.length ? groupedPrevious.filter(row => keys.has(row.key)) : applyRowFilters(groupedPrevious, definition, filters);
      await mergeDiagnostics(previousRows, previous);
      previousSummary = summarizeRows(previousRows, definition);
      previousSeries = dailySeries(previousRaw, definition, new Set(previousRows.map(row=>row.key)), previous);
    }
    if (input.range === 'this_month' || input.range === 'year_to_date' || range.endDate === reportDates('this_month', account.timeZone).endDate) warnings.push('Today is included and may be incomplete. Recent conversions can change as attribution updates.');
    return { preset: input.preset, account, range, previous, filters, rows, previousRows,
      summary: summarizeRows(rows, definition), previousSummary,
      series: dailySeries(raw, definition, keys, range), previousSeries,
      complete: true, rawRowCount: raw.length, generatedAt: new Date().toISOString(), warnings };
  }
  return { listCustomers, options, run, searchAll, customer };
}
