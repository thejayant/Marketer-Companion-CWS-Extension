// Shared, explicit Google Ads report definitions and pure reporting operations.
// Both the service worker and UI import this module; no arbitrary GAQL is accepted.
const dimension = (field, label, type = 'text') => ({ field, key: field.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), label, type });
const campaign = [dimension('campaign.id', 'Campaign ID', 'id'), dimension('campaign.name', 'Campaign'), dimension('campaign.status', 'Campaign status'), dimension('campaign.advertising_channel_type', 'Campaign type')];
const group = [dimension('ad_group.id', 'Ad group ID', 'id'), dimension('ad_group.name', 'Ad group'), dimension('ad_group.status', 'Ad group status')];
const performance = ['impressions', 'clicks', 'interactions', 'cost_micros', 'conversions', 'conversions_value'];
const conversionMetrics = ['conversions', 'conversions_value', 'all_conversions', 'all_conversions_value'];
const standardFilters = ['campaign', 'campaignName', 'status', 'channel', 'device', 'network'];
const groupFilters = [...standardFilters, 'adGroup', 'adGroupStatus'];
const report = (label, resource, dimensions, identity, options = {}) => ({ label, resource, dimensions, identity, metrics: performance, filters: standardFilters, group: 'Performance', note: '', ...options });

export const ADS_REPORTS = {
  account_overview: report('Account overview', 'campaign', campaign, ['campaign.id']),
  campaign_performance: report('Campaign performance', 'campaign', campaign, ['campaign.id']),
  campaign_efficiency: report('Campaign efficiency', 'campaign', [...campaign, dimension('campaign_budget.amount_micros', 'Daily budget', 'moneyMicros')], ['campaign.id'], {
    group: 'Diagnostics', channels: ['SEARCH', 'SHOPPING'],
    diagnostics: ['search_impression_share', 'search_budget_lost_impression_share', 'search_rank_lost_impression_share', 'search_top_impression_share', 'search_absolute_top_impression_share'],
    note: 'Search and Shopping campaigns. Impression shares cover the entire selected period. Budget is the current configured budget; shared budgets can apply to multiple campaigns.'
  }),
  ad_group_performance: report('Ad group performance', 'ad_group', [...campaign, ...group], ['campaign.id', 'adGroup.id'], { filters: groupFilters }),
  ad_performance: report('Ad performance', 'ad_group_ad', [...campaign, ...group, dimension('ad_group_ad.ad.id', 'Ad ID', 'id'), dimension('ad_group_ad.ad.type', 'Ad type'), dimension('ad_group_ad.ad_strength', 'Ad strength'), dimension('ad_group_ad.status', 'Ad status'), dimension('ad_group_ad.policy_summary.approval_status', 'Approval status')], ['campaign.id', 'adGroup.id', 'adGroupAd.ad.id'], { filters: groupFilters, group: 'Diagnostics' }),
  keyword_performance: report('Keyword performance', 'keyword_view', [...campaign, ...group, dimension('ad_group_criterion.criterion_id', 'Keyword ID', 'id'), dimension('ad_group_criterion.keyword.text', 'Keyword'), dimension('ad_group_criterion.keyword.match_type', 'Match type'), dimension('ad_group_criterion.status', 'Keyword status'), dimension('ad_group_criterion.quality_info.quality_score', 'Quality score', 'number')], ['campaign.id', 'adGroup.id', 'adGroupCriterion.criterionId'], { filters: [...groupFilters, 'matchType', 'keywordText'], note: 'Quality score is a current diagnostic, not a historical average.' }),
  search_terms: report('Search terms · Search', 'search_term_view', [...campaign, ...group, dimension('search_term_view.search_term', 'Search term'), dimension('search_term_view.status', 'Term status')], ['campaign.id', 'adGroup.id', 'searchTermView.searchTerm'], { filters: [...groupFilters, 'termText', 'termExclude'], note: 'Google excludes some search terms for privacy. Report totals represent returned terms, not all campaign activity.' }),
  pmax_search_terms: report('Search terms · Performance Max', 'campaign_search_term_view', [...campaign, dimension('campaign_search_term_view.search_term', 'Search term')], ['campaign.id', 'campaignSearchTermView.searchTerm'], { group: 'Performance Max & Shopping', channels: ['PERFORMANCE_MAX'], filters: [...standardFilters, 'termText', 'termExclude'], note: 'Performance Max terms reported by Google. Privacy thresholds apply; keyword segments are deliberately excluded.' }),
  asset_performance: report('Ad assets', 'ad_group_ad_asset_view', [...campaign, ...group, dimension('ad_group_ad.ad.id', 'Ad ID', 'id'), dimension('asset.id', 'Asset ID', 'id'), dimension('asset.name', 'Asset'), dimension('asset.type', 'Asset type'), dimension('ad_group_ad_asset_view.field_type', 'Placement'), dimension('ad_group_ad_asset_view.performance_label', 'Performance label')], ['campaign.id', 'adGroup.id', 'adGroupAd.ad.id', 'asset.id', 'adGroupAdAssetView.fieldType'], { filters: groupFilters, note: 'Asset rows can overlap. Totals summarize reported asset rows and must not be treated as account totals.' }),
  conversions_by_campaign: report('Conversions by campaign', 'campaign', campaign, ['campaign.id'], { metrics: [...performance, 'all_conversions', 'all_conversions_value'] }),
  conversion_actions: report('Conversion actions', 'campaign', [...campaign, dimension('segments.conversion_action', 'Conversion action ID', 'id'), dimension('segments.conversion_action_name', 'Conversion action'), dimension('segments.conversion_action_category', 'Category')], ['campaign.id', 'segments.conversionAction'], { metrics: conversionMetrics, filters: [...standardFilters, 'conversionAction'], group: 'Diagnostics', note: 'Conversions use interaction dates and include fractional attribution. Cost, clicks, and CPA are unavailable at conversion-action grain.' }),
  device_performance: report('Devices', 'campaign', [...campaign, dimension('segments.device', 'Device')], ['campaign.id', 'segments.device'], { group: 'Breakdowns' }),
  network_performance: report('Networks', 'campaign', [...campaign, dimension('segments.ad_network_type', 'Network')], ['campaign.id', 'segments.adNetworkType'], { group: 'Breakdowns' }),
  location_performance: report('Locations · physical presence', 'geographic_view', [...campaign, dimension('geographic_view.country_criterion_id', 'Country', 'country')], ['campaign.id', 'geographicView.countryCriterionId'], { group: 'Breakdowns', filters: [...standardFilters, 'country'], fixed: ["geographic_view.location_type = 'LOCATION_OF_PRESENCE'"], note: 'Countries where people were physically located. Location-of-interest rows are excluded to avoid overlapping totals.' }),
  schedule_performance: report('Day & hour', 'campaign', [...campaign, dimension('segments.day_of_week', 'Day'), dimension('segments.hour', 'Hour', 'number')], ['campaign.id', 'segments.dayOfWeek', 'segments.hour'], { group: 'Breakdowns', note: 'Hours and weekdays use the Ads account timezone.' }),
  landing_pages: report('Landing pages', 'landing_page_view', [...campaign, ...group, dimension('landing_page_view.unexpanded_final_url', 'Landing page', 'url')], ['campaign.id', 'adGroup.id', 'landingPageView.unexpandedFinalUrl'], { filters: groupFilters, group: 'Diagnostics' }),
  pmax_asset_groups: report('Performance Max asset groups', 'asset_group', [...campaign, dimension('asset_group.id', 'Asset group ID', 'id'), dimension('asset_group.name', 'Asset group'), dimension('asset_group.status', 'Asset group status'), dimension('asset_group.ad_strength', 'Ad strength')], ['campaign.id', 'assetGroup.id'], { channels: ['PERFORMANCE_MAX'], group: 'Performance Max & Shopping' }),
  pmax_channels: report('Performance Max channels', 'campaign', [...campaign, dimension('segments.ad_network_type', 'Network'), dimension('segments.ad_sub_network_type', 'Channel')], ['campaign.id', 'segments.adNetworkType', 'segments.adSubNetworkType'], { channels: ['PERFORMANCE_MAX'], group: 'Performance Max & Shopping', note: 'Channel breakdown uses the network and sub-network categories exposed by Google for this account.' }),
  shopping_products: report('Shopping & PMax products', 'shopping_performance_view', [...campaign, dimension('segments.product_item_id', 'Product ID'), dimension('segments.product_title', 'Product'), dimension('segments.product_brand', 'Brand'), dimension('segments.product_type_l1', 'Product type'), dimension('segments.product_custom_attribute0', 'Custom label 0')], ['campaign.id', 'segments.productItemId', 'segments.productTitle', 'segments.productBrand', 'segments.productTypeL1', 'segments.productCustomAttribute0'], { metrics: performance.filter(field => field !== 'interactions'), channels: ['SHOPPING', 'PERFORMANCE_MAX'], filters: [...standardFilters, 'productId', 'brand', 'productType', 'productLabel'], group: 'Performance Max & Shopping', note: 'Products appearing in Shopping ads, including Performance Max. Totals reflect product reporting coverage.' })
};

export const ADS_METRICS = {
  impressions: { label: 'Impressions', type: 'number' },
  clicks: { label: 'Clicks', type: 'number' },
  interactions: { label: 'Interactions', type: 'number' },
  cost: { label: 'Spend', type: 'money' },
  ctr: { label: 'CTR', type: 'percent' },
  cpc: { label: 'Avg. CPC', type: 'money' },
  conversions: { label: 'Conversions', type: 'decimal' },
  cvr: { label: 'Conv. rate', type: 'percent' },
  cpa: { label: 'CPA', type: 'money' },
  value: { label: 'Conv. value', type: 'money' },
  roas: { label: 'ROAS', type: 'ratio' },
  allConversions: { label: 'All conversions', type: 'decimal' },
  allValue: { label: 'All conv. value', type: 'money' },
  searchImpressionShare: { label: 'Search impression share', type: 'share' },
  searchBudgetLostImpressionShare: { label: 'Lost IS · budget', type: 'share' },
  searchRankLostImpressionShare: { label: 'Lost IS · rank', type: 'share' },
  searchTopImpressionShare: { label: 'Top impression share', type: 'share' },
  searchAbsoluteTopImpressionShare: { label: 'Abs. top impression share', type: 'share' }
};
export function getReport(id) {
  const definition = ADS_REPORTS[id];
  if (!definition) throw new Error('Unknown Google Ads report.');
  return definition;
}
export function metricKeys(definition) {
  const conversionOnly = !definition.metrics.includes('cost_micros');
  return [...(conversionOnly ? ['conversions', 'value'] : ['impressions', 'clicks', 'cost', 'ctr', 'cpc', 'conversions', 'cvr', 'cpa', 'value', 'roas']),
    ...(definition.metrics.includes('all_conversions') ? ['allConversions', 'allValue'] : []),
    ...(definition.diagnostics || []).map(key => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()))].filter(key => key !== 'cvr' || definition.metrics.includes('interactions'));
}
export function getPath(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
const ratio = (a, b) => b > 0 ? a / b : null;
export function calculateMetrics(metrics = {}) {
  const number = key => Number(metrics[key] || 0);
  const cost = number('costMicros') / 1e6;
  const value = number('conversionsValue');
  return { impressions: number('impressions'), clicks: number('clicks'), interactions: number('interactions'), cost,
    conversions: number('conversions'), value, allConversions: number('allConversions'), allValue: number('allConversionsValue'),
    ctr: ratio(number('clicks'), number('impressions')), cpc: ratio(cost, number('clicks')),
    cvr: ratio(number('conversions'), number('interactions')), cpa: ratio(cost, number('conversions')), roas: ratio(value, cost) };
}
export function addMetrics(target, metrics = {}, fields = performance) {
  for (const field of fields) {
    const key = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    target[key] = (target[key] || 0) + Number(metrics[key] || 0);
  }
  return target;
}
export function rowKey(row, definition) { return JSON.stringify(definition.identity.map(key => getPath(row, key) ?? '')); }
export function aggregateRows(rawRows, definition) {
  const map = new Map();
  for (const raw of rawRows) {
    const key = rowKey(raw, definition);
    let item = map.get(key);
    if (!item) {
      item = { key, dimensions: {}, rawMetrics: {} };
      for (const d of definition.dimensions) item.dimensions[d.key] = getPath(raw, d.key) ?? (d.type === 'number' ? null : '');
      map.set(key, item);
    }
    addMetrics(item.rawMetrics, raw.metrics, definition.metrics);
  }
  return [...map.values()].map(item => ({ ...item, metrics: calculateMetrics(item.rawMetrics) }));
}
export function summarizeRows(rows, definition) {
  const total = {};
  for (const row of rows) addMetrics(total, row.rawMetrics, definition.metrics);
  return calculateMetrics(total);
}
export function validateDate(value, label = 'Date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error(`${label} is invalid.`);
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label} is invalid.`);
  return value;
}
export function shiftDate(value, days) {
  const date = new Date(`${validateDate(value)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function accountToday(timeZone, now = new Date()) {
  if (!timeZone) throw new Error('Account timezone is unavailable. Reload the account before reporting.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
export function reportDates(range, timeZone, custom = {}, now = new Date()) {
  const today = accountToday(timeZone, now);
  let startDate, endDate = shiftDate(today, -1);
  if (range === 'custom') { startDate = validateDate(custom.startDate, 'Start date'); endDate = validateDate(custom.endDate, 'End date'); }
  else if (range === 'yesterday') startDate = endDate;
  else if (range === 'this_month') { startDate = `${today.slice(0, 7)}-01`; endDate = today; }
  else if (range === 'last_month') { endDate = shiftDate(`${today.slice(0, 7)}-01`, -1); startDate = `${endDate.slice(0, 7)}-01`; }
  else if (range === 'year_to_date') { startDate = `${today.slice(0, 4)}-01-01`; endDate = today; }
  else { const days = Number(range); if (![7, 30, 90].includes(days)) throw new Error('Choose a valid date preset.'); startDate = shiftDate(endDate, 1 - days); }
  if (startDate > endDate) throw new Error('Start date must be on or before end date.');
  if (endDate > today) throw new Error('Report dates cannot be in the future in the account timezone.');
  if ((new Date(endDate) - new Date(startDate)) / 86400000 > 730) throw new Error('Choose a range of two years or less.');
  return { startDate, endDate };
}
export function comparisonDates(mode, range, custom = {}) {
  if (mode === 'none') return null;
  let startDate, endDate;
  if (mode === 'previous_period') {
    const days = Math.round((new Date(range.endDate) - new Date(range.startDate)) / 86400000) + 1;
    endDate = shiftDate(range.startDate, -1); startDate = shiftDate(endDate, 1 - days);
  } else if (mode === 'previous_year') {
    const previousYear = value => {
      const year = Number(value.slice(0, 4)) - 1;
      const candidate = `${year}${value.slice(4)}`;
      try { return validateDate(candidate); } catch { return `${year}-02-28`; }
    };
    startDate = previousYear(range.startDate); endDate = previousYear(range.endDate);
  } else if (mode === 'custom') { startDate = validateDate(custom.startDate, 'Comparison start'); endDate = validateDate(custom.endDate, 'Comparison end'); }
  else throw new Error('Choose a valid comparison mode.');
  if (startDate > endDate) throw new Error('Comparison start must be on or before its end date.');
  if (endDate >= range.startDate) throw new Error('The comparison period must end before the reporting period starts.');
  return { startDate, endDate };
}
const enumValues = {
  status: ['ENABLED', 'PAUSED', 'REMOVED'], adGroupStatus: ['ENABLED', 'PAUSED', 'REMOVED'],
  channel: ['SEARCH', 'DISPLAY', 'SHOPPING', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'MULTI_CHANNEL', 'SMART', 'LOCAL'],
  device: ['MOBILE', 'DESKTOP', 'TABLET', 'CONNECTED_TV', 'OTHER'],
  network: ['SEARCH', 'SEARCH_PARTNERS', 'CONTENT', 'YOUTUBE_SEARCH', 'YOUTUBE_WATCH', 'MIXED', 'CROSS_NETWORK', 'GOOGLE_TV'],
  matchType: ['EXACT', 'PHRASE', 'BROAD']
};
export function validateFilters(definition, input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'thresholds') continue;
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (!definition.filters.includes(key)) throw new Error(`The selected report does not support ${key}.`);
    if (enumValues[key]) {
      if (!enumValues[key].includes(value)) throw new Error(`Invalid ${key} filter.`);
      if (key === 'channel' && definition.channels && !definition.channels.includes(value)) throw new Error('Campaign type is incompatible with this report.');
    } else if (['campaign', 'adGroup', 'conversionAction', 'country'].includes(key)) {
      const ids = Array.isArray(value) ? value : [value];
      if (ids.length > 100 || ids.some(id => !/^\d+$/.test(String(id)))) throw new Error(`Invalid ${key} selection.`);
    } else if (String(value).length > 200) throw new Error('Filter text must contain 200 characters or fewer.');
    result[key] = value;
  }
  const allowedMetrics = metricKeys(definition).filter(key => !key.includes('Share'));
  result.thresholds = (input.thresholds || []).map(condition => {
    if (!allowedMetrics.includes(condition.metric) || !['gt', 'gte', 'lt', 'lte', 'eq'].includes(condition.operator) || !Number.isFinite(Number(condition.value)) || Number(condition.value) < 0) throw new Error('Choose a valid metric, operator, and nonnegative threshold.');
    return { metric: condition.metric, operator: condition.operator, value: Number(condition.value) };
  });
  if (result.thresholds.length > 5) throw new Error('Use five metric conditions or fewer.');
  return result;
}
const literal = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
export function buildReportQuery(id, range, input = {}, diagnostics = false) {
  const definition = getReport(id);
  const filters = validateFilters(definition, input);
  const where = [`segments.date BETWEEN ${literal(validateDate(range.startDate))} AND ${literal(validateDate(range.endDate))}`, ...(definition.fixed || [])];
  const enumFields = { status: 'campaign.status', adGroupStatus: 'ad_group.status', channel: 'campaign.advertising_channel_type', device: 'segments.device', network: 'segments.ad_network_type', matchType: 'ad_group_criterion.keyword.match_type' };
  for (const [key, field] of Object.entries(enumFields)) if (filters[key]) where.push(`${field} = ${literal(filters[key])}`);
  if (definition.channels) where.push(`campaign.advertising_channel_type IN (${definition.channels.map(literal).join(', ')})`);
  const idFields = { campaign: 'campaign.id', adGroup: 'ad_group.id', country: 'geographic_view.country_criterion_id' };
  for (const [key, field] of Object.entries(idFields)) if (filters[key]) where.push(`${field} IN (${(Array.isArray(filters[key]) ? filters[key] : [filters[key]]).join(', ')})`);
  if (filters.conversionAction) where.push(`segments.conversion_action IN (${(Array.isArray(filters.conversionAction) ? filters.conversionAction : [filters.conversionAction]).map(id => literal(`customers/{CUSTOMER}/conversionActions/${id}`)).join(', ')})`);
  const fields = diagnostics
    ? ['campaign.id', ...(definition.diagnostics || []).map(field => `metrics.${field}`)]
    : [...definition.dimensions.map(d => d.field), 'segments.date', ...definition.metrics.map(field => `metrics.${field}`)];
  return `SELECT ${[...new Set(fields)].join(', ')} FROM ${definition.resource} WHERE ${where.join(' AND ')} ORDER BY ${diagnostics ? 'campaign.id' : 'segments.date'}`;
}
export function applyRowFilters(rows, definition, filters) {
  const textFields = { campaignName: 'campaign.name', keywordText: 'adGroupCriterion.keyword.text', termText: definition.resource === 'campaign_search_term_view' ? 'campaignSearchTermView.searchTerm' : 'searchTermView.searchTerm', termExclude: definition.resource === 'campaign_search_term_view' ? 'campaignSearchTermView.searchTerm' : 'searchTermView.searchTerm', productId: 'segments.productItemId', brand: 'segments.productBrand', productType: 'segments.productTypeL1', productLabel: 'segments.productCustomAttribute0' };
  return rows.filter(row => {
    for (const [filter, key] of Object.entries(textFields)) {
      if (!filters[filter]) continue;
      const matches = String(row.dimensions[key] || '').toLowerCase().includes(String(filters[filter]).toLowerCase());
      if (filter === 'termExclude' ? matches : !matches) return false;
    }
    for (const condition of filters.thresholds || []) {
      const value = row.metrics[condition.metric];
      if (value == null) return false;
      const target = condition.value;
      if (!({ gt: value > target, gte: value >= target, lt: value < target, lte: value <= target, eq: Math.abs(value - target) < 1e-9 })[condition.operator]) return false;
    }
    return true;
  });
}
export function dailySeries(rawRows, definition, keys, range) {
  const map = new Map();
  for (let date = range.startDate; date <= range.endDate; date = shiftDate(date, 1)) map.set(date, {});
  for (const row of rawRows) {
    if (!keys.has(rowKey(row, definition))) continue;
    const date = row.segments?.date;
    if (map.has(date)) addMetrics(map.get(date), row.metrics, definition.metrics);
  }
  return [...map.entries()].map(([date, metrics]) => ({ date, ...calculateMetrics(metrics) }));
}
export function formatValue(value, type, currency = 'USD') {
  if (value == null || value === '') return '—';
  if (['text', 'id', 'url', 'country'].includes(type)) return String(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (type === 'money' || type === 'moneyMicros') return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(type === 'moneyMicros' ? number / 1e6 : number);
  if (type === 'percent') return `${(number * 100).toFixed(2)}%`;
  if (type === 'share') return Math.abs(number - 0.0999) < 1e-8 ? '<10%' : Math.abs(number - 0.9001) < 1e-8 ? '>90%' : `${(number * 100).toFixed(1)}%`;
  if (type === 'ratio') return `${number.toFixed(2)}×`;
  return number.toLocaleString(undefined, { maximumFractionDigits: type === 'decimal' ? 2 : 0 });
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
