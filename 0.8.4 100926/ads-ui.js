import { ADS_REPORTS, ADS_METRICS, getReport, metricKeys, formatValue, csvCell, reportDates } from './ads-reporting.js';

export function createAdsUI({ request, escape }) {
  const $ = id => document.getElementById(id);
  const state = { accounts: [], options: null, optionsFor: '', loadingFor: '', optionsPromise: null, optionsToken: 0, runToken: 0, busy: false, data: null, stale: false, page: 0, pageSize: 25, sort: { key: 'cost', direction: -1 }, visible: new Set(), search: '', chartMetric: 'cost' };
  const option = (value, text) => `<option value="${escape(String(value))}">${escape(String(text))}</option>`;
  const account = () => state.accounts.find(item => item.customerId === $('adsCustomer')?.value);
  const selected = id => [...($(id)?.selectedOptions || [])].map(item => item.value).filter(Boolean);
  function message(text, error = false) {
    const el = $('adsStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ads-status--error', error);
  }
  function updateRunButton() {
    const button = $('adsRun');
    if (!button) return;
    button.disabled = state.busy || !state.options || state.optionsFor !== $('adsCustomer')?.value;
    button.textContent = state.busy ? 'Loading…' : 'Run report';
    $('adsResult')?.setAttribute('aria-busy', String(state.busy));
  }
  function invalidate() {
    state.runToken++;
    state.busy = false;
    state.stale = !!state.data;
    updateRunButton();
    const stamp = $('adsResultState');
    if (stamp && state.data) { stamp.textContent = 'Selection changed · run to update'; stamp.classList.add('is-stale'); }
  }
  function readFilters() {
    const definition = getReport($('adsPreset').value);
    const fields = { campaign: 'adsCampaign', campaignName: 'adsCampaignName', status: 'adsCampaignStatus', channel: 'adsChannel', adGroup: 'adsAdGroup', adGroupStatus: 'adsAdGroupStatus', device: 'adsDevice', network: 'adsNetwork', matchType: 'adsMatchType', keywordText: 'adsKeywordText', termText: 'adsTermText', termExclude: 'adsTermExclude', country: 'adsCountry', conversionAction: 'adsConversionAction', productId: 'adsProductId', brand: 'adsBrand', productType: 'adsProductType', productLabel: 'adsProductLabel' };
    const result = {};
    for (const [key, id] of Object.entries(fields)) {
      if (!definition.filters.includes(key)) continue;
      const el = $(id);
      const value = el?.multiple ? selected(id) : el?.value?.trim() || '';
      if (Array.isArray(value) ? value.length : value) result[key] = value;
    }
    result.thresholds = [...document.querySelectorAll('#adsThresholds .ads-threshold')].map(row => {
      const metric = row.querySelector('[data-metric]').value;
      const value = row.querySelector('[data-value]').value;
      return { metric, operator:row.querySelector('[data-operator]').value, value:value !== '' && ADS_METRICS[metric].type === 'percent' ? Number(value)/100 : value };
    }).filter(rule => rule.value !== '');
    return result;
  }
  function updateFilterCount() {
    const filters = readFilters();
    const count = Object.keys(filters).filter(key => key !== 'thresholds').length + filters.thresholds.length;
    $('adsFilterCount').textContent = count ? `${count} active` : 'Optional';
  }
  function fillAdGroups() {
    const select = $('adsAdGroup');
    const previous = selected('adsAdGroup');
    const campaigns = selected('adsCampaign');
    select.innerHTML = (state.options?.adGroups || []).filter(row => !campaigns.length || campaigns.includes(String(row.campaign?.id))).map(row => option(row.adGroup.id, `${row.adGroup.name} · ${row.adGroup.id}`)).join('');
    for (const item of select.options) item.selected = previous.includes(item.value);
  }
  async function accountChanged() {
    invalidate();
    const current = account();
    if (state.optionsFor === current?.customerId && state.options) return;
    if (current && state.loadingFor === current.customerId) { try { await state.optionsPromise; } catch {} return; }
    const token = ++state.optionsToken;
    state.loadingFor = current?.customerId || '';
    state.options = null;
    state.optionsFor = '';
    $('adsResult').innerHTML = '';
    state.data = null;
    for (const id of ['adsCampaign', 'adsAdGroup', 'adsConversionAction', 'adsCountry']) $(id).innerHTML = '';
    $('adsAccountMeta').textContent = current ? `${current.currencyCode || 'Currency unavailable'} · ${current.timeZone || 'Timezone unavailable'}` : 'Choose a client account';
    updateRunButton();
    if (!current || current.manager) { message('Choose a client account to report.'); return; }
    message('Loading campaign and report filters…');
    try {
      state.optionsPromise = request('googleAdsGetOptions', { customerId: current.customerId, loginCustomerId: current.loginCustomerId || '' });
      const data = await state.optionsPromise;
      if (token !== state.optionsToken) return;
      state.options = data;
      state.optionsFor = current.customerId;
      Object.assign(current, data.account);
      $('adsAccountMeta').textContent = `${current.currencyCode} · ${current.timeZone}`;
      $('adsCampaign').innerHTML = data.campaigns.map(row => option(row.campaign.id, `${row.campaign.name} · ${(row.campaign.status || 'unknown').toLowerCase()}`)).join('');
      fillAdGroups();
      $('adsConversionAction').innerHTML = data.conversionActions.map(row => option(row.conversionAction.id, row.conversionAction.name)).join('');
      $('adsCountry').innerHTML = option('', 'All countries') + data.countries.map(row => option(row.geoTargetConstant.id, row.geoTargetConstant.name)).join('');
      message(data.warnings.length ? data.warnings.join(' ') : 'Ready. Select a report and run it.');
      updateReport();
    } catch (error) { if (token === state.optionsToken) message(error.message, true); }
    finally { if (token === state.optionsToken) { state.loadingFor = ''; state.optionsPromise = null; updateRunButton(); } }
  }
  function setAccounts(items) {
    const previous = $('adsCustomer').value;
    state.accounts = items;
    state.optionsToken++;
    state.loadingFor = '';
    state.options = null;
    state.optionsFor = '';
    const clients = items.filter(item => !item.manager && item.status !== 'CANCELED' && item.status !== 'CLOSED');
    const managers = items.filter(item => item.manager);
    const label = item => `${item.descriptiveName || 'Google Ads'} · ${item.customerId.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}`;
    const clientOptions = clients.map(item => option(item.customerId, label(item))).join('');
    const managerOptions = managers.map(item => `<option disabled value="${escape(item.customerId)}">${escape(label(item))} · Manager</option>`).join('');
    $('adsCustomer').innerHTML = clients.length
      ? `<optgroup label="Client accounts">${clientOptions}</optgroup>${managers.length ? `<optgroup label="Managers · choose a client below them">${managerOptions}</optgroup>` : ''}`
      : option('', 'No reporting accounts available');
    if (clients.some(item => item.customerId === previous)) $('adsCustomer').value = previous;
    updateRunButton();
  }
  function updateReport() {
    const definition = getReport($('adsPreset').value);
    $('adsReportNote').textContent = definition.note;
    $('adsReportNote').hidden = !definition.note;
    document.querySelectorAll('#adsFilters [data-ads-filter]').forEach(el => {
      const enabled = definition.filters.includes(el.dataset.adsFilter);
      el.hidden = !enabled;
      el.querySelectorAll('input,select').forEach(input => { input.disabled = !enabled; });
    });
    for (const el of $('adsChannel').options) el.disabled = !!el.value && !!definition.channels && !definition.channels.includes(el.value);
    if ($('adsChannel').selectedOptions[0]?.disabled) $('adsChannel').value = '';
    const metrics = metricKeys(definition).filter(key => !key.includes('Share'));
    document.querySelectorAll('#adsThresholds [data-metric]').forEach(el => {
      const previous = el.value;
      if (!metrics.includes(previous)) { el.closest('.ads-threshold').remove(); return; }
      el.innerHTML = metrics.map(key => option(key, ADS_METRICS[key].label)).join('');
      if (metrics.includes(previous)) el.value = previous;
    });
    updateDates();
    updateFilterCount();
  }
  function updateDates() {
    $('adsCustom').hidden = $('adsRange').value !== 'custom';
    $('adsCompareCustom').hidden = $('adsCompare').value !== 'custom';
    const current = account();
    if (current?.timeZone && $('adsRange').value !== 'custom') {
      try {
        const range = reportDates($('adsRange').value, current.timeZone);
        $('adsDateHint').textContent = `${range.startDate} → ${range.endDate} · ${current.timeZone}`;
      } catch (error) { $('adsDateHint').textContent = error.message; }
    } else $('adsDateHint').textContent = current?.timeZone ? `Dates use ${current.timeZone}` : 'Dates use the account timezone';
  }
  function addThreshold() {
    if ($('adsThresholds').children.length >= 5) return;
    const definition = getReport($('adsPreset').value);
    const row = document.createElement('div');
    row.className = 'ads-threshold';
    row.innerHTML = `<select data-metric aria-label="Condition metric">${metricKeys(definition).filter(key => !key.includes('Share')).map(key => option(key, ADS_METRICS[key].label)).join('')}</select><select data-operator aria-label="Condition operator">${[['gte','≥'],['gt','>'],['lte','≤'],['lt','<'],['eq','=']].map(([value,label]) => option(value,label)).join('')}</select><input data-value type="number" min="0" step="any" aria-label="Condition value" placeholder="Value"><button type="button" data-remove-condition aria-label="Remove condition">×</button>`;
    $('adsThresholds').append(row);
    row.querySelector('input').focus();
  }
  async function run() {
    if (state.busy) return;
    const current = account();
    if (!current || !state.options) { message('Select a client account and load its filters first.', true); return; }
    const payload = { customerId: current.customerId, loginCustomerId: current.loginCustomerId || '', preset: $('adsPreset').value, range: $('adsRange').value,
      custom: { startDate: $('adsStart').value, endDate: $('adsEnd').value }, compareMode: $('adsCompare').value,
      compareCustom: { startDate: $('adsCompareStart').value, endDate: $('adsCompareEnd').value }, filters: readFilters() };
    const token = ++state.runToken;
    state.busy = true;
    updateRunButton();
    message('Loading all report pages and calculating totals…');
    try {
      // Running a report is the user asking Google for current numbers, so it
      // bypasses the cache. The cached copy stays as the fallback the service
      // worker serves if that refresh fails.
      const data = await request('googleAdsRunPreset', { ...payload, forceRefresh: true });
      if (token !== state.runToken) return;
      state.data = data;
      state.stale = false;
      state.page = 0;
      state.search = '';
      const definition = getReport(data.preset);
      const metrics = metricKeys(definition);
      state.sort = { key: metrics.includes('cost') ? 'cost' : 'conversions', direction: -1 };
      state.chartMetric = metrics.includes('cost') ? 'cost' : 'conversions';
      state.visible = new Set([...definition.dimensions.filter(d => d.type !== 'id' || ['Ad ID','Asset ID'].includes(d.label)).map(d => d.key), ...metrics]);
      render();
      message(data.warnings.join(' ') || `Complete report · ${data.rows.length.toLocaleString()} entities · ${data.rawRowCount.toLocaleString()} daily rows loaded`);
    } catch (error) { if (token === state.runToken) { state.stale = !!state.data; message(error.message, true); const stamp = $('adsResultState'); if (stamp) { stamp.textContent = 'Last successful report · request failed'; stamp.classList.add('is-stale'); } } }
    finally { if (token === state.runToken) { state.busy = false; updateRunButton(); } }
  }
  function columns() {
    const definition = getReport(state.data.preset);
    return [...definition.dimensions, ...metricKeys(definition).map(key => ({ key, ...ADS_METRICS[key], metric: true }))];
  }
  const rowValue = (row, column) => column.metric ? row.metrics[column.key] : row.dimensions[column.key];
  function countryName(value) {
    const item = state.options?.countries.find(row => String(row.geoTargetConstant.id) === String(value));
    return item ? `${item.geoTargetConstant.name} (${value})` : String(value || 'Unknown');
  }
  function tableRows() {
    const cols = columns();
    const search = state.search.toLowerCase();
    return state.data.rows.filter(row => !search || cols.some(column => String(rowValue(row, column) ?? '').toLowerCase().includes(search))).slice().sort((a, b) => {
      const column = cols.find(item => item.key === state.sort.key);
      if (!column) return 0;
      const av = rowValue(a, column), bv = rowValue(b, column);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      return state.sort.direction * (column.metric || ['number','moneyMicros'].includes(column.type) ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), undefined, { numeric: true }));
    });
  }
  function changeLabel(current, previous, type = '') {
    if (current == null || previous == null) return '—';
    if (type === 'share') return `${((current-previous)*100).toFixed(1)} pp`;
    if (previous === 0) return current === 0 ? 'No change' : 'New';
    const change = (current - previous) / Math.abs(previous) * 100;
    return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
  }
  function render() {
    const data = state.data;
    const definition = getReport(data.preset);
    const metrics = metricKeys(definition);
    const kpis = metrics.includes('cost') ? ['cost','conversions','value','roas','cpa','clicks','impressions','ctr','cpc','cvr'] : ['conversions','value','allConversions','allValue'];
    const scope = `${data.account.descriptiveName} · ${data.account.customerId} · ${data.account.currencyCode} · ${data.account.timeZone}`;
    const comparison = data.previous ? `${data.previous.startDate} → ${data.previous.endDate}` : 'No comparison';
    const context = `<div class="ads-result-head"><div><h4>${escape(definition.label)}</h4><p>${escape(scope)}</p><p>${escape(data.range.startDate)} → ${escape(data.range.endDate)}${data.previous ? ` · vs ${escape(comparison)}` : ''}</p></div><span id="adsResultState" class="ads-result-stamp">Complete report</span></div>`;
    const stats = `<div class="ads-kpis">${kpis.filter(key => metrics.includes(key)).map(key => `<div><span>${escape(ADS_METRICS[key].label)}</span><strong>${escape(formatValue(data.summary[key], ADS_METRICS[key].type, data.account.currencyCode))}</strong>${data.previousSummary ? `<small title="${escape(formatValue(data.previousSummary[key], ADS_METRICS[key].type, data.account.currencyCode))} previously">${escape(changeLabel(data.summary[key], data.previousSummary[key]))} vs comparison</small>` : ''}</div>`).join('')}</div>`;
    const metricOptions = metrics.filter(key => ['cost','clicks','conversions','value','impressions'].includes(key));
    $('adsResult').innerHTML = `${context}${stats}<section class="ads-trend"><div class="ads-section-head"><h4>Daily trend</h4><label>Metric<select id="adsChartMetric">${metricOptions.map(key => option(key, ADS_METRICS[key].label)).join('')}</select></label><button type="button" id="adsExportDaily" class="btn-top">Daily CSV</button></div><div id="adsChart"></div><p class="ads-chart-note">${data.previous ? 'Solid: report period. Dashed: comparison, aligned by day index. ' : ''}Hover over a point for the date and value.${data.previous && data.series.length !== data.previousSeries.length ? ` Periods contain ${data.series.length} and ${data.previousSeries.length} days.` : ''}</p></section><section class="ads-table-section"><div class="ads-section-head"><h4>Report details</h4><button type="button" id="adsExport" class="btn-top">Export CSV</button></div><div class="ads-table-tools"><label class="ads-table-search">Search table<input id="adsTableSearch" type="search" placeholder="Find a row" autocomplete="off"></label><details class="ads-columns"><summary>Columns</summary><div>${columns().map(column => `<label><input type="checkbox" data-column="${escape(column.key)}" ${state.visible.has(column.key) ? 'checked' : ''}>${escape(column.label)}</label>`).join('')}</div></details><label>Rows<select id="adsPageSize">${[25,50,100].map(value => option(value,value)).join('')}</select></label></div><p class="ads-table-note">Search and paging affect the table only. CSV includes all matching table rows and all columns.${data.previous ? (data.filters.thresholds.length ? ' Metric conditions select current-period entities; the comparison follows that cohort.' : ' Comparison totals use the same filters and include entities active only in the comparison period.') : ''}</p><div id="adsTable"></div></section>`;
    $('adsChartMetric').value = state.chartMetric;
    $('adsPageSize').value = String(state.pageSize);
    renderChart(); renderTable();
  }
  function renderChart() {
    const metric = state.chartMetric;
    const data = state.data;
    const current = data.series, previous = data.previousSeries;
    const all = [...current, ...previous].map(row => Number(row[metric] || 0));
    const max = Math.max(...all, 1);
    const length = Math.max(current.length, previous.length, 2);
    const point = (row, i) => [80 + i / (length - 1) * 610, 158 - Number(row[metric] || 0) / max * 130];
    const line = rows => rows.map((row, i) => { const [x,y] = point(row,i); return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`; }).join(' ');
    const circles = (rows, old) => rows.map((row,i) => { const [x,y] = point(row,i); return `<circle cx="${x}" cy="${y}" r="3" class="${old ? 'is-previous' : ''}"><title>${escape(row.date)}${old ? ' · comparison' : ''}: ${escape(formatValue(row[metric], ADS_METRICS[metric].type, data.account.currencyCode))}</title></circle>`; }).join('');
    $('adsChart').innerHTML = `<svg viewBox="0 0 720 195" role="img" aria-label="${escape(ADS_METRICS[metric].label)} by day"><title>Daily ${escape(ADS_METRICS[metric].label)} in ${escape(data.account.timeZone)}</title>${[0,0.5,1].map(fraction => `<line x1="80" x2="690" y1="${158-fraction*130}" y2="${158-fraction*130}" class="ads-gridline"/><text x="72" y="${162-fraction*130}" text-anchor="end">${escape(formatValue(max*fraction,ADS_METRICS[metric].type,data.account.currencyCode))}</text>`).join('')}<path d="${line(current)}" class="ads-current-line"/>${previous.length ? `<path d="${line(previous)}" class="ads-previous-line"/>` : ''}${circles(previous,true)}${circles(current,false)}<text x="80" y="185">${escape(current[0]?.date || '')}</text><text x="690" y="185" text-anchor="end">${escape(current.at(-1)?.date || '')}</text></svg>`;
  }
  function renderTable() {
    const rows = tableRows();
    const cols = columns().filter(column => state.visible.has(column.key));
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * state.pageSize;
    const previous = new Map(state.data.previousRows.map(row => [row.key,row]));
    const currency = state.data.account.currencyCode;
    const header = cols.map(column => `<th scope="col" ${column.key === state.sort.key ? `aria-sort="${state.sort.direction === 1 ? 'ascending' : 'descending'}"` : ''}><button type="button" data-sort="${escape(column.key)}">${escape(column.label)}${column.key === state.sort.key ? (state.sort.direction === 1 ? ' ↑' : ' ↓') : ''}</button></th>`).join('');
    const body = rows.slice(start,start+state.pageSize).map(row => `<tr>${cols.map(column => { const value = rowValue(row,column); const old = previous.get(row.key); const prior = old && column.metric ? old.metrics[column.key] : null; return `<td class="${column.metric || ['number','moneyMicros'].includes(column.type) ? 'num' : ''}" title="${escape(String(value ?? ''))}">${escape(formatValue(column.type === 'country' ? countryName(value) : value,column.type,currency))}${state.data.previous && column.metric ? `<small class="ads-cell-change">${escape(changeLabel(value,prior ?? (old ? null : 0),column.type))}</small>` : ''}</td>`; }).join('')}</tr>`).join('');
    $('adsTable').innerHTML = `${cols.length ? `<div class="ads-table-scroll" tabindex="0" role="region" aria-label="${escape(getReport(state.data.preset).label)} table"><table><thead><tr>${header}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}">No rows match this selection.</td></tr>`}</tbody></table></div>` : '<p>Select at least one column.</p>'}<div class="ads-pagination"><span>${rows.length ? `${start+1}–${Math.min(start+state.pageSize,rows.length)}` : '0'} of ${rows.length.toLocaleString()} rows</span><div><button type="button" data-page="previous" ${state.page === 0 ? 'disabled' : ''}>Previous</button><span>${state.page+1} / ${pages}</span><button type="button" data-page="next" ${state.page+1 >= pages ? 'disabled' : ''}>Next</button></div></div>`;
  }
  function exportCsv(daily = false) {
    const data = state.data;
    if (!data) return;
    const definition = getReport(data.preset);
    const metadata = [ ['Report',definition.label],['Customer ID',data.account.customerId],['Account',data.account.descriptiveName],['Currency',data.account.currencyCode],['Timezone',data.account.timeZone],['Report dates',`${data.range.startDate} / ${data.range.endDate}`],['Comparison dates',data.previous ? `${data.previous.startDate} / ${data.previous.endDate}` : 'None'],['Filters',JSON.stringify(data.filters)],['Generated at',data.generatedAt],['Coverage','Complete returned report; Google privacy and report coverage limits may apply'],['Note',definition.note],['Comparison scope',data.filters.thresholds.length ? 'Current-period entities; thresholds are not reapplied to the comparison' : 'Same filters in each period; includes previous-only activity'],['Table search',daily ? '' : state.search],[] ];
    const metrics = metricKeys(definition);
    const cols = daily ? [{key:'date',label:'Date'}, ...metrics.filter(key => !key.includes('Share')).map(key => ({key,label:ADS_METRICS[key].label,metric:true}))] : columns();
    const headerLabel = column => `${column.label}${['money','moneyMicros'].includes(column.type) ? ` (${data.account.currencyCode})` : ['percent','share'].includes(column.type) ? ' (ratio)' : ''}`;
    const headers = [...cols.map(headerLabel), ...(data.previous ? (daily ? ['Comparison date'] : []).concat(cols.filter(column => column.metric).map(column => `Previous ${headerLabel(column)}`)) : [])];
    const oldRows = new Map(data.previousRows.map(row => [row.key,row]));
    const rows = daily ? data.series : tableRows();
    const lines = rows.map((row,index) => {
      const old = daily ? data.previousSeries[index] : oldRows.get(row.key);
      const values = cols.map(column => { const value = daily ? row[column.key] : rowValue(row,column); return column.type === 'moneyMicros' && value != null ? Number(value)/1e6 : column.type === 'country' ? countryName(value) : value; });
      if (data.previous) { if (daily) values.push(old?.date || ''); values.push(...cols.filter(column => column.metric).map(column => daily ? old?.[column.key] ?? '' : old?.metrics[column.key] ?? '')); }
      return values;
    });
    if (daily && data.previousSeries.length > data.series.length) {
      for (const old of data.previousSeries.slice(data.series.length)) lines.push([...cols.map(() => ''), old.date, ...cols.filter(column => column.metric).map(column => old[column.key] ?? '')]);
    }
    const csv = '\uFEFF' + [...metadata,headers,...lines].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `google-ads-${data.account.customerId}-${data.preset}${daily ? '-daily' : ''}-${data.range.startDate}-${data.range.endDate}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function reset() {
    state.loadingFor = '';
    state.optionsToken++; invalidate(); state.accounts = []; state.options = null; state.optionsFor = ''; state.data = null;
    if ($('adsCustomer')) $('adsCustomer').innerHTML = option('','Load accessible accounts');
    if ($('adsResult')) $('adsResult').innerHTML = '';
    updateRunButton();
  }
  function mount() {
    const groups = [...new Set(Object.values(ADS_REPORTS).map(definition => definition.group))];
    $('adsPreset').innerHTML = groups.map(group => `<optgroup label="${escape(group)}">${Object.entries(ADS_REPORTS).filter(([,definition]) => definition.group === group).map(([id,definition]) => option(id,definition.label)).join('')}</optgroup>`).join('');
    $('adsPreset').value = 'account_overview';
    $('adsCustomer').addEventListener('change', () => void accountChanged());
    $('adsPreset').addEventListener('change', () => { invalidate(); updateReport(); });
    for (const id of ['adsRange','adsCompare','adsStart','adsEnd','adsCompareStart','adsCompareEnd']) $(id).addEventListener('change', () => { invalidate(); updateDates(); });
    $('adsFilters').addEventListener('input', () => { invalidate(); updateFilterCount(); });
    $('adsCampaign').addEventListener('change',fillAdGroups);
    $('adsAddThreshold').addEventListener('click',addThreshold);
    $('adsThresholds').addEventListener('click',event => { const button = event.target.closest('[data-remove-condition]'); if (button) { button.closest('.ads-threshold').remove(); invalidate(); updateFilterCount(); } });
    $('adsResetFilters').addEventListener('click', () => { document.querySelectorAll('#adsFilters input,#adsFilters select').forEach(el => { if (el.multiple) [...el.options].forEach(option => option.selected = false); else el.value = ''; }); $('adsThresholds').innerHTML = ''; fillAdGroups(); invalidate(); updateReport(); });
    $('adsResult').addEventListener('input', event => { if (event.target.id === 'adsTableSearch') { state.search = event.target.value; state.page = 0; renderTable(); } });
    $('adsResult').addEventListener('change', event => {
      if (event.target.id === 'adsPageSize') { state.pageSize = Number(event.target.value); state.page = 0; renderTable(); }
      if (event.target.id === 'adsChartMetric') { state.chartMetric = event.target.value; renderChart(); }
      if (event.target.dataset.column) { if (event.target.checked) state.visible.add(event.target.dataset.column); else state.visible.delete(event.target.dataset.column); renderTable(); }
    });
    $('adsResult').addEventListener('click',event => {
      const target = event.target.closest('button'); if (!target || !state.data) return;
      if (target.dataset.sort) { state.sort = {key:target.dataset.sort,direction:state.sort.key === target.dataset.sort ? -state.sort.direction : -1}; renderTable(); }
      if (target.dataset.page) { state.page += target.dataset.page === 'next' ? 1 : -1; renderTable(); }
      if (target.id === 'adsExport') exportCsv();
      if (target.id === 'adsExportDaily') exportCsv(true);
    });
    updateReport(); updateRunButton();
  }
  return { mount, setAccounts, accountChanged, run, reset };
}
