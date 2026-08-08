// popup.js — stable init + visual render; now mirrors signed-in email in sidebar credits.

const $ = id => document.getElementById(id);
const qsa = sel => Array.from(document.querySelectorAll(sel));
// safe binder
const on = (id, evt, fn) => {
  const el = $(id);
  if (el) el.addEventListener(evt, fn);
};


function surfaceError(e){
  console.error(e);
  clearResult(`❌ ${e?.message || e}`);
}
function safe(fn){ try { return fn(); } catch(e){ surfaceError(e); } }

/* ---------- shared single-calendar date ranges ---------- */
const DATE_RANGE_CONTROLS = new Map();
let OPEN_DATE_RANGE = null;
let OVERLAY_POSITION_FRAME = 0;

/* ==========================================================================
   VIEWPORT OVERLAY
   Popovers anchored to a control inside a scrolling panel get clipped by that
   panel. These lift the element to <body>, position it against the viewport,
   and put it back on close. Ported from the Codex build.
   ========================================================================== */
function overlayViewportBounds(){
  const edge = 12;
  const bounds = {
    top: edge,
    right: Math.max(edge, window.innerWidth - edge),
    bottom: Math.max(edge, window.innerHeight - edge),
    left: edge
  };
  const topbar = document.querySelector('.topbar');
  const topbarRect = topbar?.getBoundingClientRect();
  if (topbarRect && topbarRect.bottom > 0 && topbarRect.bottom < window.innerHeight){
    bounds.top = Math.max(bounds.top, topbarRect.bottom + 8);
  }
  const blockers = document.documentElement.dataset.mode === 'panel'
    ? [document.querySelector('.sidebar')]
    : [document.querySelector('.foot')];
  blockers.forEach(blocker => {
    if (!blocker || getComputedStyle(blocker).display === 'none') return;
    const rect = blocker.getBoundingClientRect();
    if (rect.top > bounds.top && rect.top < bounds.bottom){
      bounds.bottom = Math.min(bounds.bottom, rect.top - 8);
    }
  });
  return bounds;
}
function resetViewportOverlay(overlay){
  if (!overlay) return;
  overlay.classList.remove('viewport-overlay');
  overlay.removeAttribute('data-overlay-placement');
  ['top','right','bottom','left','width','maxHeight'].forEach(name => {
    overlay.style[name] = '';
  });
  const parent = overlay.__viewportOverlayParent;
  const next = overlay.__viewportOverlayNext;
  if (parent){
    if (next?.parentNode === parent) parent.insertBefore(overlay, next);
    else parent.appendChild(overlay);
  }
  delete overlay.__viewportOverlayParent;
  delete overlay.__viewportOverlayNext;
}
function mountViewportOverlay(overlay){
  if (!overlay || overlay.parentElement === document.body) return;
  overlay.__viewportOverlayParent = overlay.parentNode;
  overlay.__viewportOverlayNext = overlay.nextSibling;
  document.body.appendChild(overlay);
}
function positionViewportOverlay(anchor, overlay, {
  width=286,
  maxHeight=360,
  align='start'
} = {}){
  if (!anchor || !overlay || overlay.hidden || overlay.classList.contains('hidden')) return;
  const bounds = overlayViewportBounds();
  const anchorRect = anchor.getBoundingClientRect();
  const availableWidth = Math.max(0, bounds.right - bounds.left);
  const overlayWidth = Math.min(width, availableWidth);

  mountViewportOverlay(overlay);
  overlay.classList.add('viewport-overlay');
  overlay.style.width = `${overlayWidth}px`;
  overlay.style.maxHeight = 'none';
  overlay.style.top = '0px';
  overlay.style.left = '0px';

  const gap = 7;
  const naturalHeight = Math.min(Math.max(overlay.scrollHeight, overlay.offsetHeight), maxHeight);
  const roomBelow = Math.max(0, bounds.bottom - anchorRect.bottom - gap);
  const roomAbove = Math.max(0, anchorRect.top - bounds.top - gap);
  const placeAbove = naturalHeight > roomBelow && roomAbove > roomBelow;
  const availableHeight = Math.max(80, placeAbove ? roomAbove : roomBelow);
  const overlayHeight = Math.min(naturalHeight, availableHeight, maxHeight);
  let left = align === 'end' ? anchorRect.right - overlayWidth : anchorRect.left;
  left = Math.min(Math.max(left, bounds.left), bounds.right - overlayWidth);
  const top = placeAbove
    ? Math.max(bounds.top, anchorRect.top - gap - overlayHeight)
    : Math.min(anchorRect.bottom + gap, bounds.bottom - overlayHeight);

  overlay.style.left = `${Math.round(left)}px`;
  overlay.style.top = `${Math.round(top)}px`;
  overlay.style.maxHeight = `${Math.floor(overlayHeight)}px`;
  overlay.dataset.overlayPlacement = placeAbove ? 'top' : 'bottom';
}
function positionOpenOverlays(){
  if (OPEN_DATE_RANGE && !OPEN_DATE_RANGE.popover.hidden){
    positionViewportOverlay(OPEN_DATE_RANGE.trigger, OPEN_DATE_RANGE.popover, {
      width: 286,
      maxHeight: 360,
      align: 'start'
    });
  }
  const gaMenu = $('gaKeyEventMenu');
  if (gaMenu && !gaMenu.classList.contains('hidden')){
    positionViewportOverlay($('gaKeyEventToggle'), gaMenu, {
      width: 280,
      maxHeight: 300,
      align: document.documentElement.dataset.mode === 'panel' ? 'start' : 'end'
    });
  }
}
function scheduleOverlayPosition(){
  if (OVERLAY_POSITION_FRAME) return;
  OVERLAY_POSITION_FRAME = requestAnimationFrame(() => {
    OVERLAY_POSITION_FRAME = 0;
    positionOpenOverlays();
  });
}
window.addEventListener('resize', scheduleOverlayPosition);
document.addEventListener('scroll', scheduleOverlayPosition, true);

function dateRangeParse(value){
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}
function dateRangeIso(date){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function dateRangeShift(date, days){
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  next.setDate(next.getDate() + days);
  return next;
}
function dateRangeMaxDate(state){
  const max = new Date();
  max.setHours(12, 0, 0, 0);
  max.setDate(max.getDate() - Math.max(0, Number(state.root.dataset.maxOffset || 0)));
  return max;
}
function dateRangeFormat(value){
  const date = dateRangeParse(value);
  return date ? new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'short', year:'numeric' }).format(date) : '';
}
function dateRangeLabel(state){
  const start = state.start.value;
  const end = state.end.value;
  if (!start) return 'Select date range';
  if (!end) return `${dateRangeFormat(start)} – Select end`;
  // When both ends fall in the same year, print the year once. "15 Jun – 04 Aug
  // 2026" fits the control; the doubled year did not, and truncated to "04 A…".
  const sameYear = String(start).slice(0, 4) === String(end).slice(0, 4);
  const startText = sameYear
    ? dateRangeFormat(start).replace(/\s+\d{4}$/, '')
    : dateRangeFormat(start);
  return `${startText} – ${dateRangeFormat(end)}`;
}
function dateRangeSync(state){
  if (!state) return;
  const value = state.root.querySelector('[data-date-range-value]');
  if (value) value.textContent = dateRangeLabel(state);
  state.trigger.title = dateRangeLabel(state);
}
function dateRangeClose(state, { restoreFocus=false } = {}){
  if (!state) return;
  state.popover.hidden = true;
  resetViewportOverlay(state.popover);
  state.trigger.setAttribute('aria-expanded', 'false');
  state.selecting = false;
  state.draftStart = '';
  state.hover = '';
  if (OPEN_DATE_RANGE === state) OPEN_DATE_RANGE = null;
  if (restoreFocus) state.trigger.focus();
}
function dateRangeRender(state){
  const first = new Date(state.view.getFullYear(), state.view.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = dateRangeShift(first, -offset);
  const maxDate = dateRangeMaxDate(state);
  const maxIso = dateRangeIso(maxDate);
  const nextMonth = new Date(first.getFullYear(), first.getMonth() + 1, 1, 12);
  const maxMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1, 12);
  const rangeStart = state.selecting ? state.draftStart : state.start.value;
  const rangeEnd = state.selecting ? state.hover : state.end.value;
  const low = rangeStart && rangeEnd ? (rangeStart < rangeEnd ? rangeStart : rangeEnd) : '';
  const high = rangeStart && rangeEnd ? (rangeStart > rangeEnd ? rangeStart : rangeEnd) : '';
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric' }).format(first);
  const weekdays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const days = Array.from({ length:42 }, (_, index) => {
    const date = dateRangeShift(gridStart, index);
    const iso = dateRangeIso(date);
    const outside = date.getMonth() !== first.getMonth();
    const disabled = iso > maxIso;
    const isStart = !!rangeStart && iso === rangeStart;
    const isEnd = !!rangeEnd && iso === rangeEnd;
    const inRange = !!low && iso >= low && iso <= high;
    const isToday = iso === dateRangeIso(new Date());
    const classes = [
      'date-range-day', outside ? 'is-outside' : '', disabled ? 'is-disabled' : '',
      inRange ? 'is-in-range' : '', isStart ? 'is-start' : '', isEnd ? 'is-end' : '',
      isToday ? 'is-today' : ''
    ].filter(Boolean).join(' ');
    const fullLabel = new Intl.DateTimeFormat('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(date);
    return `<button type="button" class="${classes}" data-range-day="${iso}" aria-label="${fullLabel}" ${disabled ? 'disabled' : ''}>${date.getDate()}</button>`;
  }).join('');

  state.popover.innerHTML = `
    <div class="date-range-calendar__head">
      <button type="button" class="date-range-nav" data-range-nav="prev" aria-label="Previous month">&#8249;</button>
      <strong>${monthLabel}</strong>
      <button type="button" class="date-range-nav" data-range-nav="next" aria-label="Next month" ${nextMonth > maxMonth ? 'disabled' : ''}>&#8250;</button>
    </div>
    <div class="date-range-weekdays" aria-hidden="true">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
    <div class="date-range-days" role="grid">${days}</div>
    <div class="date-range-calendar__foot">
      <span>${state.selecting ? 'Choose the end date' : (state.start.value && state.end.value ? dateRangeLabel(state) : 'Choose the start date')}</span>
    </div>`;
}
function dateRangeOpen(state){
  if (!state) return;
  if (OPEN_DATE_RANGE && OPEN_DATE_RANGE !== state) dateRangeClose(OPEN_DATE_RANGE);
  const initial = dateRangeParse(state.start.value) || dateRangeParse(state.end.value) || dateRangeMaxDate(state);
  state.view = new Date(initial.getFullYear(), initial.getMonth(), 1, 12);
  state.selecting = false;
  state.draftStart = '';
  state.hover = '';
  dateRangeRender(state);
  state.popover.hidden = false;
  state.trigger.setAttribute('aria-expanded', 'true');
  OPEN_DATE_RANGE = state;
  positionOpenOverlays();
  requestAnimationFrame(() => {
    const focusIso = state.start.value || dateRangeIso(dateRangeMaxDate(state));
    state.popover.querySelector(`[data-range-day="${focusIso}"]`)?.focus({ preventScroll:true });
    // Swapping the preset select for the custom control can move the scroll
    // container a frame later. Re-anchor once that layout has settled.
    positionOpenOverlays();
  });
}
function dateRangeOpenFor(startId){
  const state = DATE_RANGE_CONTROLS.get(startId);
  if (state) requestAnimationFrame(() => dateRangeOpen(state));
}
function syncDateRangeControl(startId){
  dateRangeSync(DATE_RANGE_CONTROLS.get(startId));
}
function setDateRangeMode(selectId, startId, custom, { open=false } = {}){
  const select = $(selectId);
  const state = DATE_RANGE_CONTROLS.get(startId);
  const root = state?.root || qsa('[data-date-range]').find(item => item.dataset.startId === startId);
  if (!select || !root) return;
  if (!custom && select.value !== 'custom') select.dataset.lastPreset = select.value;
  select.classList.toggle('date-range-preset-hidden', !!custom);
  root.classList.toggle('hidden', !custom);
  if (custom && open) dateRangeOpenFor(startId);
  if (!custom && state && !state.popover.hidden) dateRangeClose(state);
}
function dateRangeChoose(state, iso){
  if (!state.selecting){
    state.selecting = true;
    state.draftStart = iso;
    state.hover = iso;
    dateRangeRender(state);
    state.popover.querySelector(`[data-range-day="${iso}"]`)?.focus();
    return;
  }
  const start = iso < state.draftStart ? iso : state.draftStart;
  const end = iso < state.draftStart ? state.draftStart : iso;
  state.start.value = start;
  state.end.value = end;
  dateRangeSync(state);
  dateRangeClose(state, { restoreFocus:true });
  state.end.dispatchEvent(new Event('change', { bubbles:true }));
}
function mountDateRanges(){
  qsa('[data-date-range]').forEach(root => {
    const start = $(root.dataset.startId);
    const end = $(root.dataset.endId);
    const trigger = root.querySelector('[data-date-range-trigger]');
    const popover = root.querySelector('[data-date-range-popover]');
    if (!start || !end || !trigger || !popover || root.dataset.dateRangeMounted) return;
    root.dataset.dateRangeMounted = 'true';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-label', 'Choose date range');
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Choose a start and end date');
    const rangeSelect = $(root.dataset.rangeSelectId);
    const presets = root.querySelector('[data-date-range-presets]');
    const state = { root, start, end, trigger, popover, rangeSelect, view:new Date(), selecting:false, draftStart:'', hover:'' };
    DATE_RANGE_CONTROLS.set(start.id, state);
    if (rangeSelect){
      if (rangeSelect.value !== 'custom') rangeSelect.dataset.lastPreset = rangeSelect.value;
      rangeSelect.addEventListener('change', () => {
        if (rangeSelect.value !== 'custom') rangeSelect.dataset.lastPreset = rangeSelect.value;
      });
      setDateRangeMode(rangeSelect.id, start.id, rangeSelect.value === 'custom');
    }
    dateRangeSync(state);
    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (popover.hidden) dateRangeOpen(state);
      else dateRangeClose(state);
    });
    presets?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!rangeSelect) return;
      dateRangeClose(state);
      const fallback = rangeSelect.dataset.lastPreset
        || Array.from(rangeSelect.options || []).find(option => option.value === '28')?.value
        || Array.from(rangeSelect.options || []).find(option => option.value !== 'custom')?.value
        || '';
      rangeSelect.value = fallback;
      setDateRangeMode(rangeSelect.id, start.id, false);
      rangeSelect.dispatchEvent(new Event('change', { bubbles:true }));
      rangeSelect.focus();
    });
    popover.addEventListener('click', event => {
      // Rendering a new month/day grid detaches the clicked button before the
      // event reaches document. Keep calendar interactions inside this control
      // so the outside-click handler cannot mistake them for external clicks.
      event.stopPropagation();
      const nav = event.target.closest('[data-range-nav]')?.dataset.rangeNav;
      if (nav){
        state.view = new Date(state.view.getFullYear(), state.view.getMonth() + (nav === 'next' ? 1 : -1), 1, 12);
        dateRangeRender(state);
        state.popover.querySelector(`[data-range-nav="${nav}"]:not(:disabled)`)?.focus();
        return;
      }
      const iso = event.target.closest('[data-range-day]:not(:disabled)')?.dataset.rangeDay;
      if (iso) dateRangeChoose(state, iso);
    });
    popover.addEventListener('mouseover', event => {
      if (!state.selecting) return;
      const iso = event.target.closest('[data-range-day]:not(:disabled)')?.dataset.rangeDay;
      if (!iso || iso === state.hover) return;
      state.hover = iso;
      dateRangeRender(state);
    });
    popover.addEventListener('keydown', event => {
      if (event.key === 'Escape'){
        event.preventDefault();
        dateRangeClose(state, { restoreFocus:true });
        return;
      }
      const current = event.target.closest('[data-range-day]')?.dataset.rangeDay;
      const steps = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7 };
      if (!current || steps[event.key] == null) return;
      event.preventDefault();
      const next = dateRangeShift(dateRangeParse(current), steps[event.key]);
      if (dateRangeIso(next) > dateRangeIso(dateRangeMaxDate(state))) return;
      if (next.getMonth() !== state.view.getMonth()){
        state.view = new Date(next.getFullYear(), next.getMonth(), 1, 12);
        dateRangeRender(state);
      }
      state.popover.querySelector(`[data-range-day="${dateRangeIso(next)}"]`)?.focus();
    });
  });
  document.addEventListener('click', event => {
    if (!OPEN_DATE_RANGE) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const clickedInside = path.includes(OPEN_DATE_RANGE.root)
      || OPEN_DATE_RANGE.root.contains(event.target);
    if (!clickedInside) dateRangeClose(OPEN_DATE_RANGE);
  });
}


const SIDEBAR_STATE_KEY = 'mc_sidebar_collapsed';
function isCompactPopup(){
  const root = document.documentElement;
  if (!root || root.dataset.mode !== 'popup') return false;
  const width = window.innerWidth || root.clientWidth || 0;
  const height = window.innerHeight || root.clientHeight || 0;
  return width <= 800 && height <= 600;
}
function shouldPersistSidebarState(){
  return !isCompactPopup();
}
function setSidebarCollapsed(collapsed, persist=true){
  const shell = document.querySelector('.shell');
  if(!shell) return;
  shell.classList.toggle('sidebar-collapsed', !!collapsed);
  if(persist && chrome?.storage?.local){ chrome.storage.local.set({[SIDEBAR_STATE_KEY]: !!collapsed}); }
}
async function initSidebarUX(){
  if (isCompactPopup()) {
    setSidebarCollapsed(true, false);
  } else {
    try{
      const v = await chrome.storage.local.get(SIDEBAR_STATE_KEY);
      setSidebarCollapsed(!!v[SIDEBAR_STATE_KEY], false);
    }catch(e){ /* ignore */ }
  }
  on('collapseSidebar','click', ()=> {
    const shell = document.querySelector('.shell');
    setSidebarCollapsed(!shell?.classList.contains('sidebar-collapsed'), shouldPersistSidebarState());
  });
  on('sidebarFab','click', ()=>setSidebarCollapsed(false, shouldPersistSidebarState()));
}

const state = {
  sites: [],
  perf: { range:'30', wholeProperty:false, cache:null },
  callrail: { inited:false, last:null },
  ui: {
    siteFilter:'',
    sitesCache:null,
    panelLoads: {
      onPage: false,
      structuredData: false
    }
  }
};

function formatRelativeTime(ts){
  const value = Number(ts || 0);
  if (!value) return '';
  const diff = Math.max(0, Date.now() - value);
  if (diff < 45000) return 'just now';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
function buildCacheText(cache, labels={}){
  if (!cache) return '';
  const when = formatRelativeTime(cache.fetchedAt);
  const suffix = when ? ` ${when}` : '';
  if (cache.stale) return `${labels.stale || 'Refresh failed. Showing cached data'}${suffix}.`;
  if (cache.source === 'cache') return `${labels.cached || 'Using cached data'}${suffix}.`;
  if (cache.source === 'mixed') return `${labels.mixed || 'Using a mix of fresh and cached data'}${suffix}.`;
  return `${labels.network || 'Updated'}${suffix}.`;
}
function setCacheNote(id, cache, labels={}){
  const el = $(id);
  if (!el) return;
  const text = buildCacheText(cache, labels);
  el.textContent = text;
  el.classList.toggle('hidden', !text);
  el.classList.toggle('is-stale', !!cache?.stale);
}
function combineCacheMeta(items){
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  const source = list.every(item => item.source === 'network')
    ? 'network'
    : list.every(item => item.source === 'cache')
      ? 'cache'
      : 'mixed';
  const fetchedAt = list.reduce((max, item) => Math.max(max, Number(item?.fetchedAt || 0)), 0);
  return {
    source,
    fetchedAt,
    stale: list.some(item => item.stale)
  };
}

function kv(k,v){ return `<div class="row kv"><div class="k">${k}</div><div>${v}</div></div>`; }
function badge(s, cls=''){ return `<span class="badge ${cls}">${s}</span>`; }
function stateBadge(s){
  const t = String(s||'').toLowerCase();
  if(/(valid|passed|ok|good|on google|submitted|success|100|90|allowed)/.test(t)) return badge(s,'good');
  if(/(warning|partial|unknown|needs|medium)/.test(t)) return badge(s,'ok');
  if(/(error|fail|not on google|blocked|denied|slow|poor|noindex)/.test(t)) return badge(s,'bad');
  return badge(s);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]
  ));
}
function formatDurationShort(seconds){
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  if (!total) return '0s';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
function formatMetricValue(value, type='number', digits=0){
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  if (type === 'percent') return `${(num * 100).toFixed(digits)}%`;
  if (type === 'decimal') return num.toFixed(digits);
  if (type === 'duration') return formatDurationShort(num);
  if (digits > 0) {
    return num.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }
  return num.toLocaleString();
}
function metricDelta(curr, prev, { inverse=false, digits=1 } = {}){
  const currentValue = Number(curr);
  const prevValue = Number(prev);
  if (!Number.isFinite(currentValue) || !Number.isFinite(prevValue) || prevValue === 0) {
    return { text:'—', cls:'' };
  }
  const delta = ((currentValue - prevValue) / prevValue) * 100;
  const isPositive = delta >= 0;
  const cls = delta === 0 ? '' : ((inverse ? !isPositive : isPositive) ? 'up' : 'down');
  return {
    text: `${delta > 0 ? '+' : ''}${delta.toFixed(digits)}%`,
    cls
  };
}
function toFiniteSeries(values){
  return (values || []).map(value => Number(value || 0)).filter(value => Number.isFinite(value));
}
function buildTrendSVG(values, { width=220, height=44, padding=2, compareValues=null } = {}){
  const nums = toFiniteSeries(values);
  if (!nums.length) return '';
  const compare = toFiniteSeries(compareValues);
  const pool = compare.length ? nums.concat(compare) : nums;
  const min = Math.min(...pool);
  const max = Math.max(...pool);
  const sy = value => max === min
    ? height / 2
    : padding + (height - padding * 2) * (1 - (value - min) / (max - min));
  const pathFor = series => {
    if (!series.length) return '';
    const step = index => padding + (index * (width - padding * 2) / Math.max(1, series.length - 1));
    let d = '';
    series.forEach((value, index) => {
      d += `${index ? ' L' : 'M'}${step(index).toFixed(1)} ${sy(value).toFixed(1)}`;
    });
    return d;
  };
  const linePath = pathFor(nums);
  const sx = index => padding + (index * (width - padding * 2) / Math.max(1, nums.length - 1));
  const lastX = sx(nums.length - 1).toFixed(1);
  const areaPath = `${linePath} L${lastX} ${(height - padding).toFixed(1)} L${sx(0).toFixed(1)} ${(height - padding).toFixed(1)} Z`;
  const comparePath = compare.length > 1 ? pathFor(compare) : '';
  return `
    <svg class="insight-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${areaPath}" fill="rgba(57,224,122,.08)"></path>
      ${comparePath ? `<path d="${comparePath}" fill="none" stroke="rgba(163,182,171,.5)" stroke-width="1.6" stroke-dasharray="4 4" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
      <path d="${linePath}" fill="none" stroke="rgba(57,224,122,.95)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}
function formatPointDelta(curr, prev, { inverse=false, digits=1 } = {}){
  const currentValue = Number(curr);
  const prevValue = Number(prev);
  if (!Number.isFinite(currentValue) || !Number.isFinite(prevValue)) return { text:'—', cls:'' };
  const delta = (currentValue - prevValue) * 100;
  if (Math.abs(delta) < 0.05) return { text:'0.0pt', cls:'' };
  const isPositive = delta > 0;
  return {
    text: `${isPositive ? '+' : ''}${delta.toFixed(digits)}pt`,
    cls: (inverse ? !isPositive : isPositive) ? 'up' : 'down'
  };
}
function formatAbsDelta(curr, prev, { inverse=false, digits=1 } = {}){
  const currentValue = Number(curr);
  const prevValue = Number(prev);
  if (!Number.isFinite(currentValue) || !Number.isFinite(prevValue)) return { text:'—', cls:'' };
  const delta = currentValue - prevValue;
  if (Math.abs(delta) < 0.05) return { text:'0.0', cls:'' };
  const isPositive = delta > 0;
  return {
    text: `${isPositive ? '+' : ''}${delta.toFixed(digits)}`,
    cls: (inverse ? !isPositive : isPositive) ? 'up' : 'down'
  };
}
function buildInsightVerdict(verdict){
  if (!verdict || !verdict.text) return '';
  const tone = ['good', 'bad', 'warn'].includes(verdict.tone) ? verdict.tone : 'neutral';
  return `
    <div class="insight-verdict is-${tone}">
      <span class="insight-verdict__dot" aria-hidden="true"></span>
      <span>${verdict.html || escapeHtml(verdict.text)}</span>
    </div>
  `;
}
function buildInsightMoversSection(section){
  if (!section || !Array.isArray(section.rows) || !section.rows.length) return '';
  return `
    <section class="insight-block">
      <h4>${escapeHtml(section.title)}</h4>
      <div class="insight-movers">
        ${section.rows.map(row => `
          <div class="insight-mover">
            <span class="insight-mover__label" title="${escapeHtml(row.label || '—')}">${escapeHtml(row.label || '—')}</span>
            <span class="insight-mover__right">
              ${row.meta ? `<span class="insight-mover__meta">${escapeHtml(row.meta)}</span>` : ''}
              <span class="insight-mover__delta ${escapeHtml(row.cls || '')}">${escapeHtml(row.delta || '—')}</span>
            </span>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}
function buildInsightBandsSection(section){
  if (!section || !Array.isArray(section.bands) || !section.bands.length) return '';
  const max = Math.max(1, ...section.bands.map(band => Number(band.value || 0)));
  return `
    <section class="insight-block">
      <h4>${escapeHtml(section.title)}</h4>
      <div class="insight-bands">
        ${section.bands.map(band => {
          const value = Number(band.value || 0);
          const pct = Math.max(6, Math.round((value / max) * 100));
          return `
            <div class="insight-band tone-${escapeHtml(band.tone || 'mid')}">
              <span class="insight-band__bar" style="height:${pct * 0.6}px"></span>
              <span class="insight-band__label"><b>${escapeHtml(formatMetricValue(value))}</b>${escapeHtml(band.label)}</span>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}
function buildInsightCompositionSection(section){
  if (!section || !Array.isArray(section.parts) || !section.parts.length) return '';
  const total = section.parts.reduce((sum, part) => sum + Number(part.value || 0), 0);
  if (!total) return '';
  return `
    <section class="insight-block">
      <h4>${escapeHtml(section.title)}</h4>
      <div class="insight-composition">
        <div class="insight-composition__bar">
          ${section.parts.map(part => {
            const pct = (Number(part.value || 0) / total) * 100;
            return `<span class="insight-composition__seg tone-${escapeHtml(part.tone || 'ok')}" style="width:${pct.toFixed(2)}%"></span>`;
          }).join('')}
        </div>
        <div class="insight-composition__key">
          ${section.parts.map(part => {
            const pct = (Number(part.value || 0) / total) * 100;
            return `<span><i class="tone-${escapeHtml(part.tone || 'ok')}"></i>${escapeHtml(part.label)} ${escapeHtml(formatMetricValue(part.value))} · ${pct.toFixed(1)}%</span>`;
          }).join('')}
        </div>
      </div>
    </section>
  `;
}
function buildInsightCompareSection(section){
  if (!section || !Array.isArray(section.items) || !section.items.length) return '';
  const max = Math.max(1, ...section.items.flatMap(item => [Number(item.value || 0), Number(item.prevValue || 0)]));
  const hasPrev = section.items.some(item => Number.isFinite(Number(item.prevValue)) && Number(item.prevValue) > 0);
  return `
    <section class="insight-block">
      <h4>${escapeHtml(section.title)}</h4>
      ${hasPrev ? `
        <div class="insight-spark-legend">
          <span><i style="background:linear-gradient(90deg,#39e07a,#28c965)"></i>This period</span>
          <span><i style="background:rgba(163,182,171,.32)"></i>Previous</span>
        </div>
      ` : ''}
      <div class="insight-compare">
        ${section.items.map(item => {
          const value = Number(item.value || 0);
          const prevValue = Number(item.prevValue || 0);
          const currWidth = Math.max(2, Math.round((value / max) * 100));
          const prevWidth = Math.max(0, Math.round((prevValue / max) * 100));
          const delta = item.delta || { text:'', cls:'' };
          return `
            <div class="insight-compare__row">
              <div class="insight-compare__head">
                <span class="insight-compare__name" title="${escapeHtml(item.label || '—')}">${escapeHtml(item.label || '—')}</span>
                <span class="insight-compare__val">${escapeHtml(item.displayValue || formatMetricValue(value))}${delta.text ? `<small class="${escapeHtml(delta.cls || '')}">${escapeHtml(delta.text)}</small>` : ''}</span>
              </div>
              <div class="insight-compare__track">
                ${hasPrev ? `<span class="insight-compare__prev" style="width:${prevWidth}%"></span>` : ''}
                <span class="insight-compare__curr ${escapeHtml(delta.cls === 'down' ? 'down' : '')}" style="width:${currWidth}%"></span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}
function buildInsightDetailsSection(section){
  if (!section) return '';
  const inner = section.table ? buildInsightTableSection(Object.assign({ title:'' }, section.table)) : '';
  if (!inner) return '';
  const body = inner.replace(/<h4>[\s\S]*?<\/h4>/, '');
  return `
    <details class="insight-details">
      <summary>
        <span>${escapeHtml(section.label || 'View full detail')}</span>
        ${section.hint ? `<span class="insight-details__hint">${escapeHtml(section.hint)}</span>` : ''}
      </summary>
      <div class="insight-details__body">${body}</div>
    </details>
  `;
}
function buildInsightSections(sections){
  return (sections || []).filter(Boolean).map(section => {
    switch (section.type){
      case 'movers': return buildInsightMoversSection(section);
      case 'bands': return buildInsightBandsSection(section);
      case 'composition': return buildInsightCompositionSection(section);
      case 'compare': return buildInsightCompareSection(section);
      case 'details': return buildInsightDetailsSection(section);
      case 'table': return buildInsightTableSection(section);
      case 'bars': return buildInsightBarSection(section);
      default: return '';
    }
  }).join('');
}
function buildInsightTableSection(section){
  if (!section || !Array.isArray(section.columns) || !section.columns.length || !Array.isArray(section.rows) || !section.rows.length) {
    return '';
  }
  const head = section.columns.map(column => `<th class="${column.numeric ? 'num' : ''}">${escapeHtml(column.label)}</th>`).join('');
  const body = section.rows.map(row => `
    <tr>
      ${section.columns.map((column, index) => {
        const value = row[index] == null || row[index] === '' ? '—' : row[index];
        return `<td class="${column.numeric ? 'num' : ''}">${escapeHtml(value)}</td>`;
      }).join('')}
    </tr>
  `).join('');
  return `
    <section class="insight-block">
      <h4>${escapeHtml(section.title)}</h4>
      <div class="insight-table-shell">
        <table class="insight-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
}
function buildInsightBarSection(section){
  if (!section || !Array.isArray(section.items) || !section.items.length) return '';
  const max = Math.max(1, ...section.items.map(item => Number(item?.value || 0)));
  return `
    <section class="insight-block">
      <h4>${escapeHtml(section.title)}</h4>
      <div class="insight-bars">
        ${section.items.map(item => {
          const value = Number(item?.value || 0);
          const width = Math.max(2, Math.round((value / max) * 100));
          return `
            <div class="insight-bar-row">
              <span class="insight-bar-label">${escapeHtml(item.label || '—')}</span>
              <div class="insight-bar-track">
                <span class="insight-bar-fill" style="width:${width}%"></span>
              </div>
              <strong class="insight-bar-value">${escapeHtml(item.displayValue || formatMetricValue(value))}</strong>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}
function buildInsightTrend(trend){
  if (!trend) return '';
  const values = toFiniteSeries(trend.values);
  if (values.length < 2) return '';
  // Guard: a line implies a continuous axis. Categorical data must never be drawn
  // as a trend, so callers have to opt in explicitly with isTimeSeries.
  if (trend.isTimeSeries !== true) return '';
  const legend = trend.compareValues && toFiniteSeries(trend.compareValues).length > 1
    ? `<div class="insight-spark-legend">
         <span><i style="background:#39e07a"></i>This period</span>
         <span><i style="background:rgba(163,182,171,.5)"></i>Previous period</span>
       </div>`
    : '';
  return `
    <div class="insight-spark-wrap${trend.wide === false ? '' : ' is-wide'}">
      ${buildTrendSVG(values, {
        width: 600,
        height: trend.wide === false ? 44 : 88,
        compareValues: trend.compareValues || null
      })}
      ${trend.label ? `<span class="insight-spark-label">${escapeHtml(trend.label)}</span>` : ''}
      ${legend}
    </div>
  `;
}
function buildInsightStage({ eyebrow='', title='', rangeLabel='', subtitle='', badges=[], kpis=[], verdict=null, trend=null, sections=[], sparklineValues=[], sparklineLabel='', tableSections=[], barSections=[] }){
  const titleMarkup = rangeLabel
    ? `${escapeHtml(title)} <span class="insight-range">(${escapeHtml(rangeLabel)})</span>`
    : escapeHtml(title);
  return `
    <div class="result-stage insight-stage">
      <div class="result-stage__head">
        <div>
          ${eyebrow ? `<span class="eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
          <h3 class="insight-title">${titleMarkup}</h3>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${badges.length ? `
          <div class="meta-line insight-meta">
            ${badges.map(text => badge(escapeHtml(text))).join('')}
          </div>
        ` : ''}
      </div>
      ${buildInsightVerdict(verdict)}
      ${kpis.length ? `
        <div class="insight-kpi-grid"${kpis.length === 3 ? ' style="grid-template-columns:repeat(3, minmax(0, 1fr))"' : ''}>
          ${kpis.map(item => {
            const delta = item.delta || { text:'—', cls:'' };
            return `
              <article class="insight-kpi">
                <span class="insight-kpi__label">${escapeHtml(item.label)}</span>
                <div class="insight-kpi__value">
                  <strong>${escapeHtml(item.value)}</strong>
                  <span class="insight-kpi__delta ${escapeHtml(delta.cls || '')}">${escapeHtml(delta.text || '—')}</span>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      ` : ''}
      ${buildInsightTrend(trend)}
      ${buildInsightSections(sections)}
      ${sparklineValues.length && !trend ? `
        <div class="insight-spark-wrap">
          ${buildTrendSVG(sparklineValues)}
          ${sparklineLabel ? `<span class="insight-spark-label">${escapeHtml(sparklineLabel)}</span>` : ''}
        </div>
      ` : ''}
      ${tableSections.map(buildInsightTableSection).join('')}
      ${barSections.map(buildInsightBarSection).join('')}
    </div>
  `;
}
const MAIN_EMPTY_STATE = `
  <div class="empty-state">
    <span class="empty-state__icon">↗</span>
    <div>
      <strong>Pick a workflow and run a check.</strong>
      <p>Indexing, Tag Assistant, performance, and on-page audits render here after each action.</p>
    </div>
  </div>
`;
const PANEL_STATE = {
  navBlend: {
    showSCContext: false
  },
  navIndex: {
    showSCContext: true
  },
  navAnalytics: {
    showSCContext: false
  },
  navPerf: {
    showSCContext: true
  },
  navCallRail: {
    showSCContext: false
  },
  navOnPage: {
    showSCContext: false
  },
  navStructuredData: {
    showSCContext: false
  },
  navSettings: {
    showSCContext: false
  }
};
const RESULT_TARGETS = {
  navBlend: 'blendResult',
  navIndex: 'indexResult',
  navPerf: 'perfResult',
  navOnPage: 'onPageResult',
  navStructuredData: 'structuredDataResult',
  navAnalytics: 'gaResult',
  navCallRail: 'crResult'
};
function animateIn(el){
  if (!el) return;
  el.classList.remove('is-entering');
  void el.offsetWidth;
  el.classList.add('is-entering');
}
function inferStatusTone(msg=''){
  const text = String(msg).toLowerCase();
  if (/(❌|error|failed|denied|invalid|could not|not available)/.test(text)) return 'error';
  if (/(⚠️|warning|pick|select|enter|sign in|no data)/.test(text)) return 'warn';
  return 'info';
}
function statusCard(msg, { actionLabel='', actionType='', actionTarget='', forceTone='' } = {}){
  const tone = forceTone || inferStatusTone(msg);
  const icon = tone === 'error' ? '!' : tone === 'warn' ? '•' : 'i';
  const action = actionLabel && actionType && actionTarget
    ? `<button type="button" class="status-card__action" data-status-${actionType}="${escapeHtml(actionTarget)}">${escapeHtml(actionLabel)}</button>`
    : '';
  return `
    <div class="status-card ${tone}">
      <span class="status-card__icon">${icon}</span>
      <div>
        <strong>${tone === 'error' ? 'Something needs attention' : tone === 'warn' ? 'Action needed' : 'Status update'}</strong>
        <p>${escapeHtml(msg)}</p>
        ${action}
      </div>
    </div>
  `;
}
function apiErrorFromResponse(response, fallback='Request failed.'){
  const error = new Error(response?.error || fallback);
  error.code = response?.code || 'unknown';
  error.retryable = !!response?.retryable;
  error.retryAfterSeconds = Math.max(0, Number(response?.retryAfterSeconds || 0));
  error.detail = response?.detail || '';
  return error;
}
function normalizeApiError(error){
  if (error instanceof Error) return error;
  return apiErrorFromResponse(error, String(error || 'Request failed.'));
}
function statusCardForError(error, { retryTarget='' } = {}){
  const current = normalizeApiError(error);
  if (current.code === 'auth_required' || current.code === 'auth_expired'){
    return statusCard(current.message, { actionLabel:'Open Settings', actionType:'nav', actionTarget:'navSettings', forceTone:'error' });
  }
  if (current.retryable && retryTarget){
    return statusCard(current.message, { actionLabel:'Retry', actionType:'retry', actionTarget:retryTarget, forceTone:'error' });
  }
  return statusCard(current.message, { forceTone:'error' });
}
function renderApiError(targetId, error, retryTarget=''){
  renderHtml(targetId, statusCardForError(error, { retryTarget }));
}
function renderHtml(targetId, html){
  const resolvedId = targetId === 'result' ? (RESULT_TARGETS[document.querySelector('.nav button.active')?.id || 'navPerf'] || 'perfResult') : targetId;
  const el = $(resolvedId);
  if (!el) return;
  el.innerHTML = html;
  animateIn(el);
}
function setPropertyMatch(title, message){
  const el = $('propertyMatch');
  if (!el) return;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
}
function setPanelContext(navId){
  const copy = PANEL_STATE[navId] || PANEL_STATE.navPerf;
  $('scContext')?.classList.toggle('hidden', !copy.showSCContext);
}
function clearResult(msg, targetId){
  const resolvedId = targetId || RESULT_TARGETS[document.querySelector('.nav button.active')?.id || 'navPerf'] || 'perfResult';
  const el = $(resolvedId); if (!el) return;
  if (!msg) {
    el.innerHTML = '';
  } else {
    el.innerHTML = statusCard(msg);
  }
  animateIn(el);
}

/* ---------- URL & property helpers ---------- */
function normalizeUrl(raw){
  if (!raw) return null;
  let u = String(raw).trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const p = new URL(u);
    if (!/^https?:$/.test(p.protocol)) return null;
    p.hash=''; p.username=''; p.password='';
    const host = p.hostname;
    if (host === 'localhost' || host.endsWith('.local') ||
        /^127\./.test(host) || /^10\./.test(host) ||
        /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
    return p.toString();
  } catch { return null; }
}
function propertyCoversUrl(siteUrl, url){
  try{
    if(siteUrl.startsWith('sc-domain:')){
      const domain = siteUrl.split(':')[1];
      const u = new URL(url);
      return u.hostname === domain || u.hostname.endsWith('.'+domain);
    }
    return url.startsWith(siteUrl);
  }catch{ return false; }
}
function setSites(sites){
  state.sites = sites || [];
  const sel = $('sites'); if(!sel) return;
  sel.innerHTML = '';
  for(const s of state.sites){
    const opt = document.createElement('option');
    opt.value = s.siteUrl;
    opt.textContent = s.siteUrl + (s.permissionLevel ? `  (${s.permissionLevel})` : '');
    sel.appendChild(opt);
  }
  syncSitePickerLabel();
  renderSitePicker();
  autoSelectPropertyForUrl();
}
function syncSitePickerLabel(){
  const label = $('sitePickerLabel');
  const sel = $('sites');
  if (!label || !sel) return;
  label.textContent = sel.options.length ? (sel.selectedOptions?.[0]?.textContent || 'Select property') : 'No properties';
}
function renderSitePicker(filterText=''){
  const list = $('sitePickerList');
  const sel = $('sites');
  if (!list || !sel) return;
  const current = sel.value || '';
  const needle = String(filterText || state.ui.siteFilter || '').trim().toLowerCase();
  const items = state.sites.filter(site => {
    if (!needle) return true;
    const hay = `${site.siteUrl} ${site.permissionLevel || ''}`.toLowerCase();
    return hay.includes(needle);
  });
  if (!items.length){
    list.innerHTML = `<div class="picker-empty">No matches.</div>`;
    return;
  }
  list.innerHTML = items.map(site => {
    const active = site.siteUrl === current ? ' active' : '';
    return `
      <button class="picker-option${active}" type="button" data-site-value="${escapeHtml(site.siteUrl)}">
        <span>${escapeHtml(site.siteUrl)}</span>
        <small>${escapeHtml(site.permissionLevel || 'Unknown')}</small>
      </button>
    `;
  }).join('');
  qsa('.picker-option').forEach(btn => {
    btn.addEventListener('click', ()=>{
      const value = btn.dataset.siteValue || '';
      setSelectedSite(value, 'manual');
      closeSitePicker();
    });
  });
}
function openSitePicker(){
  $('sitePickerMenu')?.classList.remove('hidden');
  $('sitePickerToggle')?.setAttribute('aria-expanded', 'true');
  const search = $('sitePickerSearch');
  if (search){
    search.value = state.ui.siteFilter || '';
    search.focus();
    search.select();
  }
}
function closeSitePicker(){
  $('sitePickerMenu')?.classList.add('hidden');
  $('sitePickerToggle')?.setAttribute('aria-expanded', 'false');
}
function setSelectedSite(siteUrl, mode='manual'){
  const sel = $('sites');
  if (!sel || !siteUrl) return;
  sel.value = siteUrl;
  syncSitePickerLabel();
  renderSitePicker(state.ui.siteFilter || '');
  updatePropertyMeta(mode, mode === 'auto' ? siteUrl : '');
  setEnabled();
}
function getPermissionFor(siteUrl){
  const entry = (state.sites || []).find(s => s.siteUrl === siteUrl);
  return entry?.permissionLevel || '';
}
function isOwner(siteUrl){ return /owner/i.test(getPermissionFor(siteUrl)); }
function updatePropertyMeta(mode='auto', matchedSite=''){
  const current = matchedSite || $('sites')?.value || '';
  const permission = getPermissionFor(current) || '—';
  const badge = $('propertyPermission');
  if (badge) badge.textContent = `Permission: ${permission}`;

  const url = normalizeUrl($('inspectUrl')?.value || '');
  if (!url){
    setPropertyMatch('Match', 'Enter a URL.');
  } else if (matchedSite){
    setPropertyMatch('Matched', matchedSite);
  } else if (mode === 'auto'){
    setPropertyMatch('No match', 'Pick a property.');
  } else if (mode === 'manual' && current){
    setPropertyMatch('Manual', current);
  } else {
    setPropertyMatch('No match', 'Pick a property.');
  }
}
function autoSelectPropertyForUrl(){
  const sel = $('sites');
  if (!sel) return;
  const url = normalizeUrl($('inspectUrl')?.value || '');
  let matched = '';
  if (url){
    matched = chooseBestProperty(state.sites, url) || '';
    if (matched) setSelectedSite(matched, 'auto');
  }
  if (!matched) {
    syncSitePickerLabel();
    renderSitePicker(state.ui.siteFilter || '');
    updatePropertyMeta('auto', '');
  }
  setEnabled();
}
function setEnabled(){
  const sitesSel = $('sites'); const urlInp = $('inspectUrl');
  if (!sitesSel || !urlInp) return;
  const siteUrl = sitesSel.value || '';
  const url = normalizeUrl(urlInp.value || '');
  const covers = siteUrl && url && propertyCoversUrl(siteUrl, url);
  const owner = isOwner(siteUrl);
  const setDis = (id, on) => { const el = $(id); if (el) el.disabled = on; };
  setDis('inspect', !covers);
  const perfPageOnly = $('perfScope')?.value === 'page';
  setDis('loadPerf', !(siteUrl && (perfPageOnly ? covers : true)));
  setDis('runOnPage', false);
  const indexingAllowed = covers && owner;
  setDis('notifyUpdate', !indexingAllowed);
  setDis('notifyRemove', !indexingAllowed);
  setDis('checkStatus', !indexingAllowed);
}

async function loadSites({ forceRefresh=false } = {}){
  const response = await send({ type:'listSites', forceRefresh: !!forceRefresh });
  if (!response.ok) throw apiErrorFromResponse(response, 'Failed to load properties');
  state.ui.sitesCache = response.cache || null;
  setSites(response.data || []);
  setCacheNote('sitesCacheStatus', state.ui.sitesCache, {
    network: 'Properties refreshed',
    cached: 'Cached properties',
    mixed: 'Mixed property cache',
    stale: 'Stale property cache'
  });
  return response.data || [];
}
const GA_STORAGE_KEYS = {
  selections: 'gaKeyEventSelections',
  mode: 'gaAnalyticsMode',
  breakdown: 'gaKeyEventBreakdown'
};
const GA_OVERVIEW_METRICS = ['sessions', 'keyEvents', 'activeUsers', 'screenPageViews', 'eventCount'];
const GA_KEY_EVENT_METRICS = ['keyEvents', 'eventCount', 'activeUsers', 'sessions'];
const GA_DEFAULT_BREAKDOWN = 'sessionDefaultChannelGroup';
// Friendly names, matching what GA4 itself calls these fields. The picker shows
// these instead of the raw API ids, and the report reuses them in its headings.
const GA_DIM_LABELS = {
  date: "Date",
  // Traffic — session (last touch)
  sessionDefaultChannelGroup: "Session default channel group",
  sessionSource: "Session source",
  sessionMedium: "Session medium",
  sessionSourceMedium: "Session source / medium",
  sessionCampaignName: "Session campaign",
  sessionSourcePlatform: "Session source platform",
  // Pages
  pagePathPlusQueryString: "Page path and query string",
  pagePath: "Page path",
  pageTitle: "Page title",
  landingPagePlusQueryString: "Landing page and query string",
  hostName: "Hostname",
  fullPageUrl: "Full page URL",
  // Events
  eventName: "Event name",
  isKeyEvent: "Is key event",
  linkUrl: "Link URL",
  linkDomain: "Link domain",
  fileExtension: "File extension",
  searchTerm: "Search term",
  // Geography
  country: "Country",
  region: "Region",
  city: "City",
  continent: "Continent",
  language: "Language",
  // Technology
  deviceCategory: "Device category",
  browser: "Browser",
  operatingSystem: "Operating system",
  operatingSystemWithVersion: "Operating system with version",
  platform: "Platform",
  screenResolution: "Screen resolution"
};
const GA_METRIC_LABELS = {
  activeUsers: "Active users",
  // Sessions
  sessions: "Sessions",
  engagedSessions: "Engaged sessions",
  engagementRate: "Engagement rate",
  bounceRate: "Bounce rate",
  sessionsPerUser: "Sessions per user",
  averageSessionDuration: "Average session duration",
  userEngagementDuration: "User engagement duration",
  // Pages
  screenPageViews: "Views",
  screenPageViewsPerSession: "Views per session",
  screenPageViewsPerUser: "Views per user",
  // Events
  eventCount: "Event count",
  eventCountPerUser: "Event count per user",
  eventValue: "Event value",
  eventsPerSession: "Events per session",
  // Key events
  keyEvents: "Key events",
  sessionKeyEventRate: "Session key event rate",
  userKeyEventRate: "User key event rate"
};
// Rates arrive as 0-1 floats and durations as seconds. Rendering either as a
// plain count prints "0.6432" where the answer is "64.3%".
const GA_METRIC_FORMATS = {
  engagementRate: { type: 'percent', digits: 1 },
  bounceRate: { type: 'percent', digits: 1 },
  sessionKeyEventRate: { type: 'percent', digits: 2 },
  userKeyEventRate: { type: 'percent', digits: 2 },
  averageSessionDuration: { type: 'duration' },
  userEngagementDuration: { type: 'duration' },
  sessionsPerUser: { type: 'decimal', digits: 2 },
  screenPageViewsPerSession: { type: 'decimal', digits: 2 },
  screenPageViewsPerUser: { type: 'decimal', digits: 2 },
  eventCountPerUser: { type: 'decimal', digits: 2 },
  eventsPerSession: { type: 'decimal', digits: 2 }
};
function gaFormatMetric(name, value){
  const fmt = GA_METRIC_FORMATS[name];
  return fmt ? formatMetricValue(value, fmt.type, fmt.digits || 0) : formatMetricValue(value);
}
function gaSelectedMetric(){
  const value = $('gaMetric')?.value;
  return GA_METRIC_LABELS[value] ? value : 'sessions';
}
// The overview always needs its own KPI metrics; the chosen one rides along so
// the breakdown can be ranked and displayed by it.
function gaOverviewMetricList(){
  return [...new Set([...GA_OVERVIEW_METRICS, gaSelectedMetric()])];
}
const GA = {
  props: null,
  keyEventsByProperty: {},
  keyEventSelections: {},
  keyEventNotices: {},
  keyEventCacheByProperty: {},
  mode: 'overview',
  breakdown: GA_DEFAULT_BREAKDOWN,
  lastExport: null,
  propFilter: '',
  keyEventFilter: '',
  loadingPropertyId: '',
  propCacheMeta: null,
  reportCacheMeta: null,
  generalNotice: ''
};

async function gaGetStored(){
  return await new Promise(resolve => chrome.storage.local.get([
    GA_STORAGE_KEYS.selections,
    GA_STORAGE_KEYS.mode,
    GA_STORAGE_KEYS.breakdown
  ], resolve));
}
async function gaSetStored(obj){
  return await new Promise(resolve => chrome.storage.local.set(obj, resolve));
}
async function gaHydrateState(){
  const stored = await gaGetStored().catch(() => ({}));
  GA.keyEventSelections = stored?.[GA_STORAGE_KEYS.selections] && typeof stored[GA_STORAGE_KEYS.selections] === 'object'
    ? stored[GA_STORAGE_KEYS.selections]
    : {};
  GA.mode = stored?.[GA_STORAGE_KEYS.mode] === 'keyEvents' ? 'keyEvents' : 'overview';
  GA.breakdown = stored?.[GA_STORAGE_KEYS.breakdown] || GA_DEFAULT_BREAKDOWN;
  const breakdown = $('gaKeyBreakdown');
  if (breakdown) breakdown.value = GA.breakdown;
  gaSyncModeUi();
  gaResetExport();
}
function gaCurrentPropertyId(){
  return $('gaProps')?.value || '';
}
function isoDaysAgo(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0,10);
}
function ensureLaggedEnd(endIso){
  const t = todayISO();
  return endIso > t ? t : endIso;
}
function gaResolveDateRange(){
  let start, end;
  const rng = $('gaRange')?.value || '28';
  if (rng === 'custom'){
    start = $('gaStart')?.value || '';
    end = $('gaEnd')?.value || todayISO();
    if (!start) throw new Error('Pick a start date.');
    if (start > end) throw new Error('Start must be before end.');
  } else {
    const days = Number(rng);
    end = todayISO();
    // GA4 date ranges are inclusive, so "Last N days" starts N-1 days ago.
    start = isoDaysAgo(Math.max(0, days - 1));
  }
  return { start, end: ensureLaggedEnd(end) };
}
function gaPreviousRange(start, end){
  const msPerDay = 86400000;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const spanDays = Math.max(1, Math.round((e - s)/msPerDay) + 1);
  const prevEnd = new Date(s.getTime() - msPerDay);
  const prevStart = new Date(prevEnd.getTime() - (spanDays - 1) * msPerDay);
  return {
    start: prevStart.toISOString().slice(0,10),
    end: prevEnd.toISOString().slice(0,10)
  };
}
function gaHasRows(report){
  return !!(report && Array.isArray(report.rows) && report.rows.length);
}
function gaMetricLabel(name){
  return GA_METRIC_LABELS[name] || name;
}
function gaSyncPropPickerLabel(){
  const label = $('gaPropLabel');
  const sel = $('gaProps');
  if (!label || !sel) return;
  label.textContent = sel.options.length ? (sel.selectedOptions?.[0]?.textContent || 'Select GA4 property') : 'No GA4 properties';
}
function gaRenderPropPicker(filterText=''){
  const list = $('gaPropList');
  const sel = $('gaProps');
  if (!list || !sel) return;
  if (!(GA.props || []).length){
    list.innerHTML = `<div class="picker-empty">No GA4 properties.</div>`;
    return;
  }
  const current = sel.value || '';
  const needle = String(filterText || GA.propFilter || '').trim().toLowerCase();
  const items = (GA.props || []).filter(prop => {
    if (!needle) return true;
    const hay = `${prop.account} ${prop.displayName} ${prop.id}`.toLowerCase();
    return hay.includes(needle);
  });
  if (!items.length){
    list.innerHTML = `<div class="picker-empty">No matches.</div>`;
    return;
  }
  list.innerHTML = items.map(prop => {
    const active = prop.id === current ? ' active' : '';
    return `
      <button class="picker-option ga-prop-option${active}" type="button" data-ga-prop-value="${escapeHtml(prop.id)}">
        <span>${escapeHtml(`${prop.account} • ${prop.displayName}`)}</span>
        <small>p:${escapeHtml(prop.id)}</small>
      </button>
    `;
  }).join('');
  qsa('#gaPropList [data-ga-prop-value]').forEach(btn => {
    btn.addEventListener('click', async ()=>{
      await gaSetSelectedProperty(btn.dataset.gaPropValue || '');
      gaClosePropPicker();
    });
  });
}
function gaOpenPropPicker(){
  $('gaPropMenu')?.classList.remove('hidden');
  $('gaPropToggle')?.setAttribute('aria-expanded', 'true');
  const search = $('gaPropSearch');
  if (search){
    search.value = GA.propFilter || '';
    search.focus();
    search.select();
  }
}
function gaClosePropPicker(){
  $('gaPropMenu')?.classList.add('hidden');
  $('gaPropToggle')?.setAttribute('aria-expanded', 'false');
}
async function gaSetSelectedProperty(propertyId){
  const sel = $('gaProps');
  if (!sel || !propertyId) return;
  sel.value = propertyId;
  if (typeof sessionSelectionRecord === 'function') sessionSelectionRecord('gaProps', propertyId);
  gaSyncPropPickerLabel();
  gaRenderPropPicker(GA.propFilter || '');
  await gaHandlePropertyChange();
}

function gaSetPropertyNotice(propertyId, msg=''){
  if (!propertyId) return;
  if (msg) GA.keyEventNotices[propertyId] = msg;
  else delete GA.keyEventNotices[propertyId];
}
function gaSetGeneralNotice(msg=''){
  GA.generalNotice = msg || '';
}
function gaGetPropertyNotice(propertyId=gaCurrentPropertyId()){
  return propertyId ? (GA.keyEventNotices[propertyId] || '') : (GA.generalNotice || '');
}
function gaGetCurrentKeyEvents(propertyId=gaCurrentPropertyId()){
  return GA.keyEventsByProperty[propertyId] || [];
}
function gaGetSelectedKeyEvents(propertyId=gaCurrentPropertyId()){
  const raw = Array.isArray(GA.keyEventSelections[propertyId]) ? GA.keyEventSelections[propertyId] : [];
  const available = new Set(gaGetCurrentKeyEvents(propertyId).map(item => item.eventName));
  return raw.filter(name => available.has(name));
}
function gaCurrentSelectionLabel(propertyId=gaCurrentPropertyId()){
  if (!propertyId) return 'Pick a GA4 property';
  if (GA.loadingPropertyId === propertyId) return 'Loading…';
  const selected = gaGetSelectedKeyEvents(propertyId);
  if (!selected.length){
    return gaGetCurrentKeyEvents(propertyId).length ? 'Select events' : 'No events';
  }
  if (selected.length === 1) return selected[0];
  return `${selected.length} events selected`;
}
function gaRenderKeyEventNotice(){
  const el = $('gaKeyEventNotice');
  if (!el) return;
  const msg = gaGetPropertyNotice();
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}
function gaRenderPropertyCacheNote(){
  setCacheNote('gaPropCacheStatus', GA.propCacheMeta, {
    network: 'Properties refreshed',
    cached: 'Cached properties',
    mixed: 'Mixed property cache',
    stale: 'Stale property cache'
  });
}
function gaRenderKeyEventCacheNote(){
  setCacheNote('gaKeyEventCacheStatus', GA.keyEventCacheByProperty[gaCurrentPropertyId()] || null, {
    network: 'Events refreshed',
    cached: 'Cached events',
    mixed: 'Mixed event cache',
    stale: 'Stale event cache'
  });
}
function gaRenderReportCacheNote(){
  setCacheNote('gaReportCacheStatus', GA.reportCacheMeta, {
    network: 'Report refreshed',
    cached: 'Cached report',
    mixed: 'Mixed report cache',
    stale: 'Stale report cache'
  });
}
function gaRenderKeyEventLabel(){
  const label = $('gaKeyEventLabel');
  if (label) label.textContent = gaCurrentSelectionLabel();
}
function gaRenderKeyEventPicker(){
  const list = $('gaKeyEventList');
  const actions = $('gaKeyEventActions');
  if (!list) return;
  const propertyId = gaCurrentPropertyId();
  const available = gaGetCurrentKeyEvents(propertyId);
  const selected = new Set(gaGetSelectedKeyEvents(propertyId));
  const needle = String(GA.keyEventFilter || '').trim().toLowerCase();
  const hideActions = () => {
    if (!actions) return;
    actions.innerHTML = '';
    actions.classList.add('hidden');
  };

  if (!propertyId){
    hideActions();
    list.innerHTML = `<div class="picker-empty">Pick a GA4 property.</div>`;
    return;
  }
  if (GA.loadingPropertyId === propertyId){
    hideActions();
    list.innerHTML = `<div class="picker-empty">Loading events…</div>`;
    return;
  }
  if (!available.length){
    hideActions();
    list.innerHTML = `<div class="picker-empty">No key events.</div>`;
    return;
  }

  const items = available.filter(item => item.eventName.toLowerCase().includes(needle));
  if (!items.length){
    hideActions();
    list.innerHTML = `<div class="picker-empty">No matches.</div>`;
    return;
  }

  const visibleNames = items.map(item => item.eventName);
  const selectedVisibleCount = visibleNames.filter(name => selected.has(name)).length;
  const allVisibleSelected = visibleNames.length > 0 && selectedVisibleCount === visibleNames.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  if (actions){
    actions.classList.remove('hidden');
    actions.innerHTML = `
      <label class="ga-picker-bulk">
        <input type="checkbox" data-ga-select-all${allVisibleSelected ? ' checked' : ''}>
        <span>Select all</span>
      </label>
      <button type="button" class="ga-picker-clear" data-ga-clear-events${selected.size ? '' : ' disabled'}>Clear</button>
    `;
  }

  list.innerHTML = items.map(item => {
    const active = selected.has(item.eventName) ? ' active' : '';
    return `
      <label class="picker-option ga-picker-option${active}">
        <input type="checkbox" data-ga-event="${escapeHtml(item.eventName)}"${selected.has(item.eventName) ? ' checked' : ''}>
        <span class="ga-picker-name">${escapeHtml(item.eventName)}</span>
      </label>
    `;
  }).join('');

  const selectAll = actions?.querySelector('[data-ga-select-all]');
  if (selectAll){
    selectAll.indeterminate = someVisibleSelected;
    selectAll.addEventListener('change', async ()=>{
      const current = new Set(gaGetSelectedKeyEvents());
      if (selectAll.checked) visibleNames.forEach(name => current.add(name));
      else visibleNames.forEach(name => current.delete(name));
      await gaSetSelectedKeyEvents(Array.from(current));
    });
  }

  actions?.querySelector('[data-ga-clear-events]')?.addEventListener('click', async ()=>{
    await gaSetSelectedKeyEvents([]);
  });

  qsa('#gaKeyEventList input[data-ga-event]').forEach(input => {
    input.addEventListener('change', async ()=>{
      const name = input.dataset.gaEvent || '';
      if (!name) return;
      const current = new Set(gaGetSelectedKeyEvents());
      if (current.has(name)) current.delete(name);
      else current.add(name);
      await gaSetSelectedKeyEvents(Array.from(current));
    });
  });
}
function gaResetExport(){
  GA.lastExport = null;
  GA.reportCacheMeta = null;
  const btn = $('gaExport');
  if (btn) btn.disabled = true;
  gaRenderReportCacheNote();
}
function gaSetExport(filename, csv){
  GA.lastExport = filename && csv ? { filename, csv } : null;
  const btn = $('gaExport');
  if (btn) btn.disabled = !GA.lastExport;
}
function gaSyncGaActions(){
  const load = $('gaLoad');
  const prop = gaCurrentPropertyId();
  if (load){
    const hasKeySelection = gaGetSelectedKeyEvents().length > 0;
    const hasKeyEvents = gaGetCurrentKeyEvents().length > 0;
    load.disabled = !prop || (GA.mode === 'keyEvents' && (!hasKeySelection || !hasKeyEvents || GA.loadingPropertyId === prop));
    // Every panel's primary action is called Run. This one re-labels itself on
    // each sync, so the name has to be set here rather than in the markup.
    load.textContent = GA.mode === 'keyEvents' ? 'Run events' : 'Run';
  }
  const refresh = $('gaRefreshData');
  if (refresh) refresh.disabled = !prop;
  const exportBtn = $('gaExport');
  if (exportBtn) exportBtn.disabled = !GA.lastExport;
}
function gaRenderKeyEventState(){
  gaRenderKeyEventLabel();
  gaRenderKeyEventPicker();
  gaRenderKeyEventNotice();
  gaRenderPropertyCacheNote();
  gaRenderKeyEventCacheNote();
  gaSyncGaActions();
}
function gaOpenKeyEventPicker(){
  if (!gaCurrentPropertyId()) return;
  $('gaKeyEventMenu')?.classList.remove('hidden');
  $('gaKeyEventToggle')?.setAttribute('aria-expanded', 'true');
  positionOpenOverlays();
  const search = $('gaKeyEventSearch');
  if (search){
    search.value = GA.keyEventFilter || '';
    search.focus();
    search.select();
  }
}
function gaCloseKeyEventPicker(){
  const menu = $('gaKeyEventMenu');
  menu?.classList.add('hidden');
  resetViewportOverlay(menu);
  $('gaKeyEventToggle')?.setAttribute('aria-expanded', 'false');
}
function gaSyncModeUi(){
  const isKeyEvents = GA.mode === 'keyEvents';
  qsa('.ga-mode-overview').forEach(el => el.classList.toggle('hidden', isKeyEvents));
  qsa('.ga-mode-keyevents').forEach(el => el.classList.toggle('hidden', !isKeyEvents));
  $('gaModeOverview')?.classList.toggle('active', !isKeyEvents);
  $('gaModeKeyEvents')?.classList.toggle('active', isKeyEvents);
  $('gaModeOverview')?.setAttribute('aria-pressed', String(!isKeyEvents));
  $('gaModeKeyEvents')?.setAttribute('aria-pressed', String(isKeyEvents));
  const breakdown = $('gaKeyBreakdown');
  if (breakdown) breakdown.value = GA.breakdown;
  if (!isKeyEvents) gaCloseKeyEventPicker();
  gaRenderKeyEventState();
}
function gaSetMode(mode){
  GA.mode = mode === 'keyEvents' ? 'keyEvents' : 'overview';
  void gaSetStored({ [GA_STORAGE_KEYS.mode]: GA.mode });
  gaSyncModeUi();
  if (GA.mode === 'keyEvents'){
    const propertyId = gaCurrentPropertyId();
    if (propertyId && !GA.keyEventsByProperty[propertyId]){
      gaLoadKeyEvents(propertyId).catch(e => renderApiError('gaResult', e, 'gaRefreshData'));
    }
  }
}
async function gaSetSelectedKeyEvents(names){
  const propertyId = gaCurrentPropertyId();
  if (!propertyId) return [];
  const order = new Map(gaGetCurrentKeyEvents(propertyId).map((item, index) => [item.eventName, index]));
  const next = Array.from(new Set((names || []).filter(name => order.has(name))))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  GA.keyEventSelections[propertyId] = next;
  await gaSetStored({ [GA_STORAGE_KEYS.selections]: GA.keyEventSelections });
  gaRenderKeyEventState();
  return next;
}
async function gaLoadKeyEvents(propertyId, { force=false } = {}){
  if (!propertyId){
    gaRenderKeyEventState();
    return [];
  }
  if (!force && GA.keyEventsByProperty[propertyId]){
    gaRenderKeyEventCacheNote();
    gaRenderKeyEventState();
    return GA.keyEventsByProperty[propertyId];
  }

  GA.loadingPropertyId = propertyId;
  gaRenderKeyEventState();
  try{
    const r = await send({ type:'gaListKeyEvents', propertyId, forceRefresh: !!force });
    if (!r.ok) throw apiErrorFromResponse(r, 'Failed to load key events');

    const items = (r.data || [])
      .map(item => ({
        eventName: item.eventName || '',
        custom: !!item.custom,
        countingMethod: item.countingMethod || '',
        createTime: item.createTime || ''
      }))
      .filter(item => item.eventName)
      .sort((a, b) => a.eventName.localeCompare(b.eventName));

    GA.keyEventsByProperty[propertyId] = items;
    GA.keyEventCacheByProperty[propertyId] = r.cache || null;
    const raw = Array.isArray(GA.keyEventSelections[propertyId]) ? GA.keyEventSelections[propertyId] : [];
    const available = new Set(items.map(item => item.eventName));
    const next = raw.filter(name => available.has(name));
    const removed = raw.length - next.length;
    GA.keyEventSelections[propertyId] = next;

    if (removed > 0){
      await gaSetStored({ [GA_STORAGE_KEYS.selections]: GA.keyEventSelections });
      gaSetPropertyNotice(propertyId, `Removed ${removed} unavailable saved event${removed === 1 ? '' : 's'}.`);
    } else if (!items.length){
      gaSetPropertyNotice(propertyId, 'No key events found.');
    } else {
      gaSetPropertyNotice(propertyId, '');
      gaSetGeneralNotice('');
    }

    return items;
  } catch (e){
    delete GA.keyEventsByProperty[propertyId];
    delete GA.keyEventCacheByProperty[propertyId];
    gaSetPropertyNotice(propertyId, `Load failed: ${e?.message || e}`);
    throw e;
  } finally {
    if (GA.loadingPropertyId === propertyId) GA.loadingPropertyId = '';
    gaRenderKeyEventState();
  }
}
async function gaHandlePropertyChange({ forceReload=false } = {}){
  const propertyId = gaCurrentPropertyId();
  GA.keyEventFilter = '';
  gaSyncPropPickerLabel();
  gaRenderPropPicker(GA.propFilter || '');
  gaCloseKeyEventPicker();
  gaResetExport();
  if (!propertyId){
    gaRenderKeyEventState();
    return;
  }
  gaSetGeneralNotice('');
  try{
    await gaLoadKeyEvents(propertyId, { force: forceReload });
  } catch (e){
    if (GA.mode === 'keyEvents') renderApiError('gaResult', e, 'gaRefreshData');
  }
}
async function loadGaPropsOnce({ forceRefresh=false } = {}){
  const sel = $('gaProps');
  if (!sel) return;
  if (GA.props && sel.options.length && !forceRefresh){
    gaSyncPropPickerLabel();
    gaRenderPropPicker(GA.propFilter || '');
    gaRenderPropertyCacheNote();
    return;
  }

  const currentValue = sel.value || '';
  const r = await send({ type:"gaListProperties", forceRefresh: !!forceRefresh });
  if (!r.ok) throw apiErrorFromResponse(r, "Failed to list GA properties");
  GA.propCacheMeta = r.cache || null;
  GA.props = r.data || [];
  sel.innerHTML = "";

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = GA.props.length ? 'Select GA4 property' : 'No GA4 properties';
  sel.appendChild(placeholder);

  GA.props.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.account} • ${p.displayName} (p:${p.id})`;
    sel.appendChild(opt);
  });

  const hasCurrent = !!currentValue && Array.from(sel.options).some(opt => opt.value === currentValue);
  sel.value = hasCurrent ? currentValue : '';
  if (currentValue && !hasCurrent){
    gaSetGeneralNotice('Saved GA4 property is unavailable.');
  } else if (!sel.value && !GA.props.length){
    gaSetGeneralNotice('No GA4 properties found.');
  } else if (sel.value){
    gaSetGeneralNotice('');
  }
  gaSyncPropPickerLabel();
  gaRenderPropPicker();
  gaRenderPropertyCacheNote();
  await gaHandlePropertyChange({ forceReload: !!sel.value && !!forceRefresh });
}
async function gaFetchReport(payload){
  const r = await send(Object.assign({ type:'gaReport' }, payload));
  if (!r.ok) throw apiErrorFromResponse(r, 'GA4 error');
  return { data: r.data, cache: r.cache || null };
}
async function gaFetchKeyEventBundle({ propertyId, startDate, endDate, eventNames, breakdown, forceRefresh=false }){
  const base = {
    propertyId,
    startDate,
    endDate,
    metrics: GA_KEY_EVENT_METRICS,
    inListFilter: {
      fieldName: 'eventName',
      values: eventNames
    }
  };
  const [eventTotals, trend, breakdownData] = await Promise.all([
    gaFetchReport(Object.assign({}, base, {
      dimensions: ['eventName'],
      rowLimit: Math.max(eventNames.length, 25),
      orderByMetric: 'keyEvents',
      forceRefresh
    })),
    gaFetchReport(Object.assign({}, base, { dimensions: ['date'], forceRefresh })),
    gaFetchReport(Object.assign({}, base, {
      dimensions: [breakdown],
      rowLimit: 50,
      orderByMetric: 'keyEvents',
      forceRefresh
    }))
  ]);
  return {
    eventTotals: eventTotals.data,
    trend: trend.data,
    breakdown: breakdownData.data,
    cache: combineCacheMeta([eventTotals.cache, trend.cache, breakdownData.cache])
  };
}

async function gaLoadActiveReport({ forceRefresh=false } = {}){
  const prop = gaCurrentPropertyId();
  if (!prop) return clearResult("Pick a GA4 property.", 'gaResult');

  let range;
  try{
    range = gaResolveDateRange();
  }catch(e){
    return clearResult(e?.message || String(e), 'gaResult');
  }

  gaResetExport();
  if (GA.mode === 'keyEvents'){
    const eventNames = gaGetSelectedKeyEvents(prop);
    if (!eventNames.length) return clearResult('Pick at least one event.', 'gaResult');

    clearResult(forceRefresh ? 'Refreshing…' : 'Loading…', 'gaResult');
    try{
      const breakdown = $('gaKeyBreakdown')?.value || GA.breakdown;
      GA.breakdown = breakdown;
      void gaSetStored({ [GA_STORAGE_KEYS.breakdown]: GA.breakdown });
      const currData = await gaFetchKeyEventBundle({
        propertyId: prop,
        startDate: range.start,
        endDate: range.end,
        eventNames,
        breakdown,
        forceRefresh
      });

      let prevData = null;
      const cacheBits = [currData.cache];
      if ($('gaCompare')?.checked){
        const prevRange = gaPreviousRange(range.start, range.end);
        prevData = await gaFetchKeyEventBundle({
          propertyId: prop,
          startDate: prevRange.start,
          endDate: prevRange.end,
          eventNames,
          breakdown,
          forceRefresh
        });
        cacheBits.push(prevData.cache);
      }

      GA.reportCacheMeta = combineCacheMeta(cacheBits);
      renderGaKeyEventsReport(currData, {
        start: range.start,
        end: range.end,
        breakdown,
        prop,
        eventNames
      }, prevData);
      gaRenderReportCacheNote();
    }catch(e){
      renderApiError('gaResult', e, 'gaRefreshData');
    }
    return;
  }

  const dim = $('gaDim')?.value || 'date';
  clearResult(forceRefresh ? 'Refreshing…' : 'Loading…', 'gaResult');
  try{
    const overviewBase = {
      propertyId: prop,
      metrics: gaOverviewMetricList(),
      forceRefresh
    };
    const wantsCompare = !!$('gaCompare')?.checked;
    const prevRange = gaPreviousRange(range.start, range.end);
    const dimIsDate = dim === 'date';
    const focusMetric = gaSelectedMetric();

    const requests = [
      gaFetchReport(Object.assign({}, overviewBase, {
        startDate: range.start,
        endDate: range.end,
        dimensions: ['date'],
        rowLimit: 1000
      }))
    ];
    requests.push(dimIsDate ? null : gaFetchReport(Object.assign({}, overviewBase, {
      startDate: range.start,
      endDate: range.end,
      dimensions: [dim],
      rowLimit: 200,
      orderByMetric: focusMetric
    })));
    requests.push(wantsCompare ? gaFetchReport(Object.assign({}, overviewBase, {
      startDate: prevRange.start,
      endDate: prevRange.end,
      dimensions: ['date'],
      rowLimit: 1000
    })) : null);
    requests.push((wantsCompare && !dimIsDate) ? gaFetchReport(Object.assign({}, overviewBase, {
      startDate: prevRange.start,
      endDate: prevRange.end,
      dimensions: [dim],
      rowLimit: 200,
      orderByMetric: focusMetric
    })) : null);
    // The channel-group card is always shown, so it needs its own request
    // whenever the chosen dimension is something else.
    const channelDim = 'sessionDefaultChannelGroup';
    const dimIsChannel = dim === channelDim;
    requests.push(dimIsChannel ? null : gaFetchReport(Object.assign({}, overviewBase, {
      startDate: range.start, endDate: range.end,
      dimensions: [channelDim], rowLimit: 50, orderByMetric: 'sessions'
    })));
    requests.push((wantsCompare && !dimIsChannel) ? gaFetchReport(Object.assign({}, overviewBase, {
      startDate: prevRange.start, endDate: prevRange.end,
      dimensions: [channelDim], rowLimit: 50, orderByMetric: 'sessions'
    })) : null);

    const settled = await Promise.all(requests.map(request => request || Promise.resolve(null)));
    const [trendResult, breakdownResult, prevTrendResult, prevBreakdownResult, channelResult, prevChannelResult] = settled;

    const currBundle = {
      trend: trendResult?.data || null,
      breakdown: (dimIsDate ? trendResult?.data : breakdownResult?.data) || null,
      channels: (dimIsChannel ? breakdownResult?.data : channelResult?.data) || null
    };
    const prevBundle = wantsCompare ? {
      trend: prevTrendResult?.data || null,
      breakdown: (dimIsDate ? prevTrendResult?.data : prevBreakdownResult?.data) || null,
      channels: (dimIsChannel ? prevBreakdownResult?.data : prevChannelResult?.data) || null
    } : null;

    GA.reportCacheMeta = combineCacheMeta(settled.filter(Boolean).map(item => item.cache));
    renderGaReport(currBundle, { start: range.start, end: range.end, dim, prop, metric: focusMetric }, prevBundle);
    gaRenderReportCacheNote();
  }catch(e){
    renderApiError('gaResult', e, 'gaRefreshData');
  }
}

on('gaModeOverview', 'click', ()=> gaSetMode('overview'));
on('gaModeKeyEvents', 'click', ()=> gaSetMode('keyEvents'));
on('gaProps', 'change', ()=>{ gaHandlePropertyChange().catch(e => renderApiError('gaResult', e, 'gaRefreshData')); });
on('gaPropToggle', 'click', (e)=>{
  e.preventDefault();
  $('gaPropMenu')?.classList.contains('hidden') ? gaOpenPropPicker() : gaClosePropPicker();
});
on('gaPropSearch', 'input', (e)=>{
  GA.propFilter = e.target?.value || '';
  gaRenderPropPicker(GA.propFilter);
});
on('gaPropSearch', 'keydown', (e)=>{
  if (e.key === 'Escape') gaClosePropPicker();
});
on('gaKeyBreakdown', 'change', ()=>{
  GA.breakdown = $('gaKeyBreakdown')?.value || GA_DEFAULT_BREAKDOWN;
  void gaSetStored({ [GA_STORAGE_KEYS.breakdown]: GA.breakdown });
});
on('gaKeyEventToggle', 'click', (e)=>{
  e.preventDefault();
  $('gaKeyEventMenu')?.classList.contains('hidden') ? gaOpenKeyEventPicker() : gaCloseKeyEventPicker();
});
on('gaKeyEventSearch', 'input', (e)=>{
  GA.keyEventFilter = e.target?.value || '';
  gaRenderKeyEventPicker();
});
on('gaKeyEventSearch', 'keydown', (e)=>{
  if (e.key === 'Escape') gaCloseKeyEventPicker();
});
document.addEventListener('click', (e)=>{
  const gaPropShell = e.target?.closest?.('.ga-prop-shell');
  if (!gaPropShell) gaClosePropPicker();
  const shell = e.target?.closest?.('.ga-picker-shell');
  if (!shell) gaCloseKeyEventPicker();
});
on('navAnalytics','click', async ()=>{
  try{
    await loadGaPropsOnce();
    const r = await send({ type: "gaDetectFromTab" });
    if (r.ok && r.data && r.data.propertyId){
      const sel = $('gaProps');
      if (sel && Array.from(sel.options).some(o => o.value === r.data.propertyId)){
        await gaSetSelectedProperty(r.data.propertyId);
        clearResult(`Matched property: ${r.data.propertyName} (${r.data.measurementId || '—'})`, 'gaResult');
      }
    } else if (r.ok && r.data?.foundGIds?.length){
      clearResult(`Found IDs: ${r.data.foundGIds.join(', ')}. No matching property.`, 'gaResult');
    } else {
      await gaHandlePropertyChange();
    }
  }catch(e){
    // non-fatal; keep UI usable
  }
});
$('gaRange').addEventListener('change', ()=>{
  const custom = $('gaRange').value === 'custom';
  setDateRangeMode('gaRange', 'gaStart', custom, { open:custom });
});
$('gaLoad').addEventListener('click', ()=>{ gaLoadActiveReport({ forceRefresh:false }); });
on('gaRefreshProps', 'click', async ()=>{
  const btn = $('gaRefreshProps');
  if (btn?.disabled) return;
  if (btn){
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  try{
    await loadGaPropsOnce({ forceRefresh:true });
  }catch(e){
    renderApiError('gaResult', e, 'gaRefreshData');
  }finally{
    if (btn){
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }
});
on('settingsRefreshGa', 'click', async ()=>{
  try{
    await loadGaPropsOnce({ forceRefresh:true });
  }catch(e){
    renderApiError('gaResult', e, 'gaRefreshData');
  }
});
on('gaRefreshData', 'click', ()=>{ gaLoadActiveReport({ forceRefresh:true }); });
$('gaExport').addEventListener('click', ()=>{
  if (!GA.lastExport) return clearResult('Load data first.', 'gaResult');
  const blob = new Blob([GA.lastExport.csv], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = GA.lastExport.filename;
  a.click();
  URL.revokeObjectURL(url);
});

// Renderers
function gaRowKey(row){
  return (row?.dimensionValues || []).map(value => value.value || '').join(' · ');
}
function gaMetricAccessor(report, metricName){
  const index = Object.fromEntries((report?.metricHeaders || []).map((header, i) => [header.name, i]))[metricName];
  if (index == null) return () => 0;
  return row => Number(row?.metricValues?.[index]?.value || 0);
}
function gaReportRows(report, metricNames){
  if (!gaHasRows(report)) return [];
  const index = Object.fromEntries((report.metricHeaders || []).map((header, i) => [header.name, i]));
  return report.rows.map(row => {
    const entry = { key: gaRowKey(row) };
    metricNames.forEach(name => {
      entry[name] = Number(row.metricValues?.[index[name]]?.value || 0);
    });
    return entry;
  });
}
function gaConversionRate(sums){
  const sessions = Number(sums?.sessions || 0);
  if (!sessions) return 0;
  return Number(sums?.keyEvents || 0) / sessions;
}
function gaOverviewVerdict(sums, prevSums, movers){
  if (!prevSums || !Number(prevSums.sessions)){
    return { text:'No comparable previous period — enable Compare to see what changed.', tone:'neutral' };
  }
  const cvr = gaConversionRate(sums);
  const prevCvr = gaConversionRate(prevSums);
  const cvrPoints = (cvr - prevCvr) * 100;
  const sessionPct = ((Number(sums.sessions || 0) - Number(prevSums.sessions || 0)) / Number(prevSums.sessions || 1)) * 100;
  if (Math.abs(cvrPoints) >= 0.2){
    const direction = cvrPoints > 0 ? 'up' : 'down';
    const sessionNote = Math.abs(sessionPct) < 5
      ? 'on flat sessions'
      : `with sessions ${sessionPct > 0 ? 'up' : 'down'} ${Math.abs(sessionPct).toFixed(0)}%`;
    return {
      text: `Conversion rate ${direction} ${Math.abs(cvrPoints).toFixed(1)}pt ${sessionNote}.`,
      tone: cvrPoints > 0 ? 'good' : 'bad'
    };
  }
  if (Math.abs(sessionPct) < 5){
    return { text:`Sessions and conversion rate both held steady.`, tone:'neutral' };
  }
  const top = movers && movers.length ? ` — ${movers[0].label} moved ${movers[0].delta}` : '';
  return {
    text: `Sessions ${sessionPct > 0 ? 'rose' : 'fell'} ${Math.abs(sessionPct).toFixed(0)}% with conversion rate unchanged${top}.`,
    tone: sessionPct > 0 ? 'good' : 'bad'
  };
}
function renderGaReport(currBundle, meta, prevBundle){
  const trendReport = currBundle?.trend;
  const breakdownReport = currBundle?.breakdown;
  const summarySource = gaHasRows(trendReport) ? trendReport : breakdownReport;

  if (!gaHasRows(summarySource)){
    gaResetExport();
    renderHtml('gaResult', buildInsightStage({
      eyebrow: 'GA4',
      title: 'Overview',
      rangeLabel: `${meta.start} → ${meta.end}`,
      verdict: { text:`No data for ${meta.start} → ${meta.end}. The property may have no traffic in this range, or the range may be too recent.`, tone:'neutral' }
    }));
    return;
  }

  const dimLabel = GA_DIM_LABELS[meta.dim] || meta.dim;
  const focusMetric = GA_METRIC_LABELS[meta.metric] ? meta.metric : 'sessions';
  const metricLabel = GA_METRIC_LABELS[focusMetric];
  const sums = gaSummarizeReport(summarySource);
  const prevSummarySource = gaHasRows(prevBundle?.trend) ? prevBundle.trend : prevBundle?.breakdown;
  const prevSums = gaHasRows(prevSummarySource) ? gaSummarizeReport(prevSummarySource) : null;

  const sessionSeries = gaMetricSeries(trendReport, 'sessions');
  const prevSessionSeries = gaHasRows(prevBundle?.trend) ? gaMetricSeries(prevBundle.trend, 'sessions') : [];

  const breakdownRows = gaHasRows(breakdownReport) ? breakdownReport.rows : [];
  const prevBreakdownRows = gaHasRows(prevBundle?.breakdown) ? prevBundle.breakdown.rows : [];
  const currSessions = gaMetricAccessor(breakdownReport, 'sessions');
  const currKeyEvents = gaMetricAccessor(breakdownReport, 'keyEvents');

  // Channel group is always shown, whatever dimension the user picked, because
  // it is the split a client asks about first.
  const channelRowsRaw = gaReportRows(currBundle?.channels, ['sessions', 'keyEvents']);
  const prevChannelMap = new Map(
    gaReportRows(prevBundle?.channels, ['sessions', 'keyEvents']).map(row => [row.key, row.sessions])
  );
  const channelSection = channelRowsRaw.length ? {
    type: 'compare',
    title: 'Sessions by default channel group',
    items: channelRowsRaw.slice(0, 10).map(row => {
      const prev = prevChannelMap.get(row.key) || 0;
      return {
        label: row.key || '—',
        value: row.sessions,
        prevValue: prev,
        displayValue: formatMetricValue(row.sessions),
        delta: prev ? metricDelta(row.sessions, prev, { digits:0 }) : { text:'', cls:'' }
      };
    })
  } : null;

  const movers = (meta.dim === 'date' || !prevBreakdownRows.length) ? [] : computeMovers(breakdownRows, prevBreakdownRows, {
    keyFn: gaRowKey,
    valueFn: currSessions,
    limit: 5,
    suffix: 'sessions',
    metaFn: item => {
      if (!item.row) return '';
      const sessions = currSessions(item.row);
      if (!sessions) return '';
      return `cvr ${((currKeyEvents(item.row) / sessions) * 100).toFixed(1)}%`;
    }
  });

  renderHtml('gaResult', buildInsightStage({
    eyebrow: 'GA4',
    title: 'Overview',
    rangeLabel: `${meta.start} → ${meta.end}`,
    subtitle: `Breakdown by ${dimLabel}.`,
    badges: [`Dimension: ${dimLabel}`, `Metric: ${metricLabel}`],
    kpis: [
      {
        label: 'Sessions',
        value: formatMetricValue(sums.sessions),
        delta: metricDelta(sums.sessions, prevSums?.sessions)
      },
      {
        label: 'Key events',
        value: formatMetricValue(sums.keyEvents),
        delta: metricDelta(sums.keyEvents, prevSums?.keyEvents)
      },
      {
        label: 'Conversion rate',
        value: formatMetricValue(gaConversionRate(sums), 'percent', 2),
        delta: prevSums ? formatPointDelta(gaConversionRate(sums), gaConversionRate(prevSums), { digits:2 }) : { text:'—', cls:'' }
      }
    ],
    verdict: gaOverviewVerdict(sums, prevSums, movers),
    trend: sessionSeries.length > 1 ? {
      values: sessionSeries,
      compareValues: prevSessionSeries.length > 1 ? prevSessionSeries : null,
      isTimeSeries: true,
      label: 'Sessions per day'
    } : null,
    sections: [
      // Requested order: cards -> trend -> channel-group breakdown -> movers.
      channelSection,
      movers.length ? {
        type: 'movers',
        title: `Biggest movers · ${dimLabel.toLowerCase()}`,
        rows: movers
      } : null,
      breakdownRows.length ? {
        type: 'details',
        label: `All ${formatMetricValue(breakdownRows.length)} rows by ${dimLabel.toLowerCase()}`,
        hint: `Sorted by ${metricLabel.toLowerCase()}`,
        table: gaReportTableSection('', breakdownReport)
      } : null
    ]
  }));

  gaSetExport(`ga4-${meta.dim}-${meta.start}-${meta.end}.csv`, gaToCSV(breakdownReport || trendReport));
}
function gaKeyEventsVerdict(items, sums, prevSums){
  const withPrev = items.filter(item => Number(item.prevValue) > 0);
  if (!withPrev.length){
    return { text:'No comparable previous period — enable Compare to see which events moved.', tone:'neutral' };
  }
  const scored = withPrev
    .map(item => ({
      label: item.label,
      pct: ((Number(item.value) - Number(item.prevValue)) / Number(item.prevValue)) * 100
    }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const worst = scored.filter(item => item.pct < 0).sort((a, b) => a.pct - b.pct)[0];
  const best = scored.filter(item => item.pct > 0).sort((a, b) => b.pct - a.pct)[0];

  if (worst && worst.pct <= -35){
    const growth = best && best.pct >= 10 ? `${best.label} grew ${best.pct.toFixed(0)}%, but ` : '';
    return {
      text: `${growth}${worst.label} fell ${Math.abs(worst.pct).toFixed(0)}% — worth checking for a tracking break.`,
      tone: 'warn'
    };
  }
  const total = Number(sums?.keyEvents || 0);
  const prevTotal = Number(prevSums?.keyEvents || 0);
  if (!prevTotal) return { text:`${formatMetricValue(total)} key events recorded.`, tone:'neutral' };
  const pct = ((total - prevTotal) / prevTotal) * 100;
  if (Math.abs(pct) < 5){
    return { text:'Key events held steady across every selected event.', tone:'neutral' };
  }
  const driver = pct > 0 ? best : worst;
  const detail = driver ? ` — led by ${driver.label} at ${driver.pct > 0 ? '+' : ''}${driver.pct.toFixed(0)}%` : '';
  return {
    text: `Key events ${pct > 0 ? 'rose' : 'fell'} ${Math.abs(pct).toFixed(0)}%${detail}.`,
    tone: pct > 0 ? 'good' : 'bad'
  };
}
function renderGaKeyEventsReport(currBundle, meta, prevBundle){
  const summarySource = gaPickSummaryReport(currBundle);
  if (!summarySource){
    gaResetExport();
    renderHtml('gaResult', buildInsightStage({
      eyebrow: 'GA4',
      title: 'Key events',
      rangeLabel: `${meta.start} → ${meta.end}`,
      verdict: { text:`No data for ${meta.start} → ${meta.end}. These events may not have fired in this range.`, tone:'neutral' }
    }));
    return;
  }

  const prevSummarySource = gaPickSummaryReport(prevBundle);
  const sums = gaSummarizeReport(summarySource);
  const prevSums = prevSummarySource ? gaSummarizeReport(prevSummarySource) : null;
  const series = gaMetricSeries(currBundle.trend, 'keyEvents');
  const prevSeries = gaHasRows(prevBundle?.trend) ? gaMetricSeries(prevBundle.trend, 'keyEvents') : [];
  const selectionLabel = meta.eventNames.length === 1 ? meta.eventNames[0] : `${meta.eventNames.length} events selected`;
  const breakdownLabel = GA_DIM_LABELS[meta.breakdown] || meta.breakdown;

  const currEvents = gaMetricAccessor(currBundle.eventTotals, 'keyEvents');
  const prevEventsAccessor = gaMetricAccessor(prevBundle?.eventTotals, 'keyEvents');
  const prevByEvent = new Map();
  if (gaHasRows(prevBundle?.eventTotals)){
    prevBundle.eventTotals.rows.forEach(row => {
      prevByEvent.set(gaRowKey(row), prevEventsAccessor(row));
    });
  }
  const compareItems = gaHasRows(currBundle.eventTotals)
    ? currBundle.eventTotals.rows.map(row => {
        const label = gaRowKey(row) || '—';
        const value = currEvents(row);
        const prevValue = prevByEvent.get(label) || 0;
        return {
          label,
          value,
          prevValue,
          displayValue: formatMetricValue(value),
          delta: prevValue ? metricDelta(value, prevValue, { digits:0 }) : { text:'', cls:'' }
        };
      })
    : [];

  const channelAgg = new Map();
  (meta.breakdown === 'sessionDefaultChannelGroup'
    ? gaReportRows(currBundle.breakdown, ['keyEvents', 'eventCount'])
    : []
  ).forEach(row => {
    const key = row.key || '';
    if (!key) return;
    channelAgg.set(key, { key, keyEvents: row.keyEvents });
  });
  const keyChannelRows = Array.from(channelAgg.values()).sort((a,b) => b.keyEvents - a.keyEvents);
  const keyChannelSection = keyChannelRows.length ? {
    type: 'compare',
    title: 'Key events by default channel group',
    items: keyChannelRows.map(row => ({
      label: row.key,
      value: row.keyEvents,
      prevValue: 0,
      displayValue: formatMetricValue(row.keyEvents),
      delta: { text:'', cls:'' }
    }))
  } : null;

  const sessions = Number(sums.sessions || 0);
  const prevSessions = Number(prevSums?.sessions || 0);

  renderHtml('gaResult', buildInsightStage({
    eyebrow: 'GA4',
    title: 'Key events',
    rangeLabel: `${meta.start} → ${meta.end}`,
    subtitle: selectionLabel,
    badges: [`Breakdown: ${breakdownLabel}`],
    kpis: [
      {
        label: 'Key events',
        value: formatMetricValue(sums.keyEvents),
        delta: metricDelta(sums.keyEvents, prevSums?.keyEvents)
      },
      {
        label: 'Conversion rate',
        value: formatMetricValue(sessions ? (Number(sums.keyEvents || 0) / sessions) : 0, 'percent', 2),
        delta: (sessions && prevSessions)
          ? formatPointDelta(Number(sums.keyEvents || 0) / sessions, Number(prevSums.keyEvents || 0) / prevSessions, { digits:2 })
          : { text:'—', cls:'' }
      },
      {
        label: 'Sessions',
        value: formatMetricValue(sums.sessions),
        delta: metricDelta(sums.sessions, prevSums?.sessions)
      }
    ],
    verdict: gaKeyEventsVerdict(compareItems, sums, prevSums),
    trend: series.length > 1 ? {
      values: series,
      compareValues: prevSeries.length > 1 ? prevSeries : null,
      isTimeSeries: true,
      label: 'Key events per day'
    } : null,
    sections: [
      // Requested order: cards -> trend -> channel breakdown -> events.
      keyChannelSection,
      compareItems.length ? {
        type: 'compare',
        title: 'By event',
        items: compareItems
      } : null,
      gaHasRows(currBundle.breakdown) ? {
        type: 'details',
        label: `Breakdown by ${breakdownLabel.toLowerCase()}`,
        hint: 'Sorted by key events',
        table: gaReportTableSection('', currBundle.breakdown)
      } : null
    ]
  }));

  gaSetExport(`ga4-key-events-${meta.breakdown}-${meta.start}-${meta.end}.csv`, gaToCSV(currBundle.breakdown));
}
function gaReportTableSection(title, data){
  if (!gaHasRows(data)) return null;
  return {
    title,
    columns: (data.dimensionHeaders || []).map(header => ({
      label: GA_DIM_LABELS[header.name] || header.name
    })).concat((data.metricHeaders || []).map(header => ({
      label: gaMetricLabel(header.name),
      numeric: true
    }))),
    rows: data.rows.map(row => (
      (row.dimensionValues || []).map(value => value.value || '—')
        .concat((row.metricValues || []).map(value => gaNf(value.value || 0)))
    ))
  };
}
function gaSummarizeReport(report){
  const sums = {};
  for (const row of (report?.rows || [])){
    row.metricValues?.forEach((mv, index) => {
      const key = report.metricHeaders?.[index]?.name;
      if (!key) return;
      sums[key] = (sums[key] || 0) + Number(mv.value || 0);
    });
  }
  return sums;
}
function gaMetricSeries(report, metricName){
  const metricIndex = Object.fromEntries((report?.metricHeaders || []).map((h, i) => [h.name, i]))[metricName];
  if (metricIndex == null) return [];
  return (report?.rows || []).map(row => Number(row.metricValues?.[metricIndex]?.value || 0));
}
function gaPickSummaryReport(bundle){
  if (gaHasRows(bundle?.eventTotals)) return bundle.eventTotals;
  if (gaHasRows(bundle?.trend)) return bundle.trend;
  if (gaHasRows(bundle?.breakdown)) return bundle.breakdown;
  return null;
}
function gaNf(n){ return Number(n || 0).toLocaleString(); }
function gaPctDelta(curr, prev){
  if (prev == null || prev === 0) return { text:"—", cls:"" };
  const d = ((curr - prev) / prev) * 100;
  return { text: (d > 0 ? "+" : "") + d.toFixed(1) + "%", cls: d >= 0 ? "up" : "down" };
}
function gaToCSV(data){
  const dimH = (data?.dimensionHeaders || []).map(h => h.name);
  const metH = (data?.metricHeaders || []).map(h => h.name);
  const head = dimH.concat(metH);
  const lines = [ head.join(",") ];
  for (const r of (data?.rows || [])){
    const dims = (r.dimensionValues || []).map(v => `"${String(v.value || "").replace(/"/g,'""')}"`);
    const mets = (r.metricValues || []).map(v => String(v.value || "0"));
    lines.push(dims.concat(mets).join(","));
  }
  return lines.join("\n");
}


// Ends GA4

// ===== CallRail =====
function crIso(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoAddDays(iso, delta){
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return crIso(d);
}
function monthStartISO(d=new Date()){
  const x = new Date(d);
  x.setDate(1);
  return crIso(x);
}
function monthEndISO(d=new Date()){
  const x = new Date(d);
  // last day of month
  x.setMonth(x.getMonth()+1);
  x.setDate(0);
  return crIso(x);
}

function setServiceActive(id, connected){
  const el = $(id);
  if (!el) return;
  el.hidden = !connected;
  el.classList.toggle('is-active', !!connected);
}
function setCallrailSettingsConnected(connected){
  setServiceActive('callrailActiveStatus', connected);
  $('settingsCallrailCard')?.classList.toggle('is-connected', !!connected);
}
async function crGetStored(){
  const preferenceKeys = [
    'callrailAccountNumericId','callrailCompanyId',
    'callrailRange','callrailStart','callrailEnd','callrailGroupBy',
    'callrailDevice','callrailLeadStatus','callrailFirstTime','callrailMinDur','callrailMaxDur'
  ];
  const [localValues, sessionValues] = await Promise.all([
    chrome.storage.local.get([...preferenceKeys, 'callrailApiKey']),
    chrome.storage.session.get('callrailApiKey')
  ]);

  let callrailApiKey = sessionValues.callrailApiKey || '';
  if (!callrailApiKey && localValues.callrailApiKey){
    // Migrate the credential from older versions without interrupting this session.
    callrailApiKey = localValues.callrailApiKey;
    await chrome.storage.session.set({ callrailApiKey });
  }
  if (localValues.callrailApiKey) await chrome.storage.local.remove('callrailApiKey');
  delete localValues.callrailApiKey;
  return { ...localValues, callrailApiKey };
}
async function crSetStored(obj){
  const values = { ...(obj || {}) };
  if (Object.prototype.hasOwnProperty.call(values, 'callrailApiKey')){
    const callrailApiKey = values.callrailApiKey;
    delete values.callrailApiKey;
    await chrome.storage.local.remove('callrailApiKey');
    if (callrailApiKey) await chrome.storage.session.set({ callrailApiKey });
    else await chrome.storage.session.remove('callrailApiKey');
  }
  if (Object.keys(values).length) await chrome.storage.local.set(values);
}

function crFillSelect(selId, items, {placeholder="Select…", valueKey="value", labelKey="label", allowEmpty=false, emptyLabel="All"}={}){
  const sel = $(selId); if(!sel) return;
  sel.innerHTML = '';
  if (allowEmpty){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = emptyLabel;
    sel.appendChild(opt);
  }
  if (!items?.length){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    sel.appendChild(opt);
    return;
  }
  for (const it of items){
    const opt = document.createElement('option');
    opt.value = it[valueKey];
    opt.textContent = it[labelKey];
    sel.appendChild(opt);
  }
}

function crRowsToCSV(rows, meta){
  const head = ['Source','Total Calls','Answered Calls','Missed Calls','Voicemails','Returning Callers','First-Time Callers','Average Duration'];
  const lines = [head.join(',')];
  for (const r of (rows||[])){
    const line = [
      r.key,
      r.total_calls,
      r.answered_calls,
      r.missed_calls,
      r.voicemails,
      r.returning_callers,
      r.first_time_callers,
      r.formatted_average_duration
    ].map(v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(',');
    lines.push(line);
  }
  const prefix = meta ? `# ${meta.companyName||''} | ${meta.start}..${meta.end} | group_by=${meta.groupBy}\n` : '';
  return prefix + lines.join('\n');
}

async function crFetchSummary(payload){
  const response = await send(Object.assign({ type:'callrailCallSummary' }, payload));
  if (!response.ok) throw apiErrorFromResponse(response, 'CallRail error');
  return {
    data: response.data || {},
    cache: response.cache || null
  };
}
function crSummarizeRows(rows){
  const summary = (rows || []).reduce((acc, row) => {
    const totalCalls = Number(row.total_calls || 0);
    const avgDuration = Number(row.average_duration || 0);
    acc.total_calls += totalCalls;
    acc.answered_calls += Number(row.answered_calls || 0);
    acc.missed_calls += Number(row.missed_calls || 0);
    acc.voicemails += Number(row.voicemails || 0);
    acc.returning_callers += Number(row.returning_callers || 0);
    acc.first_time_callers += Number(row.first_time_callers || 0);
    acc.duration_weighted += avgDuration * totalCalls;
    return acc;
  }, {
    total_calls: 0,
    answered_calls: 0,
    missed_calls: 0,
    voicemails: 0,
    returning_callers: 0,
    first_time_callers: 0,
    duration_weighted: 0
  });
  summary.average_duration = summary.total_calls ? (summary.duration_weighted / summary.total_calls) : 0;
  summary.formatted_average_duration = formatDurationShort(summary.average_duration);
  return summary;
}
function crRate(part, total){
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return Number(part || 0) / denominator;
}
async function crLoadAccounts({ forceRefresh=false } = {}){
  crSetStatus('Connecting to CallRail…');
  const r = await send({ type: 'callrailListAccounts', forceRefresh: !!forceRefresh });
  if (!r.ok) throw apiErrorFromResponse(r, 'CallRail error');
  CR.accountCache = r.cache || null;
  CR.accounts = (r.data?.accounts || []).map(a => ({
    id: a.id,
    numeric_id: a.numeric_id,
    name: a.name
  }));

  // prefer numeric_id for subsequent endpoints
  const items = CR.accounts.map(a => ({ value: String(a.numeric_id || a.id || ''), label: `${a.name} • ${a.numeric_id || a.id}` }));
  crFillSelect('crAccount', items, {placeholder:'Select account', valueKey:'value', labelKey:'label'});
  const stored = await crGetStored();
  const sel = $('crAccount');
  if (sel){
    const preferred = stored.callrailAccountNumericId;
    if (preferred && Array.from(sel.options).some(o=>o.value===String(preferred))) sel.value = String(preferred);
    else if (sel.options.length) sel.selectedIndex = 0;
  }
  await crSetStored({ callrailAccountNumericId: $('crAccount')?.value || '' });
  await crLoadCompanies({ forceRefresh });
  crRenderListCacheNote();
  setCallrailSettingsConnected(true);
  crSetStatus('Connected');
}

async function crLoadCompanies({ forceRefresh=false } = {}){
  const accountId = $('crAccount')?.value;
  if (!accountId) return;
  const r = await send({ type:'callrailListCompanies', accountId, forceRefresh: !!forceRefresh });
  if (!r.ok) throw apiErrorFromResponse(r, 'Failed to list companies');
  CR.companyCache = r.cache || null;
  CR.companies = (r.data?.companies || []).map(c => ({ id:c.id, name:c.name }));
  const items = CR.companies.map(c => ({ value: c.id, label: c.name }));
  crFillSelect('crCompany', items, {placeholder:'All companies', valueKey:'value', labelKey:'label', allowEmpty:true, emptyLabel:'All companies'});
  const stored = await crGetStored();
  const sel = $('crCompany');
  if (sel && stored.callrailCompanyId && Array.from(sel.options).some(o=>o.value===stored.callrailCompanyId)){
    sel.value = stored.callrailCompanyId;
  }
  crRenderListCacheNote();
}

async function crEnsureInit(){
  if (CR.inited) return;
  CR.inited = true;

  // restore saved values
  const stored = await crGetStored();
  const hasKey = !!stored.callrailApiKey;
  setCallrailSettingsConnected(false);
  $('crDisconnect')?.setAttribute('style', hasKey ? '' : 'opacity:.6; pointer-events:none');
  if (hasKey){
    $('crApiKey').value = '••••••••••';
  }

  // Restore ranges/filters
  const rangeSelect = $('crRange');
  if (stored.callrailRange && rangeSelect
      && Array.from(rangeSelect.options || []).some(o => o.value === stored.callrailRange)){
    rangeSelect.value = stored.callrailRange;
  }
  if (stored.callrailGroupBy && CR_GROUPS.some(g => g.key === stored.callrailGroupBy)){
    CR.filters.group = stored.callrailGroupBy;
  }
  if (stored.callrailDevice) $('crDevice').value = stored.callrailDevice;
  if (stored.callrailLeadStatus != null) $('crLeadStatus').value = stored.callrailLeadStatus;
  if (stored.callrailFirstTime != null) $('crFirstTime').value = stored.callrailFirstTime;
  if (stored.callrailMinDur != null) $('crMinDur').value = stored.callrailMinDur;
  if (stored.callrailMaxDur != null) $('crMaxDur').value = stored.callrailMaxDur;

  const range = $('crRange')?.value || '28';
  const isCustomRange = range === 'custom';
  if (stored.callrailStart) $('crStart').value = stored.callrailStart;
  if (stored.callrailEnd) $('crEnd').value = stored.callrailEnd;
  syncDateRangeControl('crStart');
  setDateRangeMode('crRange', 'crStart', isCustomRange);

  // wire events
  // Range, account and company changes are wired in mountCallRail(); wiring
  // them twice fired two reports per change.
  on('crRefreshLists','click', async ()=>{
    try{
      await crLoadAccounts({ forceRefresh:true });
    }catch(e){ setCallrailSettingsConnected(false); crSetStatus(e.message || String(e), true); }
  });
  on('settingsRefreshCallrail','click', async ()=>{
    try{
      await crLoadAccounts({ forceRefresh:true });
    }catch(e){ setCallrailSettingsConnected(false); crSetStatus(e.message || String(e), true); }
  });

  on('crSaveKey','click', async ()=>{
    try{
      const val = $('crApiKey')?.value?.trim();
      if (!val || val === '••••••••••'){
        return crSetStatus('Paste an API key.', true);
      }
      await crSetStored({ callrailApiKey: val });
      setCallrailSettingsConnected(false);
      await send({ type:'callrailInvalidateCache' }).catch(()=>null);
      CR.accountCache = null;
      CR.companyCache = null;
      CR.reportCache = null;
      crRenderListCacheNote();
      crRenderReportCacheNote();
      $('crApiKey').value = '••••••••••';
      $('crDisconnect')?.setAttribute('style','');
      await crLoadAccounts({ forceRefresh:true });
    }catch(e){ crSetStatus(e.message || String(e), true); }
  });
  on('crDisconnect','click', async ()=>{
    await crSetStored({ callrailApiKey:'', callrailAccountNumericId:'', callrailCompanyId:'' });
    await send({ type:'callrailInvalidateCache' }).catch(()=>null);
    CR.accountCache = null;
    CR.companyCache = null;
    CR.reportCache = null;
    $('crApiKey').value = '';
    $('crAccount').innerHTML = '<option value="">Select account</option>';
    $('crCompany').innerHTML = '<option value="">All companies</option>';
    $('crResult').innerHTML = '';
    $('crDisconnect')?.setAttribute('style','opacity:.6; pointer-events:none');
    setCallrailSettingsConnected(false);
    crRenderListCacheNote();
    crRenderReportCacheNote();
    crSetStatus('Disconnected.');
  });

  on('crLoad','click', ()=> crLoadSummary({ forceRefresh:false }));
  on('crRefreshData','click', ()=> crLoadSummary({ forceRefresh:true }));
  on('crExport','click', ()=>{
    if (!CR.lastRows?.length) return;
    const csv = crRowsToCSV(CR.lastRows, CR.lastMeta);
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `callrail-${(CR.lastMeta?.groupBy||'source')}-${(CR.lastMeta?.start||'')}-${(CR.lastMeta?.end||'')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // If key already stored, auto-connect + load accounts once
  if (hasKey){
    try{ await crLoadAccounts(); }
    catch(e){ setCallrailSettingsConnected(false); crSetStatus(e.message || String(e), true); }
  }else{
    setCallrailSettingsConnected(false);
    crSetStatus('Add an API key in Settings.');
    crFillSelect('crAccount', [], {placeholder:'Add API key'});
    crFillSelect('crCompany', [], {placeholder:'All companies', allowEmpty:true, emptyLabel:'All companies'});
    crRenderListCacheNote();
    crRenderReportCacheNote();
  }
}

// initialize CallRail when tab opened
on('navCallRail','click', ()=>{ crEnsureInit(); });
on('navSettings','click', ()=>{ crEnsureInit(); });

// Ends CallRail


/* ---------- Active tab helpers ---------- */
async function getActiveTab(){ const [tab] = await chrome.tabs.query({ active:true, currentWindow:true }); return tab; }
async function getActiveTabUrl(){
  try{ const tab = await getActiveTab(); const url = tab?.url || ''; return /^https?:/i.test(url) ? url : ''; }
  catch{ return ''; }
}
async function collectActivePageDiagnostics(options = {}){
  const mode = options.mode || 'onpage';
  const includeFetch = !!options.includeFetch;
  const includeTags = mode === 'tags' || !!options.includeTags;
  const frameLabel = window.top === window ? 'top frame' : `iframe: ${location.href}`;
  const uniq = (values) => Array.from(new Set((values || []).filter(Boolean)));
  const meta = (selector, attr='content') => (document.querySelector(selector)?.getAttribute(attr) || '').trim();
  const abs = (value) => { try { return new URL(value, location.href).href; } catch { return ''; } };
  const collectMatches = (sources, pattern) => {
    const out = new Set();
    (sources || []).forEach(source => {
      const text = String(source || '');
      if (!text) return;
      const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      let match;
      while ((match = regex.exec(text)) !== null) out.add((match[1] || match[0] || '').trim());
    });
    return Array.from(out).filter(Boolean);
  };

  const scriptEls = Array.from(document.scripts || []);
  const scriptUrls = uniq(scriptEls.map(script => script.src || script.getAttribute('src') || '').map(url => url.trim()).filter(Boolean));
  const inlineScripts = scriptEls.map(script => script.textContent || '').filter(Boolean);
  const noscripts = Array.from(document.querySelectorAll('noscript')).map(node => node.textContent || '').filter(Boolean);
  const iframeSources = uniq(Array.from(document.querySelectorAll('iframe[src]')).map(frame => frame.getAttribute('src') || '').map(abs).filter(Boolean));
  const resourceUrls = (() => {
    try { return uniq((performance.getEntriesByType?.('resource') || []).map(entry => entry.name).filter(Boolean)); }
    catch { return []; }
  })();
  const textSources = [...inlineScripts, ...noscripts];
  const urlSources = [...scriptUrls, ...resourceUrls, ...iframeSources];
  const allSources = [...textSources, ...urlSources];

  const diagnostics = {
    url: location.href,
    origin: location.origin,
    hostname: location.hostname,
    protocol: location.protocol,
    frame: frameLabel,
    title: (document.title || '').trim(),
    metaDesc: meta('meta[name="description"]') || meta('meta[name="Description"]'),
    robotsMeta: (meta('meta[name="robots"]') || meta('meta[name="ROBOTS"]')).toLowerCase(),
    canonical: abs(document.querySelector('link[rel="canonical"]')?.getAttribute('href') || ''),
    canonicalCrossDomain: false,
    language: document.documentElement?.lang || '',
    charset: meta('meta[charset]', 'charset') || document.characterSet || '',
    viewport: meta('meta[name="viewport"]'),
    doctype: document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '',
    h1Texts: [],
    h1Count: 0,
    headingCounts: {},
    headingSequence: [],
    headingSkips: 0,
    wordCount: 0,
    internalLinks: 0,
    externalLinks: 0,
    nofollowLinks: 0,
    weakAnchorCount: 0,
    emptyAnchorCount: 0,
    weakAnchorSamples: [],
    imgCount: 0,
    imgMissingAlt: 0,
    iframeCount: document.querySelectorAll('iframe').length,
    ldTypes: [],
    openGraph: {
      title: meta('meta[property="og:title"]'),
      description: meta('meta[property="og:description"]'),
      image: meta('meta[property="og:image"]'),
      type: meta('meta[property="og:type"]'),
      url: meta('meta[property="og:url"]')
    },
    twitterCard: {
      card: meta('meta[name="twitter:card"]'),
      title: meta('meta[name="twitter:title"]'),
      description: meta('meta[name="twitter:description"]'),
      image: meta('meta[name="twitter:image"]')
    },
    robotsTxt: { checked: false, ok: false, status: 0, url: '', error: '' },
    sitemap: { found: false, entries: [], probeUrl: '' },
    tags: []
  };

  try {
    if (diagnostics.canonical) {
      const canonicalHost = new URL(diagnostics.canonical).hostname.replace(/^www\./, '');
      const pageHost = location.hostname.replace(/^www\./, '');
      diagnostics.canonicalCrossDomain = !!canonicalHost && canonicalHost !== pageHost;
    }
  } catch {}

  const headingNodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(node => ({
    level: Number(node.tagName.slice(1)),
    text: (node.textContent || '').replace(/\s+/g, ' ').trim()
  })).filter(node => node.text);
  diagnostics.h1Texts = headingNodes.filter(node => node.level === 1).map(node => node.text);
  diagnostics.h1Count = diagnostics.h1Texts.length;
  ['H1','H2','H3','H4','H5','H6'].forEach(level => { diagnostics.headingCounts[level] = 0; });
  headingNodes.forEach(node => {
    diagnostics.headingCounts[`H${node.level}`] = (diagnostics.headingCounts[`H${node.level}`] || 0) + 1;
    diagnostics.headingSequence.push(`H${node.level}: ${node.text}`);
  });
  for (let index = 1; index < headingNodes.length; index += 1) {
    if ((headingNodes[index].level - headingNodes[index - 1].level) > 1) diagnostics.headingSkips += 1;
  }

  const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  diagnostics.wordCount = bodyText ? bodyText.split(/\s+/).filter(word => /\w/.test(word)).length : 0;

  const weakPatterns = [/^click here$/i, /^read more$/i, /^learn more$/i, /^more$/i, /^here$/i, /^link$/i, /^view more$/i];
  Array.from(document.querySelectorAll('a[href]')).forEach(anchor => {
    const href = abs(anchor.getAttribute('href') || '');
    if (!href) return;
    let anchorHost = '';
    try { anchorHost = new URL(href).hostname.replace(/^www\./, ''); } catch {}
    const pageHost = location.hostname.replace(/^www\./, '');
    if (anchorHost === pageHost) diagnostics.internalLinks += 1;
    else diagnostics.externalLinks += 1;
    if ((anchor.getAttribute('rel') || '').toLowerCase().includes('nofollow')) diagnostics.nofollowLinks += 1;
    const anchorText = ((anchor.textContent || '').replace(/\s+/g, ' ').trim() || anchor.getAttribute('aria-label') || '').trim();
    if (!anchorText) diagnostics.emptyAnchorCount += 1;
    else if (weakPatterns.some(pattern => pattern.test(anchorText))) {
      diagnostics.weakAnchorCount += 1;
      if (diagnostics.weakAnchorSamples.length < 6) diagnostics.weakAnchorSamples.push(anchorText);
    }
  });

  const images = Array.from(document.querySelectorAll('img'));
  diagnostics.imgCount = images.length;
  diagnostics.imgMissingAlt = images.filter(image => !image.hasAttribute('alt') || String(image.getAttribute('alt')).trim() === '').length;

  Array.from(document.querySelectorAll('script[type="application/ld+json"]')).forEach(script => {
    try {
      const walk = (value) => {
        if (!value) return;
        if (Array.isArray(value)) return value.forEach(walk);
        if (typeof value !== 'object') return;
        if (Array.isArray(value['@graph'])) value['@graph'].forEach(walk);
        const types = value['@type'];
        if (typeof types === 'string') diagnostics.ldTypes.push(types);
        if (Array.isArray(types)) types.forEach(type => diagnostics.ldTypes.push(type));
      };
      walk(JSON.parse(script.textContent || 'null'));
    } catch {}
  });
  diagnostics.ldTypes = uniq(diagnostics.ldTypes);

  if (includeFetch) {
    const robotsUrl = `${location.origin.replace(/\/$/, '')}/robots.txt`;
    diagnostics.robotsTxt.url = robotsUrl;
    diagnostics.robotsTxt.checked = true;
    try {
      const response = await fetch(robotsUrl, { credentials: 'omit', cache: 'no-store' });
      diagnostics.robotsTxt.ok = response.ok;
      diagnostics.robotsTxt.status = response.status;
      const text = response.ok ? await response.text() : '';
      const sitemapEntries = text
        .split(/\r?\n/)
        .map(line => line.match(/^\s*sitemap:\s*(.+)$/i)?.[1]?.trim() || '')
        .filter(Boolean);
      diagnostics.sitemap.entries = uniq([...diagnostics.sitemap.entries, ...sitemapEntries]);
      diagnostics.sitemap.found = diagnostics.sitemap.entries.length > 0;
    } catch (error) {
      diagnostics.robotsTxt.error = String(error?.message || error);
    }
    diagnostics.sitemap.probeUrl = `${location.origin.replace(/\/$/, '')}/sitemap.xml`;
    if (!diagnostics.sitemap.found) {
      try {
        let response = await fetch(diagnostics.sitemap.probeUrl, { method: 'HEAD', credentials: 'omit', cache: 'no-store' });
        if (!response.ok || response.status === 405) response = await fetch(diagnostics.sitemap.probeUrl, { credentials: 'omit', cache: 'no-store' });
        if (response.ok) {
          diagnostics.sitemap.found = true;
          diagnostics.sitemap.entries = uniq([...diagnostics.sitemap.entries, diagnostics.sitemap.probeUrl]);
        }
      } catch {}
    }
  }

  if (includeTags) {
    const tagHits = [];
    const addHit = (vendor, { ids = [], evidence = [], confidence = 'medium', notes = [] } = {}) => {
      const cleanIds = uniq(ids.map(id => String(id).trim()).filter(Boolean));
      const cleanEvidence = uniq(evidence.map(item => String(item).trim()).filter(Boolean));
      const cleanNotes = uniq(notes.map(item => String(item).trim()).filter(Boolean));
      if (!cleanIds.length && !cleanEvidence.length) return;
      tagHits.push({ vendor, status: 'detected', ids: cleanIds, evidence: cleanEvidence, frame: frameLabel, confidence, notes: cleanNotes });
    };
    const hasUrl = (pattern) => urlSources.some(source => pattern.test(String(source)));
    const hasText = (pattern) => textSources.some(source => pattern.test(String(source)));
    const dataLayerDump = (() => { try { return JSON.stringify(window.dataLayer || []); } catch { return ''; } })();
    const gtmKeys = (() => { try { return Object.keys(window.google_tag_manager || {}); } catch { return []; } })();

    const gtmIds = uniq([
      ...collectMatches(allSources, /(GTM-[A-Z0-9]{4,})/i),
      ...gtmKeys.filter(key => /^GTM-[A-Z0-9]{4,}$/i.test(key))
    ]);
    const googleIds = uniq([
      ...collectMatches(allSources, /((?:G|AW|DC)-[A-Z0-9-]{4,})/i),
      ...collectMatches([dataLayerDump], /((?:G|AW|DC)-[A-Z0-9-]{4,})/i)
    ]);
    const metaIds = uniq([
      ...collectMatches(textSources, /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{5,})['"]/i),
      ...collectMatches(allSources, /facebook\.com\/tr\?id=(\d{5,})/i)
    ]);
    const uetIds = uniq(collectMatches(allSources, /(?:\bti\s*[:=]\s*['"]?|\btagid['"]?\s*:\s*['"]?)(\d{5,})/i));
    const clarityIds = uniq(collectMatches(allSources, /clarity\.ms\/tag\/([a-z0-9]+)/i));
    const hotjarIds = uniq([
      ...collectMatches(allSources, /hotjar-(\d+)\.js/i),
      ...collectMatches(allSources, /\bhjid\s*[:=]\s*(\d+)/i)
    ]);
    const redditIds = uniq(collectMatches(allSources, /rdt\s*\(\s*['"]init['"]\s*,\s*['"]([a-zA-Z0-9_:-]+)['"]/i));
    const quoraIds = uniq(collectMatches(allSources, /qp\s*\(\s*['"]init['"]\s*,\s*['"]([a-zA-Z0-9_-]+)['"]/i));
    const linkedinIds = uniq(collectMatches(allSources, /_linkedin_partner_id\s*=\s*['"](\d+)['"]/i));
    const pinterestIds = uniq(collectMatches(allSources, /pintrk\s*\(\s*['"]load['"]\s*,\s*['"]([a-zA-Z0-9]+)['"]/i));
    const tiktokIds = uniq(collectMatches(allSources, /ttq\.load\(\s*['"]([a-zA-Z0-9]+)['"]/i));
    const twitterIds = uniq(collectMatches(allSources, /twq\s*\(\s*['"]config['"]\s*,\s*['"]([a-zA-Z0-9]+)['"]/i));
    const snapIds = uniq(collectMatches(allSources, /snaptr\s*\(\s*['"]init['"]\s*,\s*['"]([a-zA-Z0-9-]+)['"]/i));

    if (gtmIds.length || hasUrl(/googletagmanager\.com\/gtm\.js/i) || hasUrl(/googletagmanager\.com\/ns\.html/i)) {
      addHit('Google Tag Manager', { ids: gtmIds, evidence: ['script src', hasUrl(/googletagmanager\.com\/ns\.html/i) ? 'iframe' : ''].filter(Boolean), confidence: gtmIds.length ? 'high' : 'medium' });
    }
    if (googleIds.length || hasUrl(/googletagmanager\.com\/gtag\/js/i) || typeof window.gtag === 'function') {
      addHit('Google tag / gtag.js', {
        ids: googleIds,
        evidence: ['script src', typeof window.gtag === 'function' ? 'global object' : '', googleIds.length ? 'dataLayer' : ''].filter(Boolean),
        confidence: googleIds.length ? 'high' : 'medium'
      });
    }
    if (googleIds.some(id => /^G-/i.test(id))) addHit('GA4', { ids: googleIds.filter(id => /^G-/i.test(id)), evidence: ['script src', dataLayerDump ? 'dataLayer' : ''].filter(Boolean), confidence: 'high' });
    if (googleIds.some(id => /^AW-/i.test(id))) addHit('Google Ads', { ids: googleIds.filter(id => /^AW-/i.test(id)), evidence: ['script src', dataLayerDump ? 'dataLayer' : ''].filter(Boolean), confidence: 'high' });
    if (googleIds.some(id => /^DC-/i.test(id))) addHit('DoubleClick', { ids: googleIds.filter(id => /^DC-/i.test(id)), evidence: ['script src', dataLayerDump ? 'dataLayer' : ''].filter(Boolean), confidence: 'high' });
    if (metaIds.length || hasUrl(/connect\.facebook\.net\/.*fbevents\.js/i) || typeof window.fbq === 'function') {
      addHit('Meta Pixel', { ids: metaIds, evidence: ['script src', typeof window.fbq === 'function' ? 'global object' : '', hasText(/fbq\s*\(/i) ? 'inline init' : ''].filter(Boolean), confidence: metaIds.length ? 'high' : 'medium' });
    }
    if (uetIds.length || hasUrl(/bat\.bing\.com\/bat\.js/i) || typeof window.uetq !== 'undefined') {
      addHit('Microsoft Ads / UET', { ids: uetIds, evidence: ['script src', typeof window.uetq !== 'undefined' ? 'global object' : '', hasText(/UET\s*\(/i) ? 'inline init' : ''].filter(Boolean), confidence: uetIds.length ? 'high' : 'medium' });
    }
    if (clarityIds.length || hasUrl(/clarity\.ms\/tag\//i) || typeof window.clarity === 'function') {
      addHit('Microsoft Clarity', { ids: clarityIds, evidence: ['script src', typeof window.clarity === 'function' ? 'global object' : ''].filter(Boolean), confidence: clarityIds.length ? 'high' : 'medium' });
    }
    if (hotjarIds.length || hasUrl(/hotjar/i) || typeof window.hj === 'function') {
      addHit('Hotjar', { ids: hotjarIds, evidence: ['script src', typeof window.hj === 'function' ? 'global object' : '', hasText(/hjid/i) ? 'inline init' : ''].filter(Boolean), confidence: hotjarIds.length ? 'high' : 'medium' });
    }
    if (redditIds.length || hasUrl(/redditstatic\.com\/ads\/pixel/i) || typeof window.rdt === 'function') {
      addHit('Reddit Pixel', { ids: redditIds, evidence: ['script src', typeof window.rdt === 'function' ? 'global object' : '', hasText(/rdt\s*\(/i) ? 'inline init' : ''].filter(Boolean), confidence: redditIds.length ? 'high' : 'medium' });
    }
    if (quoraIds.length || hasUrl(/quora\.com\/qevents/i) || typeof window.qp === 'function') {
      addHit('Quora Pixel', { ids: quoraIds, evidence: ['script src', typeof window.qp === 'function' ? 'global object' : '', hasText(/qp\s*\(/i) ? 'inline init' : ''].filter(Boolean), confidence: quoraIds.length ? 'high' : 'medium' });
    }
    if (linkedinIds.length || hasUrl(/licdn\.com\/li\.lms-analytics\/insight/i)) {
      addHit('LinkedIn Insight', { ids: linkedinIds, evidence: ['script src', hasText(/linkedin_partner_id/i) ? 'inline init' : ''].filter(Boolean), confidence: linkedinIds.length ? 'high' : 'medium' });
    }
    if (pinterestIds.length || hasUrl(/s\.pinimg\.com\/ct\/core\.js/i) || typeof window.pintrk === 'function') {
      addHit('Pinterest', { ids: pinterestIds, evidence: ['script src', typeof window.pintrk === 'function' ? 'global object' : '', hasText(/pintrk\s*\(/i) ? 'inline init' : ''].filter(Boolean), confidence: pinterestIds.length ? 'high' : 'medium' });
    }
    if (tiktokIds.length || hasUrl(/analytics\.tiktok\.com/i) || typeof window.ttq === 'object') {
      addHit('TikTok', { ids: tiktokIds, evidence: ['script src', typeof window.ttq === 'object' ? 'global object' : '', hasText(/ttq\./i) ? 'inline init' : ''].filter(Boolean), confidence: tiktokIds.length ? 'high' : 'medium' });
    }
    if (twitterIds.length || hasUrl(/static\.ads-twitter\.com\/uwt\.js/i) || typeof window.twq === 'function') {
      addHit('X / Twitter', { ids: twitterIds, evidence: ['script src', typeof window.twq === 'function' ? 'global object' : '', hasText(/twq\s*\(/i) ? 'inline init' : ''].filter(Boolean), confidence: twitterIds.length ? 'high' : 'medium' });
    }
    if (snapIds.length || hasUrl(/sc-static\.net\/scevent\.min\.js/i) || typeof window.snaptr === 'function') {
      addHit('Snap', { ids: snapIds, evidence: ['script src', typeof window.snaptr === 'function' ? 'global object' : '', hasText(/snaptr\s*\(/i) ? 'inline init' : ''].filter(Boolean), confidence: snapIds.length ? 'high' : 'medium' });
    }

    const otherVendors = [];
    if (hasUrl(/segment\.com|cdn\.segment\.com/i)) otherVendors.push('Segment');
    if (hasUrl(/js\.agent\.rudderstack\.com|cdn\.rudderlabs\.com/i)) otherVendors.push('RudderStack');
    if (hasUrl(/taboola\.com/i)) otherVendors.push('Taboola');
    if (hasUrl(/outbrain\.com/i)) otherVendors.push('Outbrain');
    if (hasUrl(/adroll\.com/i)) otherVendors.push('AdRoll');
    if (hasUrl(/criteo\.com/i)) otherVendors.push('Criteo');
    if (otherVendors.length) {
      addHit('Other marketing tags', {
        ids: otherVendors,
        evidence: ['script src'],
        confidence: 'low',
        notes: ['Matched additional marketing or analytics vendor domains.']
      });
    }

    diagnostics.tags = tagHits;
  }

  return diagnostics;
}
async function runActivePageDiagnostics(options = {}, execOptions = {}){
  const tab = await getActiveTab();
  if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Open a public page.');
  const params = {
    target: execOptions.allFrames ? { tabId: tab.id, allFrames: true } : { tabId: tab.id },
    func: collectActivePageDiagnostics,
    args: [options]
  };
  if (execOptions.world === 'MAIN') params.world = 'MAIN';
  const results = await chrome.scripting.executeScript(params);
  return { tab, results };
}
async function collectIndexingSupplement(inspectedUrl){
  const safe = normalizeUrl(inspectedUrl || '');
  const active = normalizeUrl(await getActiveTabUrl().catch(() => ''));
  if (!safe || !active || safe !== active) return null;
  const { results } = await runActivePageDiagnostics({ mode: 'supplement' });
  return results?.[0]?.result || null;
}
function setPanelLoadState(key, loading){
  if (!state?.ui?.panelLoads) return;
  state.ui.panelLoads[key] = !!loading;
  const buttonId = key === 'onPage' ? 'runOnPage' : key === 'structuredData' ? 'runStructuredData' : '';
  const button = buttonId ? $(buttonId) : null;
  if (button) button.disabled = !!loading;
}
async function runOnPageAudit({ reason='button' } = {}){
  if (state.ui.panelLoads.onPage) return false;
  setPanelLoadState('onPage', true);
  clearResult('Running audit…', 'onPageResult');
  try{
    const { results } = await runActivePageDiagnostics({ mode: 'onpage', includeFetch: true });
    renderOnPage(results?.[0]?.result || {});
    return true;
  }catch(err){
    clearResult('❌ ' + (err?.message || err), 'onPageResult');
    return false;
  }finally{
    setPanelLoadState('onPage', false);
  }
}
async function runStructuredDataScan({ reason='button' } = {}){
  if (state.ui.panelLoads.structuredData) return false;
  setPanelLoadState('structuredData', true);
  const tab = await getActiveTab().catch(() => null);
  if (!tab || !/^https?:/i.test(tab.url || '')) {
    setPanelLoadState('structuredData', false);
    clearResult('Open a public page.', 'structuredDataResult');
    return false;
  }
  clearResult('Scanning…', 'structuredDataResult');
  try{
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractStructuredDataFromPage
    });
    renderStructuredData(result || { url: tab.url || '', items: [], counts: {}, errors: [] });
    return true;
  }catch(err){
    clearResult('❌ ' + (err?.message || err), 'structuredDataResult');
    return false;
  }finally{
    setPanelLoadState('structuredData', false);
  }
}
function chooseBestProperty(sites, pageUrl){
  if(!Array.isArray(sites) || !pageUrl) return null;
  let best = null, bestScore = -1, bestLen = -1;
  let host = ''; try { host = new URL(pageUrl).hostname || ''; } catch{}
  for(const s of sites){
    const site = s.siteUrl; let covers = false, score = 0, len = site.length;
    if(site.startsWith('sc-domain:')){
      const domain = site.split(':')[1];
      if(host === domain || (host && host.endsWith('.'+domain))){ covers = true; score = 1; len = domain.length; }
    } else if(pageUrl.startsWith(site)){ covers = true; score = 2; len = site.length; }
    if(covers){ if(score > bestScore || (score === bestScore && len > bestLen)){ best = site; bestScore = score; bestLen = len; } }
  }
  return best;
}

/* ---------- Renderers ---------- */
function ms(v){ return typeof v==='number' ? `${(v/1000).toFixed(2)}s` : (v||'—'); }
function toTitleCase(value=''){
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}
function humanizeInspectionValue(value){
  if (value == null || value === '') return '—';
  const key = String(value);
  const map = {
    PASS: 'Valid',
    FAIL: 'Issue detected',
    NEUTRAL: 'Excluded',
    PARTIAL: 'Partial',
    VERDICT_UNSPECIFIED: 'Unknown',
    ALLOWED: 'Allowed',
    DISALLOWED: 'Blocked',
    ROBOTS_TXT_STATE_UNSPECIFIED: 'Unknown',
    INDEXING_ALLOWED: 'Allowed',
    BLOCKED_BY_META_TAG: 'Blocked by meta noindex',
    BLOCKED_BY_HTTP_HEADER: 'Blocked by X-Robots-Tag',
    INDEXING_STATE_UNSPECIFIED: 'Unknown',
    SUCCESSFUL: 'Successful',
    SOFT_404: 'Soft 404',
    BLOCKED_ROBOTS_TXT: 'Blocked by robots.txt',
    NOT_FOUND: 'Not found (404)',
    ACCESS_DENIED: 'Unauthorized (401)',
    SERVER_ERROR: 'Server error (5xx)',
    REDIRECT_ERROR: 'Redirect error',
    ACCESS_FORBIDDEN: 'Forbidden (403)',
    BLOCKED_4XX: 'Blocked by 4xx',
    INTERNAL_CRAWL_ERROR: 'Internal crawl error',
    INVALID_URL: 'Invalid URL',
    PAGE_FETCH_STATE_UNSPECIFIED: 'Unknown',
    MOBILE: 'Googlebot smartphone',
    DESKTOP: 'Googlebot desktop',
    CRAWLING_USER_AGENT_UNSPECIFIED: 'Unknown crawler',
    WARNING: 'Warning',
    ERROR: 'Error'
  };
  if (map[key]) return map[key];
  return toTitleCase(key.replace(/_/g, ' '));
}
function formatInspectionDate(value){
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return escapeHtml(date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }));
}
function inspectionBadge(value){
  return stateBadge(humanizeInspectionValue(value));
}
function renderMaybeLink(value, label=''){
  if (!value) return '—';
  try{
    const url = new URL(String(value));
    const text = label || url.href;
    return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
  }catch{
    return escapeHtml(String(value));
  }
}
function renderValueList(items, emptyLabel='Nothing detected'){
  if (!Array.isArray(items) || !items.length) return `<p class="inspection-empty">${escapeHtml(emptyLabel)}</p>`;
  return `
    <ul class="inspection-list">
      ${items.map(item => `<li>${renderMaybeLink(item)}</li>`).join('')}
    </ul>
  `;
}
function renderIssueList(issues, emptyLabel='No issues detected'){
  if (!Array.isArray(issues) || !issues.length) return `<p class="inspection-empty">${escapeHtml(emptyLabel)}</p>`;
  return `
    <div class="inspection-issues">
      ${issues.map(issue => `
        <div class="inspection-subcard">
          <div class="inspection-subcard__head">
            <strong>${escapeHtml(issue.issueType ? humanizeInspectionValue(issue.issueType) : (issue.name || 'Issue'))}</strong>
            ${issue.severity ? inspectionBadge(issue.severity) : ''}
          </div>
          <p>${escapeHtml(issue.message || issue.issueMessage || 'This item needs review.')}</p>
        </div>
      `).join('')}
    </div>
  `;
}
function renderRichResultGroups(detectedItems){
  if (!Array.isArray(detectedItems) || !detectedItems.length) {
    return `<p class="inspection-empty">No rich result items detected.</p>`;
  }
  return detectedItems.map(group => {
    const items = Array.isArray(group?.items) ? group.items : [];
    return `
      <div class="inspection-subcard">
        <div class="inspection-subcard__head">
          <strong>${escapeHtml(group.richResultType || 'Rich result')}</strong>
          <span class="badge">${items.length} item${items.length === 1 ? '' : 's'}</span>
        </div>
        ${items.length ? `
          <div class="inspection-issues">
            ${items.map(item => `
              <div class="inspection-subcard inspection-subcard--nested">
                <div class="inspection-subcard__head">
                  <strong>${escapeHtml(item.name || 'Unnamed item')}</strong>
                  <span class="badge">${Array.isArray(item.issues) ? item.issues.length : 0} issue${(item.issues || []).length === 1 ? '' : 's'}</span>
                </div>
                ${renderIssueList(item.issues || [], 'This item has no rich result issues.')}
              </div>
            `).join('')}
          </div>
        ` : `<p class="inspection-empty">No individual items were listed for this rich result type.</p>`}
      </div>
    `;
  }).join('');
}
function auditStatusLabel(status){
  const map = { pass: 'Pass', warning: 'Warning', error: 'Error', info: 'Info' };
  return map[status] || 'Info';
}
function auditStatusClass(status){
  if (status === 'pass') return 'good';
  if (status === 'warning') return 'ok';
  if (status === 'error') return 'bad';
  return '';
}
function createAuditCheck(section, key, status, label, summary, value='', tips=[], details=''){
  return { section, key, status, label, summary, value, tips, details };
}
function summarizeAuditChecks(checks){
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, { pass: 0, warning: 0, error: 0, info: 0 });
}
function uiNode(tag, className='', text=''){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  return node;
}
function createAuditCheckNode(check){
  const details = Array.isArray(check.details) ? check.details.filter(Boolean) : [check.details].filter(Boolean);
  const tips = Array.isArray(check.tips) ? check.tips.filter(Boolean) : [];
  const article = uiNode('article', 'audit-check');
  const head = uiNode('div', 'audit-check__head');
  const copy = uiNode('div');
  copy.append(uiNode('strong', '', check.label), uiNode('p', '', check.summary));
  const statusClass = auditStatusClass(check.status);
  head.append(copy, uiNode('span', `badge${statusClass ? ` ${statusClass}` : ''}`, auditStatusLabel(check.status)));
  article.append(head);
  if (check.value) article.append(uiNode('div', 'audit-check__value', check.value));
  const appendList = (className, items) => {
    if (!items.length) return;
    const list = uiNode('ul', className);
    items.forEach(item => list.append(uiNode('li', '', item)));
    article.append(list);
  };
  appendList('audit-detail-list', details);
  appendList('audit-tip-list', tips);
  return article;
}
function renderIndexing(data){
  const inspection = data?.inspectionResult || data;
  if (!inspection) return clearResult('No data returned.', 'indexResult');

  const idx = inspection.indexStatusResult || {};
  const rich = inspection.richResultsResult || {};
  const mobile = inspection.mobileUsabilityResult || null;
  const livePage = data?.livePage || null;
  const sitemaps = Array.isArray(idx.sitemap) ? idx.sitemap : [];
  const referringUrls = Array.isArray(idx.referringUrls) ? idx.referringUrls : [];
  const richGroups = Array.isArray(rich.detectedItems) ? rich.detectedItems : [];
  const richItemCount = richGroups.reduce((sum, group) => sum + ((group?.items || []).length), 0);
  const mobileIssues = Array.isArray(mobile?.issues) ? mobile.issues : [];
  const cards = [];

  cards.push(`
    <div class="card summary-card">
      <div class="summary-card__header">
        <div>
          <h4>Page indexing</h4>
          <p>Selected URL.</p>
        </div>
        ${inspectionBadge(idx.verdict || 'VERDICT_UNSPECIFIED')}
      </div>
      <div class="meta-line">
        <span class="badge">${escapeHtml(idx.coverageState || 'Coverage unknown')}</span>
        <span class="badge">${escapeHtml(humanizeInspectionValue(idx.pageFetchState || 'PAGE_FETCH_STATE_UNSPECIFIED'))}</span>
        <span class="badge">${escapeHtml(humanizeInspectionValue(idx.crawledAs || 'CRAWLING_USER_AGENT_UNSPECIFIED'))}</span>
      </div>
      <div class="metric-strip">
        <div class="metric-tile"><span>Sitemaps</span><strong>${sitemaps.length.toLocaleString()}</strong></div>
        <div class="metric-tile"><span>Referring URLs</span><strong>${referringUrls.length.toLocaleString()}</strong></div>
        <div class="metric-tile"><span>Rich result items</span><strong>${richItemCount.toLocaleString()}</strong></div>
        <div class="metric-tile"><span>Mobile issues</span><strong>${mobileIssues.length.toLocaleString()}</strong></div>
      </div>
      ${inspection.inspectionResultLink ? `
        <div class="sd-actions">
          <a class="chip chip--accent" href="${escapeHtml(inspection.inspectionResultLink)}" target="_blank" rel="noopener">Open in GSC</a>
        </div>
      ` : ''}
    </div>
  `);

  cards.push(`
    <div class="card">
      <div class="summary-card__header">
        <div>
          <h4>Discovery</h4>
          <p>Known sources.</p>
        </div>
        <span class="badge">${(sitemaps.length + referringUrls.length).toLocaleString()} sources</span>
      </div>
      <div class="inspection-grid">
        <div>
          <h5>Sitemaps</h5>
          ${renderValueList(sitemaps, 'No sitemaps found.')}
        </div>
        <div>
          <h5>Referring pages</h5>
          ${renderValueList(referringUrls, 'No referring pages.')}
        </div>
      </div>
    </div>
  `);

  cards.push(`
    <div class="card">
      <div class="summary-card__header">
        <div>
          <h4>Crawl</h4>
          <p>Fetch and crawl.</p>
        </div>
        ${inspectionBadge(idx.pageFetchState || 'PAGE_FETCH_STATE_UNSPECIFIED')}
      </div>
      ${kv('Last crawl', formatInspectionDate(idx.lastCrawlTime))}
      ${kv('Crawled as', escapeHtml(humanizeInspectionValue(idx.crawledAs || 'CRAWLING_USER_AGENT_UNSPECIFIED')))}
      ${kv('Crawl allowed?', escapeHtml(humanizeInspectionValue(idx.robotsTxtState || 'ROBOTS_TXT_STATE_UNSPECIFIED')))}
      ${kv('Page fetch', escapeHtml(humanizeInspectionValue(idx.pageFetchState || 'PAGE_FETCH_STATE_UNSPECIFIED')))}
      ${kv('Indexing allowed?', escapeHtml(humanizeInspectionValue(idx.indexingState || 'INDEXING_STATE_UNSPECIFIED')))}
      ${kv('Coverage state', escapeHtml(idx.coverageState || '—'))}
    </div>
  `);

  cards.push(`
    <div class="card">
      <div class="summary-card__header">
        <div>
          <h4>Indexing</h4>
          <p>Canonical and index state.</p>
        </div>
        ${inspectionBadge(idx.indexingState || 'INDEXING_STATE_UNSPECIFIED')}
      </div>
      ${kv('User-declared canonical', idx.userCanonical ? renderMaybeLink(idx.userCanonical) : '—')}
      ${kv('Google-selected canonical', idx.googleCanonical ? renderMaybeLink(idx.googleCanonical) : '—')}
      ${kv('Inspection verdict', escapeHtml(humanizeInspectionValue(idx.verdict || 'VERDICT_UNSPECIFIED')))}
      ${kv('Indexing state', escapeHtml(humanizeInspectionValue(idx.indexingState || 'INDEXING_STATE_UNSPECIFIED')))}
    </div>
  `);

  cards.push(`
    <div class="card">
      <div class="summary-card__header">
        <div>
          <h4>Rich results</h4>
          <p>Detected items.</p>
        </div>
        ${inspectionBadge(rich.verdict || 'VERDICT_UNSPECIFIED')}
      </div>
      ${renderRichResultGroups(richGroups)}
    </div>
  `);

  if (mobile) {
    cards.push(`
      <div class="card">
        <div class="summary-card__header">
          <div>
            <h4>Mobile usability</h4>
            <p>Returned by Search Console.</p>
          </div>
          ${inspectionBadge(mobile.verdict || 'VERDICT_UNSPECIFIED')}
        </div>
        ${renderIssueList(mobileIssues, 'No mobile usability issues were returned for this page.')}
      </div>
    `);
  }

  if (livePage) {
    const robotsState = livePage.robotsMeta ? livePage.robotsMeta : 'None';
    cards.push(`
      <div class="card">
        <div class="summary-card__header">
          <div>
            <h4>Live page supplement</h4>
            <p>Current tab only.</p>
          </div>
          ${badge(livePage.protocol === 'https:' ? 'HTTPS' : 'HTTP', livePage.protocol === 'https:' ? 'good' : 'bad')}
        </div>
        ${kv('Protocol', escapeHtml((livePage.protocol || '—').replace(':', '').toUpperCase()))}
        ${kv('Meta robots', escapeHtml(robotsState))}
        ${kv('Canonical tag', livePage.canonical ? renderMaybeLink(livePage.canonical) : 'None')}
        ${kv('Canonical cross-domain?', escapeHtml(livePage.canonicalCrossDomain ? 'Yes' : 'No'))}
        ${kv('Language', escapeHtml(livePage.language || 'Missing'))}
      </div>
    `);
  }

  renderHtml('indexResult', cards.join(''));
}


function gscHasRows(report){
  return !!(report && Array.isArray(report.rows) && report.rows.length);
}
function gscSummaryRow(report){
  return (gscHasRows(report) ? report.rows[0] : null) || { clicks:0, impressions:0, ctr:0, position:0 };
}
function gscBreakdownLabel(dimension){
  return dimension === 'page' ? 'Page' : 'Query';
}
function computeMovers(currRows, prevRows, { keyFn, valueFn, limit=5, metaFn=null, suffix='' } = {}){
  const prevMap = new Map();
  (prevRows || []).forEach(row => {
    const key = keyFn(row);
    if (key == null) return;
    prevMap.set(String(key), Number(valueFn(row) || 0));
  });
  const movers = (currRows || []).map(row => {
    const key = String(keyFn(row) ?? '');
    const value = Number(valueFn(row) || 0);
    const prev = prevMap.has(key) ? prevMap.get(key) : 0;
    const delta = value - prev;
    prevMap.delete(key);
    return { key, value, prev, delta, row };
  });
  prevMap.forEach((prev, key) => {
    movers.push({ key, value: 0, prev, delta: -prev, row: null });
  });
  return movers
    .filter(item => Math.abs(item.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit)
    .map(item => ({
      label: item.key || '—',
      meta: metaFn ? metaFn(item) : '',
      delta: `${item.delta > 0 ? '+' : '−'}${formatMetricValue(Math.abs(item.delta))}${suffix ? ` ${suffix}` : ''}`,
      cls: item.delta > 0 ? 'up' : 'down'
    }));
}
function buildOnPageChecks(d){
  const checks = [];
  const add = (section, key, status, label, summary, value='', tips=[], details='') => {
    checks.push(createAuditCheck(section, key, status, label, summary, value, tips, details));
  };

  const title = (d.title || '').trim();
  const titleLength = title.length;
  if (!titleLength) add('URL & snippet', 'title', 'error', 'Title tag', 'The page is missing a title tag.', '', ['Add a unique title tag that targets the primary topic of the page.']);
  else if (titleLength < 15 || titleLength > 65) add('URL & snippet', 'title', 'warning', 'Title tag', `Title length is ${titleLength} characters.`, title, ['Keep titles descriptive and usually within 15-65 characters to avoid truncation or weak relevance.']);
  else add('URL & snippet', 'title', 'pass', 'Title tag', `Title length looks healthy at ${titleLength} characters.`, title);

  const metaDesc = (d.metaDesc || '').trim();
  const metaLength = metaDesc.length;
  if (!metaLength) add('URL & snippet', 'meta-description', 'error', 'Meta description', 'No meta description was found.', '', ['Add a compelling meta description so search snippets have stronger copy to pull from.']);
  else if (metaLength < 70 || metaLength > 160) add('URL & snippet', 'meta-description', 'warning', 'Meta description', `Meta description length is ${metaLength} characters.`, metaDesc, ['Aim for concise descriptions that usually land between 70 and 160 characters.']);
  else add('URL & snippet', 'meta-description', 'pass', 'Meta description', `Meta description length looks solid at ${metaLength} characters.`, metaDesc);

  const urlLength = String(d.url || '').length;
  add('URL & snippet', 'url-length', urlLength > 115 ? 'warning' : 'pass', 'URL length', `The inspected URL is ${urlLength} characters long.`, d.url || '', urlLength > 115 ? ['Shorter URLs are often easier to crawl, share, and read in SERPs.'] : []);

  add('Indexability', 'protocol', d.protocol === 'https:' ? 'pass' : 'error', 'HTTPS', d.protocol === 'https:' ? 'The page is served over HTTPS.' : 'The page is not served over HTTPS.', (d.protocol || '').replace(':', '').toUpperCase(), d.protocol === 'https:' ? [] : ['Serve the page over HTTPS so users and crawlers receive the secure canonical version.']);

  if (d.robotsTxt?.checked) {
    add(
      'Indexability',
      'robots-txt',
      d.robotsTxt.ok ? 'pass' : 'warning',
      'Robots.txt',
      d.robotsTxt.ok ? 'Robots.txt responded successfully.' : 'Robots.txt could not be confirmed from the active page context.',
      d.robotsTxt.url || '',
      d.robotsTxt.ok ? [] : ['Verify that robots.txt is reachable and not blocked by security tooling.'],
      d.robotsTxt.ok ? [`HTTP ${d.robotsTxt.status || 200}`] : [d.robotsTxt.error || `HTTP ${d.robotsTxt.status || 'unknown'}`]
    );
  }

  add(
    'Indexability',
    'sitemap',
    d.sitemap?.found ? 'pass' : 'warning',
    'XML sitemap',
    d.sitemap?.found ? 'At least one sitemap URL was discovered for this origin.' : 'No sitemap reference was confirmed from robots.txt or /sitemap.xml.',
    (d.sitemap?.entries || []).join(', '),
    d.sitemap?.found ? [] : ['Reference your XML sitemap in robots.txt and make sure /sitemap.xml or the preferred sitemap index is reachable.'],
    d.sitemap?.entries?.length ? d.sitemap.entries : (d.sitemap?.probeUrl ? [d.sitemap.probeUrl] : [])
  );

  const robotsMeta = String(d.robotsMeta || '').trim().toLowerCase();
  if (!robotsMeta) add('Canonicals & robots', 'robots-meta', 'pass', 'Robots meta', 'No blocking robots meta tag was found.', 'None');
  else if (robotsMeta.includes('noindex')) add('Canonicals & robots', 'robots-meta', 'error', 'Robots meta', 'A noindex directive is present in the robots meta tag.', robotsMeta, ['Remove the noindex directive if this page should be indexable.']);
  else add('Canonicals & robots', 'robots-meta', 'pass', 'Robots meta', 'Robots meta exists and does not contain noindex.', robotsMeta);

  if (!d.canonical) add('Canonicals & robots', 'canonical', 'warning', 'Canonical tag', 'No canonical tag was found on the page.', '', ['Add a self-referencing canonical when the URL should rank on its own.']);
  else if (d.canonicalCrossDomain) add('Canonicals & robots', 'canonical', 'warning', 'Canonical tag', 'The canonical points to a different hostname.', d.canonical, ['Confirm this cross-domain canonical is intentional and not consolidating the page away accidentally.']);
  else add('Canonicals & robots', 'canonical', 'pass', 'Canonical tag', 'A canonical tag was found on the same hostname.', d.canonical);

  const h1Count = Number(d.h1Count || 0);
  if (h1Count === 1) add('Headings & content', 'h1-count', 'pass', 'H1 usage', 'Exactly one H1 was found.', `${h1Count}`, [], d.h1Texts?.slice(0, 3) || []);
  else if (h1Count === 0) add('Headings & content', 'h1-count', 'error', 'H1 usage', 'No H1 heading was found.', '0', ['Add one clear H1 that matches the page topic.']);
  else add('Headings & content', 'h1-count', 'warning', 'H1 usage', `${h1Count} H1 headings were found.`, `${h1Count}`, ['Use one primary H1 unless the page has a deliberate component-driven structure.'], d.h1Texts?.slice(0, 4) || []);

  const headingCounts = d.headingCounts || {};
  const headingSummary = ['H1','H2','H3','H4','H5','H6'].map(level => `${level}: ${headingCounts[level] || 0}`).join(', ');
  add(
    'Headings & content',
    'heading-structure',
    Number(d.headingSkips || 0) > 0 ? 'warning' : 'pass',
    'Heading structure',
    Number(d.headingSkips || 0) > 0 ? 'Heading levels appear to skip in one or more places.' : 'Heading levels are sequential based on the visible outline.',
    headingSummary,
    Number(d.headingSkips || 0) > 0 ? ['Keep heading levels nested logically so screen readers and crawlers see a clean outline.'] : [],
    Array.isArray(d.headingSequence) ? d.headingSequence.slice(0, 8) : []
  );

  if (Number(d.wordCount || 0) < 150) add('Headings & content', 'word-count', Number(d.wordCount || 0) < 60 ? 'error' : 'warning', 'Content depth', `Approximate body copy count is ${Number(d.wordCount || 0).toLocaleString()} words.`, `${Number(d.wordCount || 0).toLocaleString()} words`, ['Thin pages often need more unique supporting copy unless the page purpose is intentionally minimal.']);
  else add('Headings & content', 'word-count', 'pass', 'Content depth', `Approximate body copy count is ${Number(d.wordCount || 0).toLocaleString()} words.`, `${Number(d.wordCount || 0).toLocaleString()} words`);

  const altMissing = Number(d.imgMissingAlt || 0);
  const imgCount = Number(d.imgCount || 0);
  if (!imgCount) add('Images', 'image-count', 'info', 'Images', 'No images were detected on the page.', '0 images');
  else {
    const missingRatio = imgCount ? altMissing / imgCount : 0;
    const status = altMissing === 0 ? 'pass' : missingRatio > 0.2 ? 'error' : 'warning';
    add('Images', 'alt-text', status, 'Image alt coverage', `${altMissing} of ${imgCount} images are missing alt text.`, `${imgCount - altMissing}/${imgCount} with alt`, altMissing ? ['Add concise descriptive alt text for informative images and empty alt text for decorative images.'] : []);
  }

  add('Links', 'link-balance', Number(d.internalLinks || 0) > 0 ? 'pass' : 'warning', 'Internal links', `Found ${Number(d.internalLinks || 0).toLocaleString()} internal links and ${Number(d.externalLinks || 0).toLocaleString()} external links.`, `${Number(d.internalLinks || 0)} internal / ${Number(d.externalLinks || 0)} external`, Number(d.internalLinks || 0) > 0 ? [] : ['Add relevant internal links so crawlers and users can move through related content.']);
  add('Links', 'nofollow-links', 'info', 'Nofollow links', `Found ${Number(d.nofollowLinks || 0).toLocaleString()} nofollow links on the page.`, `${Number(d.nofollowLinks || 0)}`);
  if (Number(d.weakAnchorCount || 0) > 0 || Number(d.emptyAnchorCount || 0) > 0) {
    add('Links', 'anchor-quality', 'warning', 'Anchor text quality', 'Some anchors are empty or use generic text.', `${Number(d.weakAnchorCount || 0)} generic / ${Number(d.emptyAnchorCount || 0)} empty`, ['Replace weak anchors like "click here" or empty links with descriptive anchor text.'], (d.weakAnchorSamples || []).slice(0, 4));
  } else {
    add('Links', 'anchor-quality', 'pass', 'Anchor text quality', 'No empty or weak anchor text samples were detected.', 'Looks healthy');
  }

  add('Structured data & social meta', 'structured-data', (d.ldTypes || []).length ? 'pass' : 'info', 'Structured data', (d.ldTypes || []).length ? 'Structured data types were detected in JSON-LD.' : 'No JSON-LD structured data types were detected.', (d.ldTypes || []).join(', ') || 'None');
  add('Structured data & social meta', 'open-graph', d.openGraph?.title && d.openGraph?.description && d.openGraph?.image ? 'pass' : 'warning', 'Open Graph', d.openGraph?.title && d.openGraph?.description && d.openGraph?.image ? 'Core Open Graph tags are present.' : 'Open Graph coverage is incomplete.', [d.openGraph?.type || '', d.openGraph?.title || '', d.openGraph?.image || ''].filter(Boolean).join(' | '), d.openGraph?.title && d.openGraph?.description && d.openGraph?.image ? [] : ['Add og:title, og:description, and og:image so link previews stay consistent.']);
  add('Structured data & social meta', 'twitter-card', d.twitterCard?.card ? 'pass' : 'warning', 'Twitter card', d.twitterCard?.card ? 'A Twitter card declaration was found.' : 'No Twitter card declaration was found.', d.twitterCard?.card || 'None', d.twitterCard?.card ? [] : ['Add twitter:card and supporting tags if social previews on X/Twitter matter for this page.']);

  add('Mobile & compliance', 'viewport', d.viewport ? 'pass' : 'error', 'Viewport meta', d.viewport ? 'Viewport meta tag is present.' : 'Viewport meta tag is missing.', d.viewport || 'Missing', d.viewport ? [] : ['Add a responsive viewport meta tag so mobile browsers render the page correctly.']);
  add('Mobile & compliance', 'language', d.language ? 'pass' : 'warning', 'Language declaration', d.language ? 'The html lang attribute is present.' : 'No html lang attribute was found.', d.language || 'Missing', d.language ? [] : ['Add a lang attribute on the html element to help search engines and assistive tech.']);
  add('Mobile & compliance', 'charset', d.charset ? 'pass' : 'warning', 'Charset', d.charset ? 'A character encoding declaration was found.' : 'No character encoding declaration was found.', d.charset || 'Missing', d.charset ? [] : ['Declare a charset such as UTF-8 to avoid rendering ambiguity.']);
  add('Mobile & compliance', 'doctype', d.doctype && /html/i.test(d.doctype) ? 'pass' : 'warning', 'Doctype', d.doctype ? 'A doctype declaration is present.' : 'No doctype declaration was found.', d.doctype || 'Missing');
  add('Mobile & compliance', 'iframes', Number(d.iframeCount || 0) > 3 ? 'warning' : 'info', 'Iframes', `Found ${Number(d.iframeCount || 0).toLocaleString()} iframe${Number(d.iframeCount || 0) === 1 ? '' : 's'} on the page.`, `${Number(d.iframeCount || 0)}`, Number(d.iframeCount || 0) > 3 ? ['Review iframes carefully because heavy embed usage can affect rendering, crawl clarity, and performance.'] : []);

  return checks;
}
function renderOnPage(d){
  const checks = buildOnPageChecks(d);
  const totals = summarizeAuditChecks(checks);
  const groups = checks.reduce((acc, check) => {
    if (!acc[check.section]) acc[check.section] = [];
    acc[check.section].push(check);
    return acc;
  }, {});
  let hostLabel = 'Active page';
  try{ hostLabel = new URL(d.url || 'https://example.com').hostname.replace(/^www\./,'') || 'Active page'; }catch{}

  const host = $('onPageResult');
  if (!host) return;
  const fragment = document.createDocumentFragment();
  const summary = uiNode('div', 'card summary-card');
  const summaryHead = uiNode('div', 'summary-card__header');
  const summaryCopy = uiNode('div');
  summaryCopy.append(uiNode('h4', '', 'On-page audit'), uiNode('p', '', 'Active page.'));
  summaryHead.append(summaryCopy, uiNode('span', 'badge', hostLabel));
  const strip = uiNode('div', 'metric-strip');
  [['Pass', totals.pass], ['Warning', totals.warning], ['Error', totals.error], ['Info', totals.info]].forEach(([label, value]) => {
    const tile = uiNode('div', 'metric-tile');
    tile.append(uiNode('span', '', label), uiNode('strong', '', Number(value || 0).toLocaleString()));
    strip.append(tile);
  });
  summary.append(summaryHead, strip);
  fragment.append(summary);

  Object.entries(groups).forEach(([section, items]) => {
    const group = uiNode('div', 'card audit-group');
    const head = uiNode('div', 'summary-card__header');
    const copy = uiNode('div');
    copy.append(uiNode('h4', '', section), uiNode('p', '', `${items.length} check${items.length === 1 ? '' : 's'}.`));
    head.append(copy, uiNode('span', 'badge', items.length));
    const body = uiNode('div', 'audit-group__body');
    items.forEach(check => body.append(createAuditCheckNode(check)));
    group.append(head, body);
    fragment.append(group);
  });

  host.replaceChildren(fragment);
  animateIn(host);
}


function formatStructuredDate(value){
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return escapeHtml(date.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }));
}
function safeStructuredUrl(url){
  if (!url) return '';
  try{
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  }catch{
    return '';
  }
}
function extractStringList(value, limit=4){
  const list = [];
  const push = (item)=>{
    if (item == null) return;
    if (typeof item === 'string'){
      const trimmed = item.trim();
      if (trimmed) list.push(trimmed);
      return;
    }
    if (Array.isArray(item)) return item.forEach(push);
    if (typeof item === 'object'){
      if (typeof item.name === 'string' && item.name.trim()) list.push(item.name.trim());
      else if (typeof item['@id'] === 'string' && item['@id'].trim()) list.push(item['@id'].trim());
    }
  };
  push(value);
  return Array.from(new Set(list)).slice(0, limit);
}
function pickStructuredTitle(item){
  return item?.name || item?.headline || (item?.questionCount ? `${item.questionCount} questions` : '') || item?.path || item?.typeLabel || 'Structured data item';
}
function formatMaybeLink(value){
  const safe = safeStructuredUrl(value);
  if (!safe) return escapeHtml(value || '—');
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener">${escapeHtml(safe)}</a>`;
}
function structuredField(label, value, { trustedHtml=false } = {}){
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
  const isLinkList = Array.isArray(value) && value.some(v => safeStructuredUrl(v));
  const rendered = Array.isArray(value)
    ? value.map(v => {
        const safe = safeStructuredUrl(v);
        return `<span class="chip">${safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener">${escapeHtml(v)}</a>` : escapeHtml(String(v))}</span>`;
      }).join(' ')
    : (trustedHtml ? String(value) : escapeHtml(String(value)));
  return `<div class="sd-detail${isLinkList ? ' sd-detail--links' : ''}"><span>${escapeHtml(label)}</span><strong>${rendered}</strong></div>`;
}
function renderStructuredPreview(item){
  const types = item.types || [];
  const typeSet = new Set(types.map(v => String(v || '').toLowerCase()));
  const imageUrl = safeStructuredUrl(item.image);
  if (typeSet.has('product')){
    const price = item.price ? `${escapeHtml(item.price)}${item.priceCurrency ? ` ${escapeHtml(item.priceCurrency)}` : ''}` : '';
    return `
      <div class="sd-preview sd-preview--product">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" class="sd-preview__image" />` : `<div class="sd-preview__image sd-preview__image--placeholder">Product</div>`}
        <div class="sd-preview__body">
          <div class="sd-preview__eyebrow">Product</div>
          <h5>${escapeHtml(item.name || 'Untitled product')}</h5>
          ${item.brand ? `<p>${escapeHtml(item.brand)}</p>` : ''}
          <div class="sd-preview__meta">
            ${price ? `<span class="chip chip--accent">${price}</span>` : ''}
            ${item.availability ? `<span class="chip">${escapeHtml(item.availability)}</span>` : ''}
            ${item.ratingValue ? `<span class="chip">★ ${escapeHtml(item.ratingValue)}${item.reviewCount ? ` (${escapeHtml(String(item.reviewCount))})` : ''}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }
  if (typeSet.has('article') || typeSet.has('blogposting') || typeSet.has('newsarticle')){
    return `
      <div class="sd-preview sd-preview--article">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" class="sd-preview__image" />` : `<div class="sd-preview__image sd-preview__image--placeholder">Article</div>`}
        <div class="sd-preview__body">
          <div class="sd-preview__eyebrow">Article</div>
          <h5>${escapeHtml(item.headline || item.name || 'Untitled article')}</h5>
          <div class="sd-preview__meta">
            ${item.author ? `<span class="chip">${escapeHtml(item.author)}</span>` : ''}
            ${item.datePublished ? `<span class="chip">${formatStructuredDate(item.datePublished)}</span>` : ''}
          </div>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
        </div>
      </div>
    `;
  }
  if (typeSet.has('faqpage')){
    const questions = (item.questions || []).slice(0, 4);
    return `
      <div class="sd-preview sd-preview--list">
        <div class="sd-preview__eyebrow">FAQ</div>
        <h5>${escapeHtml(item.name || 'FAQPage')}</h5>
        <ul class="sd-list">
          ${questions.length ? questions.map(q => `<li>${escapeHtml(q)}</li>`).join('') : '<li>Questions detected, but no readable labels were extracted.</li>'}
        </ul>
      </div>
    `;
  }
  if (typeSet.has('breadcrumblist')){
    return `
      <div class="sd-preview sd-preview--list">
        <div class="sd-preview__eyebrow">Breadcrumbs</div>
        <h5>${escapeHtml(item.name || 'Breadcrumb trail')}</h5>
        <p>${escapeHtml(item.path || 'Breadcrumb items detected')}</p>
      </div>
    `;
  }
  if (typeSet.has('organization') || typeSet.has('localbusiness') || typeSet.has('person')){
    const hostname = (()=>{ try { return item.url ? new URL(item.url).hostname.replace(/^www\./,'') : ''; } catch { return ''; } })();
    return `
      <div class="sd-preview sd-preview--person">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" class="sd-preview__avatar" />` : `<div class="sd-preview__avatar sd-preview__avatar--placeholder">${escapeHtml((item.name || 'S').slice(0,1).toUpperCase())}</div>`}
        <div class="sd-preview__body">
          <div class="sd-preview__eyebrow">${escapeHtml(item.typeLabel || 'Entity')}</div>
          <h5>${escapeHtml(item.name || 'Untitled entity')}</h5>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
          <div class="sd-preview__meta">
            ${hostname ? `<span class="chip">${escapeHtml(hostname)}</span>` : ''}
            ${item.telephone ? `<span class="chip">${escapeHtml(item.telephone)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }
  if (typeSet.has('event')){
    return `
      <div class="sd-preview sd-preview--list">
        <div class="sd-preview__eyebrow">Event</div>
        <h5>${escapeHtml(item.name || 'Untitled event')}</h5>
        <div class="sd-preview__meta">
          ${item.startDate ? `<span class="chip">${formatStructuredDate(item.startDate)}</span>` : ''}
          ${item.location ? `<span class="chip">${escapeHtml(item.location)}</span>` : ''}
        </div>
      </div>
    `;
  }
  if (typeSet.has('videoobject')){
    return `
      <div class="sd-preview sd-preview--article">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" class="sd-preview__image" />` : `<div class="sd-preview__image sd-preview__image--placeholder">Video</div>`}
        <div class="sd-preview__body">
          <div class="sd-preview__eyebrow">Video</div>
          <h5>${escapeHtml(item.name || 'Untitled video')}</h5>
          <div class="sd-preview__meta">
            ${item.uploadDate ? `<span class="chip">${formatStructuredDate(item.uploadDate)}</span>` : ''}
            ${item.duration ? `<span class="chip">${escapeHtml(item.duration)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div class="sd-preview sd-preview--generic">
      <div class="sd-preview__eyebrow">${escapeHtml(item.typeLabel || 'Structured data')}</div>
      <h5>${escapeHtml(pickStructuredTitle(item))}</h5>
      ${item.description ? `<p>${escapeHtml(item.description)}</p>` : '<p>Parsed from markup.</p>'}
    </div>
  `;
}
function renderStructuredItemCard(item){
  const fieldRows = [
    structuredField('Name', item.name || ''),
    structuredField('Headline', item.headline || ''),
    structuredField('Description', item.description || ''),
    structuredField('URL', item.url ? formatMaybeLink(item.url) : '', { trustedHtml:true }),
    structuredField('Author', item.author || ''),
    structuredField('Brand', item.brand || ''),
    structuredField('Price', item.price ? `${item.price}${item.priceCurrency ? ` ${item.priceCurrency}` : ''}` : ''),
    structuredField('Availability', item.availability || ''),
    structuredField('Rating', item.ratingValue ? `${item.ratingValue}${item.reviewCount ? ` (${item.reviewCount} reviews)` : ''}` : ''),
    structuredField('Date published', item.datePublished ? formatStructuredDate(item.datePublished) : '', { trustedHtml:true }),
    structuredField('Start date', item.startDate ? formatStructuredDate(item.startDate) : '', { trustedHtml:true }),
    structuredField('Location', item.location || ''),
    structuredField('Breadcrumb path', item.path || ''),
    structuredField('Questions', (item.questions || []).length ? item.questions.map(v => String(v)) : []),
    structuredField('SameAs', (item.sameAs || []).slice(0, 4).map(v => safeStructuredUrl(v) || v)),
  ].filter(Boolean).join('');
  return `
    <article class="card sd-card">
      <div class="sd-card__head">
        <div>
          <div class="sd-badges">
            <span class="badge">${escapeHtml(item.sourceLabel || item.source || 'Structured data')}</span>
            ${(item.types || []).slice(0, 4).map(type => `<span class="badge badge--type">${escapeHtml(type)}</span>`).join('')}
          </div>
          <h4>${escapeHtml(pickStructuredTitle(item))}</h4>
          <p>${escapeHtml(item.summary || 'Parsed from markup.')}</p>
        </div>
        <span class="badge">${escapeHtml(item.typeLabel || 'Item')}</span>
      </div>
      ${renderStructuredPreview(item)}
      ${fieldRows ? `<div class="sd-detail-grid">${fieldRows}</div>` : ''}
    </article>
  `;
}
function renderStructuredData(data){
  const items = Array.isArray(data?.items) ? data.items : [];
  const counts = data?.counts || {};
  let hostLabel = 'Active page';
  try{ hostLabel = new URL(data?.url || 'https://example.com').hostname.replace(/^www\./,'') || 'Active page'; }catch{}
  const cards = [`
    <div class="card summary-card">
      <div class="summary-card__header">
        <div>
          <h4>Summary</h4>
          <p>Active page.</p>
        </div>
        <span class="badge">${escapeHtml(hostLabel)}</span>
      </div>
      <div class="metric-strip">
        <div class="metric-tile"><span>Total items</span><strong>${items.length.toLocaleString()}</strong></div>
        <div class="metric-tile"><span>JSON-LD</span><strong>${Number(counts.jsonld || 0).toLocaleString()}</strong></div>
        <div class="metric-tile"><span>Microdata</span><strong>${Number(counts.microdata || 0).toLocaleString()}</strong></div>
        <div class="metric-tile"><span>RDFa</span><strong>${Number(counts.rdfa || 0).toLocaleString()}</strong></div>
      </div>
      <div class="sd-actions">
        <button id="openSchemaValidatorResult" class="btn-top">Schema Validator</button>
        <button id="openRichResultsResult" class="btn-top">Rich Results</button>
      </div>
      ${data?.errors?.length ? `<div class="sd-warning">Some items could not be parsed cleanly (${data.errors.length} issue${data.errors.length === 1 ? '' : 's'}).</div>` : ''}
    </div>
  `];
  if (!items.length){
    cards.push(`
      <div class="card">
        <h4>No structured data</h4>
        <p>No JSON-LD, Microdata, or RDFa found.</p>
      </div>
    `);
  } else {
    cards.push(...items.map(renderStructuredItemCard));
  }
  renderHtml('structuredDataResult', cards.join(''));
  on('openSchemaValidatorResult', 'click', ()=>openSchemaValidator(data?.url || ''));
  on('openRichResultsResult', 'click', ()=>openRichResultsTest(data?.url || ''));
}
function openSchemaValidator(url){
  const safe = normalizeUrl(url || '');
  if (!safe) return clearResult('Open a public page.', 'structuredDataResult');
  chrome.tabs.create({ url: `https://validator.schema.org/#url=${encodeURIComponent(safe)}` });
}
function openRichResultsTest(url){
  const safe = normalizeUrl(url || '');
  if (!safe) return clearResult('Open a public page.', 'structuredDataResult');
  chrome.tabs.create({ url: `https://search.google.com/test/rich-results?url=${encodeURIComponent(safe)}` });
}
function extractStructuredDataFromPage(){
  const MAX_ITEMS = 60;
  const result = {
    url: location.href,
    title: document.title || '',
    items: [],
    errors: [],
    counts: { jsonld: 0, microdata: 0, rdfa: 0 }
  };
  const seen = new Set();
  const toText = (value) => {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      const out = value.map(toText).filter(Boolean);
      return out[0] || '';
    }
    if (typeof value === 'object') {
      return String(
        value.name ||
        value.headline ||
        value.text ||
        value.description ||
        value.url ||
        value['@id'] ||
        ''
      ).trim();
    }
    return '';
  };
  const uniqueList = (values, limit=6) => {
    const out = [];
    const add = (value) => {
      if (value == null) return;
      if (Array.isArray(value)) return value.forEach(add);
      const text = toText(value);
      if (!text || out.includes(text)) return;
      out.push(text);
    };
    add(values);
    return out.slice(0, limit);
  };
  const cleanType = (value) => String(value || '').split('/').filter(Boolean).pop() || 'Thing';
  const cleanAvailability = (value) => String(value || '').split('/').filter(Boolean).pop() || String(value || '');
  const getImage = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return getImage(value[0]);
    if (typeof value === 'object') {
      return String(value.url || value.contentUrl || value.thumbnailUrl || '').trim();
    }
    return '';
  };
  const getOffer = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) return getOffer(value[0]);
    if (typeof value !== 'object') return null;
    return value;
  };
  const getAddress = (value) => {
    if (!value || typeof value !== 'object') return '';
    return [value.streetAddress, value.addressLocality, value.addressRegion, value.postalCode, value.addressCountry]
      .map(toText)
      .filter(Boolean)
      .join(', ');
  };
  const pushItem = (source, raw, summary) => {
    if (!raw || typeof raw !== 'object') return;
    const types = uniqueList(raw['@type'] || raw.type || summary.types || [], 6).map(cleanType);
    const key = JSON.stringify([source, raw['@id'] || summary.url || summary.name || summary.headline || '', types.join('|')]);
    if (seen.has(key) || result.items.length >= MAX_ITEMS) return;
    seen.add(key);
    const typeLabel = types.join(' · ') || 'Thing';
    result.items.push({
      source,
      sourceLabel: source === 'jsonld' ? 'JSON-LD' : source === 'microdata' ? 'Microdata' : 'RDFa',
      typeLabel,
      types,
      ...summary
    });
    result.counts[source] = Number(result.counts[source] || 0) + 1;
  };
  const summarizeNode = (node) => {
    if (!node || typeof node !== 'object') return null;
    const offer = getOffer(node.offers);
    const aggregateRating = node.aggregateRating && typeof node.aggregateRating === 'object' ? node.aggregateRating : null;
    const questions = Array.isArray(node.mainEntity)
      ? node.mainEntity.map(entity => toText(entity?.name || entity?.headline)).filter(Boolean)
      : [];
    const breadcrumbItems = Array.isArray(node.itemListElement)
      ? node.itemListElement.map(item => toText(item?.name || item?.item?.name || item?.item)).filter(Boolean)
      : [];
    return {
      name: toText(node.name),
      headline: toText(node.headline),
      description: toText(node.description),
      image: getImage(node.image || node.logo || node.thumbnailUrl),
      url: toText(node.url || node.mainEntityOfPage || node.sameAs),
      sameAs: uniqueList(node.sameAs || [], 4),
      author: toText(node.author),
      brand: toText(node.brand || node.manufacturer),
      price: toText(offer?.price),
      priceCurrency: toText(offer?.priceCurrency),
      availability: cleanAvailability(offer?.availability),
      ratingValue: toText(aggregateRating?.ratingValue || node.ratingValue),
      reviewCount: toText(aggregateRating?.reviewCount || aggregateRating?.ratingCount || node.reviewCount),
      datePublished: toText(node.datePublished),
      startDate: toText(node.startDate),
      endDate: toText(node.endDate),
      location: toText(node.location?.name || getAddress(node.location?.address) || node.location),
      telephone: toText(node.telephone),
      duration: toText(node.duration),
      uploadDate: toText(node.uploadDate),
      path: breadcrumbItems.join(' › '),
      questions,
      questionCount: questions.length,
      summary: toText(node.description) || toText(node.headline) || toText(node.name) || '',
    };
  };
  const walkJsonLd = (value) => {
    if (!value || result.items.length >= MAX_ITEMS) return;
    if (Array.isArray(value)) return value.forEach(walkJsonLd);
    if (typeof value !== 'object') return;
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(walkJsonLd);
    if (value['@type'] || value['@id'] || value.name || value.headline) {
      pushItem('jsonld', value, summarizeNode(value) || {});
    }
  };
  const tryParseJsonLd = (text) => {
    try{
      return JSON.parse(text);
    }catch(err){
      try{
        const sanitized = text
          .replace(/^\s*<!--/, '')
          .replace(/-->\s*$/, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        return JSON.parse(sanitized);
      }catch(secondErr){
        result.errors.push(String(secondErr?.message || err?.message || 'Invalid JSON-LD'));
        return null;
      }
    }
  };

  Array.from(document.querySelectorAll('script[type="application/ld+json"]')).forEach(script => {
    const parsed = tryParseJsonLd(script.textContent || '');
    if (parsed) walkJsonLd(parsed);
  });

  const isNestedMicrodata = (el) => {
    let parent = el.parentElement;
    while (parent) {
      if (parent.hasAttribute('itemscope')) return true;
      parent = parent.parentElement;
    }
    return false;
  };
  const readMicrodataValue = (el) => {
    if (!el) return '';
    const tag = el.tagName.toLowerCase();
    if (el.hasAttribute('content')) return el.getAttribute('content') || '';
    if ((tag === 'a' || tag === 'link') && el.hasAttribute('href')) return el.href || el.getAttribute('href') || '';
    if ((tag === 'img' || tag === 'source') && el.hasAttribute('src')) return el.currentSrc || el.src || el.getAttribute('src') || '';
    if ((tag === 'audio' || tag === 'video') && el.hasAttribute('src')) return el.currentSrc || el.src || el.getAttribute('src') || '';
    if (tag === 'time' && el.hasAttribute('datetime')) return el.getAttribute('datetime') || '';
    return (el.textContent || '').trim();
  };
  Array.from(document.querySelectorAll('[itemscope]')).filter(el => !isNestedMicrodata(el)).forEach(root => {
    const props = {};
    const types = (root.getAttribute('itemtype') || '')
      .split(/\s+/)
      .map(cleanType)
      .filter(Boolean);
    Array.from(root.querySelectorAll('[itemprop]')).forEach(el => {
      const nestedOwner = el.closest('[itemscope]');
      if (nestedOwner && nestedOwner !== root) return;
      const key = (el.getAttribute('itemprop') || '').trim();
      if (!key) return;
      const value = readMicrodataValue(el);
      if (!value) return;
      if (!props[key]) props[key] = [];
      props[key].push(value);
    });
    pushItem('microdata', {
      '@type': types,
      name: props.name?.[0],
      description: props.description?.[0],
      image: props.image?.[0],
      url: props.url?.[0],
      brand: props.brand?.[0],
      price: props.price?.[0],
      priceCurrency: props.priceCurrency?.[0],
      availability: props.availability?.[0],
      author: props.author?.[0],
      itemListElement: props.item?.map(v => ({ name: v })) || []
    }, {
      name: props.name?.[0] || '',
      headline: props.headline?.[0] || '',
      description: props.description?.[0] || '',
      image: props.image?.[0] || '',
      url: props.url?.[0] || '',
      brand: props.brand?.[0] || '',
      price: props.price?.[0] || '',
      priceCurrency: props.priceCurrency?.[0] || '',
      availability: cleanAvailability(props.availability?.[0]),
      author: props.author?.[0] || '',
      path: (props.name || []).slice(0, 8).join(' › '),
      summary: props.description?.[0] || props.name?.[0] || ''
    });
  });

  const isNestedRdfa = (el) => {
    let parent = el.parentElement;
    while (parent) {
      if (parent.hasAttribute('typeof')) return true;
      parent = parent.parentElement;
    }
    return false;
  };
  const readRdfaValue = (el) => {
    if (!el) return '';
    return el.getAttribute('content')
      || el.getAttribute('resource')
      || el.getAttribute('href')
      || el.getAttribute('src')
      || el.getAttribute('datetime')
      || (el.textContent || '').trim();
  };
  Array.from(document.querySelectorAll('[typeof]')).filter(el => !isNestedRdfa(el)).forEach(root => {
    const props = {};
    const types = (root.getAttribute('typeof') || '')
      .split(/\s+/)
      .map(cleanType)
      .filter(Boolean);
    Array.from(root.querySelectorAll('[property]')).forEach(el => {
      const nestedOwner = el.closest('[typeof]');
      if (nestedOwner && nestedOwner !== root) return;
      const key = (el.getAttribute('property') || '').trim();
      if (!key) return;
      const value = readRdfaValue(el);
      if (!value) return;
      if (!props[key]) props[key] = [];
      props[key].push(value);
    });
    pushItem('rdfa', {
      '@type': types,
      name: props.name?.[0] || props.headline?.[0],
      description: props.description?.[0],
      image: props.image?.[0] || props.logo?.[0],
      url: props.url?.[0]
    }, {
      name: props.name?.[0] || '',
      headline: props.headline?.[0] || '',
      description: props.description?.[0] || '',
      image: props.image?.[0] || props.logo?.[0] || '',
      url: props.url?.[0] || '',
      author: props.author?.[0] || '',
      summary: props.description?.[0] || props.name?.[0] || ''
    });
  });

  return result;
}

/* ---------- deep links ---------- */
function openGSCInspect(siteUrl, url){
  const encoded = encodeURIComponent(url);
  const base = 'https://search.google.com/search-console/inspect';
  const qs = `?resource_id=${encodeURIComponent(siteUrl)}&url=${encoded}`;
  chrome.tabs.create({ url: base + qs });
}

/* ---------- messaging ---------- */
async function send(msg){ return await chrome.runtime.sendMessage(msg); }

/* ---------- Dates ---------- */
function toISO(daysAgo){ const d = new Date(Date.now() - daysAgo*86400000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayISO(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

/* ---------- Account label ---------- */
const GOOGLE_SWITCH_TIP_KEY = 'googleSwitchAccountTipDismissed';
// safe JWT payload decoder (no deprecated escape())
function parseIdToken(idToken){
  try{
    const base64Url = idToken.split('.')[1];            // JWT payload
    const base64 = base64Url.replace(/-/g,'+').replace(/_/g,'/'); // base64url -> base64
    const bin = atob(base64);                           // binary string
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);       // UTF-8 decode
    return JSON.parse(json);
  }catch{
    return null;
  }
}

async function setAccountLabel(accountOverride=null){
  try{
    const r = accountOverride?.account || accountOverride?.provider
      ? accountOverride
      : await send({ type:'getAccount' });
    const idToken = r?.data || null;
    const payload = idToken ? parseIdToken(idToken) : null;
    const account = r?.account || null;
    const email = account?.email || payload?.email || '';
    const provider = account?.provider || r?.provider || (email ? 'chrome' : '');
    const webAvailable = !!r?.webAvailable;
    const label = $('accountLabel'); if (label) label.textContent = email ? email : '';
    const mini = $('accountMini'); if (mini) mini.textContent = email ? email : '—';
    const settingsEmail = $('settingsAccountEmail'); if (settingsEmail) settingsEmail.textContent = email || 'Not connected';
    const settingsHint = $('settingsAccountHint');
    if (settingsHint) settingsHint.textContent = email
      ? (provider === 'web' ? 'Search Console and GA4 use this alternate Google account.' : 'Search Console and GA4 use your Chrome profile account.')
      : 'Connect your Chrome profile account to continue.';
    const authMode = $('googleAuthMode');
    if (authMode){
      authMode.textContent = provider === 'web' ? 'Alternate account' : 'Chrome account';
      authMode.classList.toggle('hidden', !email);
    }
    setServiceActive('googleActiveStatus', !!email);
    $('settingsGoogleCard')?.classList.toggle('is-connected', !!email);
    const connectButton = $('connectGoogle');
    if (connectButton){ connectButton.hidden = !!email; connectButton.textContent = 'Connect Chrome account'; }
    const switchButton = $('switchGoogle');
    if (switchButton){
      switchButton.hidden = !email || !webAvailable;
      switchButton.textContent = provider === 'web' ? 'Choose another account' : 'Use another account';
    }
    const chromeButton = $('useChromeGoogle');
    if (chromeButton) chromeButton.hidden = !email || provider !== 'web';
    const logoutButton = $('logoutSettings'); if (logoutButton) logoutButton.hidden = !email;
    await updateGoogleSwitchTip({ email, provider, webAvailable });
    return email;
  }catch(e){
    setServiceActive('googleActiveStatus', false);
    $('settingsGoogleCard')?.classList.remove('is-connected');
    const connectButton = $('connectGoogle'); if (connectButton) connectButton.hidden = false;
    const switchButton = $('switchGoogle'); if (switchButton) switchButton.hidden = true;
    const chromeButton = $('useChromeGoogle'); if (chromeButton) chromeButton.hidden = true;
    $('googleAuthMode')?.classList.add('hidden');
    $('googleSwitchTip')?.classList.add('hidden');
    const logoutButton = $('logoutSettings'); if (logoutButton) logoutButton.hidden = true;
    console.warn(e);
    return '';
  }
}
async function updateGoogleSwitchTip({ email='', provider='', webAvailable=false } = {}){
  const tip = $('googleSwitchTip');
  if (!tip) return;
  if (!email || provider !== 'chrome' || !webAvailable){
    tip.classList.add('hidden');
    return;
  }
  const stored = await chrome.storage.local.get(GOOGLE_SWITCH_TIP_KEY).catch(()=>({}));
  tip.classList.toggle('hidden', !!stored?.[GOOGLE_SWITCH_TIP_KEY]);
}

async function resetGoogleUiState({ clearSelections=false } = {}){
  state.ui.sitesCache = null;
  PERF.data = null;
  setSites([]);
  GA.props = null;
  GA.keyEventsByProperty = {};
  GA.keyEventSelections = {};
  GA.keyEventNotices = {};
  GA.keyEventCacheByProperty = {};
  GA.propCacheMeta = null;
  GA.reportCacheMeta = null;
  GA.generalNotice = '';
  if (clearSelections) await chrome.storage.local.remove(GA_STORAGE_KEYS.selections);
  if ($('gaProps')) $('gaProps').innerHTML = '<option value="">Select GA4 property</option>';
  gaRenderKeyEventState();
  gaRenderReportCacheNote();
  setCacheNote('sitesCacheStatus', null);
  setCacheNote('perfCacheStatus', null);
}

// The action popup is destroyed the moment the Google account chooser takes
// focus, so the sendResponse for a sign-in never arrives here. The background
// records the outcome instead; drain it whenever this surface (re)opens.
async function consumeGoogleAuthEvent({ announce = true } = {}){
  let event = null;
  try{
    const response = await send({ type:'consumeAuthEvent' });
    event = response?.ok ? response.data : null;
  }catch(_){ return; }
  if (!event || !announce) return;
  // Anything older than a few minutes is stale; do not surprise the user with it.
  if (Date.now() - Number(event.at || 0) > 5 * 60 * 1000) return;
  if (event.ok){
    if (event.email) clearResult(`Switched to ${event.email}.`);
  }else if (event.error && !/cancelled/i.test(event.error)){
    clearResult('❌ ' + event.error);
  }
}

async function runGoogleAccountChoice(messageType, buttonId){
  const button = $(buttonId);
  if (!button) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = messageType === 'switchGoogleAccount'
    ? 'Opening account chooser…'
    : messageType === 'useChromeGoogleAccount' ? 'Using Chrome account…' : 'Connecting Chrome account…';
  try{
    const response = await send({ type:messageType });
    // This surface survived the flow, so it reports the outcome itself.
    await consumeGoogleAuthEvent({ announce:false });
    if (!response.ok) throw apiErrorFromResponse(response, 'Google sign-in failed.');
    await resetGoogleUiState({ clearSelections:true });
    await setAccountLabel(response);
    await renderAccountSwitcher();
    await loadSites({ forceRefresh:true });
    await loadGaPropsOnce({ forceRefresh:true }).catch(()=>{});
    clearResult(messageType === 'switchGoogleAccount'
      ? 'Alternate Google account connected.'
      : messageType === 'useChromeGoogleAccount' ? 'Switched back to the Chrome account.' : 'Chrome account connected.');
  }catch(e){
    await consumeGoogleAuthEvent({ announce:false });
    await resetGoogleUiState({ clearSelections:true });
    await setAccountLabel();
    await renderAccountSwitcher();
    clearResult('❌ ' + (e?.message || String(e)));
  }finally{
    button.disabled = false;
    button.textContent = originalText;
  }
}

/* ---------- NAV ---------- */
const navMap = {
  navBlend:     "panelBlend",
  navIndex:     "panelIndex",
  navAnalytics: "panelAnalytics",
  navPerf:      "panelPerf",
  navCallRail:  "panelCallRail",
  navOnPage:    "panelOnPage",
  navStructuredData: "panelStructuredData",
  navSettings:  "panelSettings"
};

function mountNav(){
  const activationMap = {
    navBlend: () => { void blendEnsureSources(); },
    navOnPage: () => runOnPageAudit({ reason:'tab' }),
    navStructuredData: () => runStructuredDataScan({ reason:'tab' })
  };
  const show = (navId)=>{
    Object.values(navMap).forEach(id => { if(id){ const el=$(id); if(el) el.classList.add('hidden'); } });
    const pid = navMap[navId];
    if (pid) {
      const el=$(pid);
      if(el){
        el.classList.remove('hidden');
        animateIn(el);
      }
    }

    // highlight selected
    Object.keys(navMap).forEach(nid => {
      const b = $(nid);
      if (!b) return;
      b.classList.remove('active');
      b.removeAttribute('aria-current');
    });
    const btn = $(navId);
    if (btn){
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
    }
    setPanelContext(navId);
  };
  Object.keys(navMap).forEach(nid => {
    const b=$(nid);
    if(!b) return;
    b.addEventListener('click', ()=>{
      show(nid);
      setSidebarCollapsed(true, shouldPersistSidebarState());
      activationMap[nid]?.();
    });
  });
  // Blended report is the landing panel; its pickers are initialised the same
  // way a click would, so the columns are not empty on first paint.
  show('navBlend');
  activationMap.navBlend?.();
}


/* ==========================================================================
   CALLRAIL
   Two views over one dataset: an Overview (KPIs, daily trend, outcome split,
   sources, movers) and a Calls-by-source list that drills into an individual
   call with its transcript.
   ========================================================================== */
/* ---------- compatibility helpers ----------
   Settings-panel code and the CallRail key flow still call these. They are thin
   adapters over the rebuilt panel rather than a second status system. */
function crSetStatus(msg, isError=false){
  const text = String(msg || '');
  const live = $('crPanelStatus');
  if (live) live.textContent = text;
  const settings = $('crStatus');
  if (settings) settings.textContent = text;
  if (isError && text) renderHtml('crResult', statusCard('❌ ' + text));
}
function crRenderListCacheNote(){
  setCacheNote('crListCacheStatus', CR.listCache, {
    network:'CallRail lists refreshed', cached:'Cached CallRail lists', stale:'Stale CallRail lists'
  });
}
function crRenderReportCacheNote(){
  setCacheNote('crReportCacheStatus', CR.reportCache, {
    network:'CallRail refreshed', cached:'Cached CallRail report', stale:'Stale CallRail report'
  });
}
function crComputeDates(range){
  // Accepts both the rebuilt numeric ranges and the legacy named ones so the
  // stored preference from an earlier version still resolves.
  const today = new Date();
  const iso = d => blendISO(d);
  const shift = days => { const d = new Date(today); d.setDate(today.getDate() - days); return d; };
  switch (String(range)){
    case 'today': return { start: iso(today), end: iso(today) };
    case 'yesterday': return { start: iso(shift(1)), end: iso(shift(1)) };
    case 'last7': return { start: iso(shift(7)), end: iso(shift(1)) };
    case 'last30': return { start: iso(shift(30)), end: iso(shift(1)) };
    case 'recent7': return { start: iso(shift(7)), end: iso(today) };
    case 'thisMonth': return { start: iso(new Date(today.getFullYear(), today.getMonth(), 1)), end: iso(today) };
    case 'lastMonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: iso(first), end: iso(last) };
    }
    default: {
      const days = Number(range) || 28;
      return { start: iso(shift(days - 1)), end: iso(today) };
    }
  }
}

const CR_GROUPS = [
  { key:'source', label:'Source' },
  { key:'campaign', label:'Campaign' },
  { key:'keywords', label:'Keywords' },
  { key:'referrer', label:'Referrer' },
  { key:'landing_page', label:'Landing page' }
];
const CR = {
  inited: false,
  loading: false,
  tab: 'overview',
  data: null,
  compare: true,
  lastRows: [],
  lastMeta: {},
  reportCache: null,
  calls: null,
  callsLoading: false,
  openCallId: '',
  callDetails: {},
  filters: {
    group: 'source',
    sources: null,
    search: '',
    sort: { col:'total_calls', dir:-1 },
    callSort: { col:'start_time', dir:-1 },
    rows: 15
  }
};

function crResolveRange(){
  const mode = $('crRange')?.value || '28';
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (mode === 'custom'){
    const start = $('crStart')?.value || '';
    const finish = $('crEnd')?.value || blendISO(end);
    if (!start) throw new Error('Pick a start date for the custom range.');
    if (start > finish) throw new Error('Start date must be before the end date.');
    return { start, end: finish };
  }
  const days = Number(mode) || 28;
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  return { start: blendISO(start), end: blendISO(end) };
}
function crActiveFilters(){
  const device = $('crDevice')?.value || 'all';
  const lead = $('crLeadStatus')?.value || '';
  const first = $('crFirstTime')?.value || '';
  const min = $('crMinDur')?.value || '';
  const max = $('crMaxDur')?.value || '';
  const active = [
    device !== 'all' ? device : '',
    lead, first ? (first === 'true' ? 'first-time' : 'returning') : '',
    min ? `≥${min}s` : '', max ? `≤${max}s` : ''
  ].filter(Boolean);
  return { device, lead, first, min, max, active };
}
function crRenderFilterCount(){
  const el = $('crFilterCount');
  if (!el) return;
  const { active } = crActiveFilters();
  el.textContent = active.length ? `${active.length} active · ${active.join(', ')}` : 'None active';
}
function crRenderConnection(){
  const host = $('crConnection');
  if (!host) return;
  const accountId = $('crAccount')?.value || '';
  const accountName = accountId ? ($('crAccount')?.selectedOptions?.[0]?.textContent || accountId) : '';
  const companyName = $('crCompany')?.value
    ? ($('crCompany')?.selectedOptions?.[0]?.textContent || '')
    : 'All companies';
  const connected = !!accountId;
  host.innerHTML = `
    <div class="cr-conn ${connected ? 'is-on' : 'is-off'}">
      <span class="cr-conn__dot" aria-hidden="true"></span>
      <span class="cr-conn__text">
        <b>${connected ? 'CallRail connected' : 'CallRail not connected'}</b>
        <span>${connected ? escapeHtml(`${accountName} · ${companyName}`) : 'Add your API key in Settings, then pick an account.'}</span>
      </span>
      ${connected ? '' : '<button class="blend-conn__fix" type="button" data-cr-nav="navSettings">Open Settings</button>'}
    </div>
  `;
}

/* ---------- fetch ---------- */
async function crLoadSummary({ forceRefresh=false } = {}){
  if (CR.loading) return;
  const accountId = $('crAccount')?.value || '';
  crRenderConnection();
  if (!accountId){
    renderHtml('crResult', statusCard('Pick a CallRail account. If the list is empty, add your API key in Settings.'));
    return;
  }
  let range;
  try{ range = crResolveRange(); }
  catch(e){ return renderHtml('crResult', statusCard(e.message)); }

  const compare = !!$('crCompare')?.checked;
  CR.compare = compare;
  const prev = compare ? blendPrevRange(range) : null;
  const companyId = $('crCompany')?.value || '';
  const companyName = $('crCompany')?.selectedOptions?.[0]?.textContent || '';
  const filters = crActiveFilters();
  const group = CR.filters.group;

  await crSetStored({
    callrailAccountNumericId: accountId,
    callrailCompanyId: companyId,
    callrailRange: $('crRange')?.value || '28',
    callrailStart: range.start,
    callrailEnd: range.end,
    callrailGroupBy: group,
    callrailDevice: filters.device,
    callrailLeadStatus: filters.lead,
    callrailFirstTime: filters.first,
    callrailMinDur: filters.min,
    callrailMaxDur: filters.max
  }).catch(()=>{});

  CR.loading = true;
  renderHtml('crResult', statusCard(forceRefresh ? 'Refreshing CallRail…' : 'Loading CallRail…'));
  const base = {
    type:'callrailCallSummary', accountId, companyId, companyName,
    device: filters.device, lead_status: filters.lead,
    first_time_callers: filters.first, min_duration: filters.min, max_duration: filters.max,
    forceRefresh
  };
  const job = payload => payload ? blendSend(payload) : Promise.resolve(null);

  try{
    const [current, previous, trend, prevTrend] = await Promise.all([
      job(Object.assign({}, base, { start_date:range.start, end_date:range.end, group_by:group, groupByLabel:group, include_voicemails:true })),
      job(prev && Object.assign({}, base, { start_date:prev.start, end_date:prev.end, group_by:group, include_voicemails:false })),
      job(Object.assign({}, base, { start_date:range.start, end_date:range.end, group_by:'date', include_voicemails:false })),
      job(prev && Object.assign({}, base, { start_date:prev.start, end_date:prev.end, group_by:'date', include_voicemails:false }))
    ]);

    if (!current?.ok) throw apiErrorFromResponse(current, 'CallRail request failed.');

    const rows = blendCrRows(current);
    const prevRows = blendCrRows(previous);
    const trendRows = blendCrRows(trend).slice().sort((a,b) => String(a.key).localeCompare(String(b.key)));
    const prevTrendRows = blendCrRows(prevTrend).slice().sort((a,b) => String(a.key).localeCompare(String(b.key)));

    CR.data = {
      range, prevRange: prev, compare, group, companyName, accountId, companyId,
      rows, prevRows,
      axis: trendRows.map(row => row.key),
      trend: trendRows.map(row => Number(row.total_calls || 0)),
      prevTrend: prevTrendRows.map(row => Number(row.total_calls || 0)),
      trendAvailable: !!trend?.ok && trendRows.length > 1,
      totals: crSummarizeRows(rows),
      prevTotals: prevRows.length ? crSummarizeRows(prevRows) : null
    };
    CR.lastRows = rows;
    CR.lastMeta = { start: range.start, end: range.end, groupByLabel: group, companyName };
    CR.calls = null;
    CR.openCallId = '';
    renderHtml('crResult', '');
    crRenderAll();
    void crPersist();
    setCacheNote('crReportCacheStatus', { source: forceRefresh ? 'network' : 'mixed', fetchedAt: Date.now() }, {
      network:'CallRail refreshed', mixed:'CallRail updated'
    });
  }catch(e){
    renderApiError('crResult', e, 'crRefreshData');
  }finally{
    CR.loading = false;
  }
}
async function crLoadCalls({ forceRefresh=false } = {}){
  if (!CR.data || CR.callsLoading) return;
  CR.callsLoading = true;
  crRenderSections();
  const filters = crActiveFilters();
  const selected = CR.filters.sources;
  const single = selected && selected.size === 1 ? Array.from(selected)[0] : '';
  const response = await blendSend({
    type:'callrailListCalls',
    accountId: CR.data.accountId,
    companyId: CR.data.companyId,
    start_date: CR.data.range.start,
    end_date: CR.data.range.end,
    source: CR.data.group === 'source' ? single : '',
    device: filters.device,
    lead_status: filters.lead,
    limit: 100,
    forceRefresh
  });
  CR.calls = response?.ok
    ? { rows: response.data?.calls || [], total: Number(response.data?.total || 0), error:'' }
    : { rows: [], total: 0, error: response?.error || 'Could not load calls.' };
  CR.callsLoading = false;
  crRenderSections();
}
async function crToggleCall(callId){
  if (!CR.data) return;
  if (CR.openCallId === callId){
    CR.openCallId = '';
    crRenderSections();
    return;
  }
  CR.openCallId = callId;
  crRenderSections();
  if (CR.callDetails[callId]) return;
  const response = await blendSend({
    type:'callrailCallDetail', accountId: CR.data.accountId, callId
  });
  CR.callDetails[callId] = response?.ok
    ? response.data
    : { error: response?.error || 'Could not load this call.' };
  if (CR.openCallId === callId) crRenderSections();
}

/* ---------- render ---------- */
function crRenderKpis(){
  const model = CR.data;
  const host = $('crKpis');
  if (!model || !host) return;
  const t = model.totals;
  const p = model.prevTotals;
  const compare = CR.compare && p;
  const missedRate = crRate(t.missed_calls, t.total_calls);
  const firstRate = crRate(t.first_time_callers, t.total_calls);
  const sourceCount = CR.filters.sources?.size || model.rows.length;

  host.innerHTML = [
    blendKpiCard({ src:'cr', label:'Total calls', value: formatMetricValue(t.total_calls),
      delta: compare ? metricDelta(t.total_calls, p.total_calls) : null,
      sub: `${escapeHtml(formatMetricValue(sourceCount))} ${escapeHtml(model.group.replace('_',' '))}${sourceCount === 1 ? '' : 's'}` }),
    blendKpiCard({ src:'cr', label:'Missed rate', value: formatMetricValue(missedRate, 'percent', 1),
      delta: compare ? formatPointDelta(missedRate, crRate(p.missed_calls, p.total_calls), { inverse:true }) : null,
      sub: `<b>${escapeHtml(formatMetricValue(t.missed_calls))}</b> unanswered` }),
    blendKpiCard({ src:'cr', label:'First-time rate', value: formatMetricValue(firstRate, 'percent', 1),
      delta: compare ? formatPointDelta(firstRate, crRate(p.first_time_callers, p.total_calls)) : null,
      sub: `<b>${escapeHtml(formatMetricValue(t.first_time_callers))}</b> new callers` }),
    blendKpiCard({ src:'cr', label:'Avg duration', value: t.formatted_average_duration || formatDurationShort(t.average_duration),
      delta: compare ? metricDelta(t.average_duration, p.average_duration) : null,
      sub: `${escapeHtml(model.range.start)} → ${escapeHtml(model.range.end)}` })
  ].join('');
}
function crRenderChart(){
  const model = CR.data;
  const host = $('crChart');
  if (!model || !host) return;
  if (!model.trendAvailable){
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');
  const axis = model.axis;
  const values = model.trend;
  const prevValues = CR.compare ? model.prevTrend : [];
  const W = 700, H = 190, PAD_L = 6, PAD_R = 6, PAD_T = 12, PAD_B = 22;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...values, ...prevValues);
  const x = i => PAD_L + (i * plotW / Math.max(1, values.length - 1));
  const y = v => PAD_T + plotH * (1 - (v / max));
  const line = values.map((v,i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const ghost = prevValues.length > 1
    ? `<path d="${prevValues.map((v,i) => `${i ? 'L' : 'M'}${x(Math.min(i, values.length-1)).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="#f1b84a" stroke-width="1.4" stroke-dasharray="4 4" opacity=".4"></path>`
    : '';
  const grid = [0,0.5,1].map(f => `<line x1="${PAD_L}" y1="${PAD_T + plotH*f}" x2="${W-PAD_R}" y2="${PAD_T + plotH*f}" stroke="rgba(255,255,255,.06)"></line>`).join('');
  const every = Math.max(1, Math.ceil(axis.length / 6));
  const ticks = axis.map((d,i) => (i % every === 0 || i === axis.length-1)
    ? `<text x="${x(i).toFixed(1)}" y="${H-6}" fill="rgba(136,168,150,.6)" font-size="10" text-anchor="middle">${escapeHtml(String(d).slice(5))}</text>` : '').join('');

  host.innerHTML = `
    <div class="blend-chart-head">
      <div>
        <div class="blend-chart-title">Calls per day</div>
        <div class="blend-chart-note">${CR.compare ? 'Dashed line is the previous period. ' : ''}Hover for exact values.</div>
      </div>
    </div>
    <div class="blend-plot" id="crPlot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Calls per day">
        ${grid}${ghost}
        <path d="${line}" fill="none" stroke="#f1b84a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
        ${ticks}
        <line id="crCursor" x1="0" y1="${PAD_T}" x2="0" y2="${PAD_T+plotH}" stroke="rgba(255,255,255,.25)" opacity="0"></line>
        <rect class="blend-plot__hit" x="0" y="0" width="${W}" height="${H}" id="crHit"></rect>
      </svg>
      <div class="blend-tip hidden" id="crTip"></div>
    </div>
  `;
  const plot = $('crPlot'), hit = $('crHit'), tip = $('crTip'), cursor = $('crCursor');
  if (!plot || !hit || !tip) return;
  hit.addEventListener('mousemove', event => {
    const rect = plot.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const step = plotW / Math.max(1, values.length - 1);
    const i = Math.min(values.length-1, Math.max(0, Math.round((ratio*W - PAD_L) / step)));
    tip.innerHTML = `<div class="blend-tip__date">${escapeHtml(String(axis[i]))}</div>
      <div class="blend-tip__row"><span><i style="background:#f1b84a"></i>Calls</span><strong>${escapeHtml(formatMetricValue(values[i]))}</strong></div>`;
    tip.classList.remove('hidden');
    const left = PAD_L + i*step;
    tip.style.left = `${(left / W) * 100}%`;
    tip.style.top = `${rect.height * 0.62}px`;
    if (cursor){ cursor.setAttribute('x1', left); cursor.setAttribute('x2', left); cursor.setAttribute('opacity','1'); }
  });
  hit.addEventListener('mouseleave', () => {
    tip.classList.add('hidden');
    if (cursor) cursor.setAttribute('opacity','0');
  });
}
function crOutcomeSection(model){
  const t = model.totals;
  const answered = Math.max(0, Number(t.answered_calls||0) - Number(t.voicemails||0));
  const parts = [
    { label:'Answered', value: answered, tone:'ok' },
    { label:'Missed', value: Number(t.missed_calls||0), tone:'bad' },
    { label:'Voicemail', value: Number(t.voicemails||0), tone:'warn' }
  ].filter(p => p.value > 0);
  if (!parts.length) return '';
  return blendSectionShell({
    src:'cr', id:'cr-outcome', title:'CallRail · Call outcome',
    subtitle:'How the period split', filters:'',
    body: buildInsightCompositionSection({ type:'composition', title:'', parts })
  });
}
function crSourcesSection(model){
  const filters = `
    <select data-cr-filter="group" title="Group calls by">
      ${CR_GROUPS.map(g => `<option value="${g.key}" ${model.group === g.key ? 'selected' : ''}>${g.label}</option>`).join('')}
    </select>
    <input type="search" data-cr-filter="search" placeholder="Filter rows" value="${escapeHtml(CR.filters.search)}" />
  `;
  const all = model.rows;
  if (!all.length){
    return blendSectionShell({ src:'cr', id:'cr-sources', title:'CallRail · Sources',
      subtitle:'No calls in this range', filters,
      body: blendNoData('No calls in this range', 'Try a longer date range, clear the filters, or check the company selection.') });
  }
  const selected = CR.filters.sources;
  const isOn = key => !selected || !selected.size || selected.has(key);
  const chips = all.slice(0, 14).map(row => `
    <button type="button" class="blend-chip ${isOn(row.key) ? 'is-on' : ''}" data-cr-source="${escapeHtml(row.key)}">
      <span>${escapeHtml(row.key || 'Unattributed')}</span>
      <span class="blend-chip__n">${escapeHtml(formatMetricValue(row.total_calls))}</span>
    </button>`).join('');

  const prevMap = new Map(model.prevRows.map(row => [row.key, row]));
  let rows = all.filter(row => isOn(row.key)).map(row => ({
    key: row.key,
    total_calls: row.total_calls,
    answered_calls: row.answered_calls,
    missed_calls: row.missed_calls,
    first_time_callers: row.first_time_callers,
    missedRate: crRate(row.missed_calls, row.total_calls),
    duration: row.formatted_average_duration || formatDurationShort(row.average_duration),
    prev: prevMap.get(row.key)?.total_calls ?? null
  }));
  const search = CR.filters.search.trim().toLowerCase();
  if (search) rows = rows.filter(row => String(row.key).toLowerCase().includes(search));
  rows = blendSortRows(rows, CR.filters.sort);
  const shown = rows.slice(0, CR.filters.rows);
  if (!shown.length){
    return blendSectionShell({ src:'cr', id:'cr-sources', title:'CallRail · Sources',
      subtitle:'Filtered', filters, body: blendNoData('No rows match', 'Clear the filter or reselect sources.') });
  }
  const max = Math.max(1, ...shown.map(r => r.total_calls));
  const sort = CR.filters.sort;
  const groupLabel = (CR_GROUPS.find(g => g.key === model.group) || { label:'Source' }).label;

  return blendSectionShell({
    src:'cr', id:'cr-sources',
    title:`CallRail · ${groupLabel}`,
    subtitle:`${formatMetricValue(rows.length)} of ${formatMetricValue(all.length)} rows`,
    filters,
    body:`
      <div class="blend-chiprow">${chips}${all.length > 14 ? `<span class="blend-chip" style="cursor:default">+${all.length - 14} more</span>` : ''}</div>
      <div class="blend-table-shell">
        <table class="blend-table">
          <thead><tr>
            ${blendHeadCell(groupLabel, 'key', sort, false)}
            ${blendHeadCell('Calls', 'total_calls', sort)}
            ${blendHeadCell('Answered', 'answered_calls', sort)}
            ${blendHeadCell('Missed %', 'missedRate', sort)}
            ${blendHeadCell('First-time', 'first_time_callers', sort)}
          </tr></thead>
          <tbody>
            <tr class="is-total">
              <td>Selected</td>
              <td class="num">${escapeHtml(formatMetricValue(blendSum(rows,'total_calls')))}</td>
              <td class="num">${escapeHtml(formatMetricValue(blendSum(rows,'answered_calls')))}</td>
              <td class="num">${blendSum(rows,'total_calls') ? ((blendSum(rows,'missed_calls')/blendSum(rows,'total_calls'))*100).toFixed(0) : '0'}%</td>
              <td class="num">${escapeHtml(formatMetricValue(blendSum(rows,'first_time_callers')))}</td>
            </tr>
            ${shown.map(row => `
              <tr>
                <td><span class="blend-name" title="${escapeHtml(row.key)}">${escapeHtml(row.key || 'Unattributed')}</span></td>
                <td class="num">${escapeHtml(formatMetricValue(row.total_calls))}${CR.compare ? blendDeltaTag(row.total_calls, row.prev) : ''}${blendBar(row.total_calls, max, 'cr')}</td>
                <td class="num">${escapeHtml(formatMetricValue(row.answered_calls))}</td>
                <td class="num">${(row.missedRate*100).toFixed(0)}%</td>
                <td class="num">${escapeHtml(formatMetricValue(row.first_time_callers))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${rows.length > shown.length ? `<div class="blend-more">Showing top ${shown.length} of ${formatMetricValue(rows.length)}.</div>` : ''}
      </div>`
  });
}
function crMoversSection(model){
  if (!CR.compare || !model.prevRows.length) return '';
  const movers = computeMovers(model.rows, model.prevRows, {
    keyFn: row => row.key || '',
    valueFn: row => Number(row.total_calls || 0),
    limit: 5,
    suffix: 'calls',
    metaFn: item => item.row ? `missed ${(crRate(item.row.missed_calls, item.row.total_calls)*100).toFixed(0)}%` : ''
  });
  if (!movers.length) return '';
  return blendSectionShell({
    src:'cr', id:'cr-movers', title:'CallRail · Biggest movers',
    subtitle:'Versus the previous period', filters:'',
    body: buildInsightMoversSection({ title:'', rows: movers })
  });
}
function crCallRow(call){
  const open = CR.openCallId === String(call.id);
  const detail = CR.callDetails[String(call.id)];
  const when = call.start_time ? String(call.start_time).replace('T', ' ').slice(0, 16) : '—';
  const who = call.customer_name || call.customer_phone_number || 'Unknown caller';
  const place = [call.customer_city, call.customer_state].filter(Boolean).join(', ');
  return `
    <div class="cr-call ${open ? 'is-open' : ''}">
      <button type="button" class="cr-call__head" data-cr-call="${escapeHtml(String(call.id))}" aria-expanded="${open}">
        <span class="cr-call__who">
          <b>${escapeHtml(who)}</b>
          <span>${escapeHtml(when)}${place ? ` · ${escapeHtml(place)}` : ''}</span>
        </span>
        <span class="cr-call__meta">
          <span class="cr-pill ${call.answered ? 'is-ok' : 'is-bad'}">${call.answered ? 'Answered' : 'Missed'}</span>
          ${call.first_call ? '<span class="cr-pill">First-time</span>' : ''}
          <span class="cr-call__dur">${escapeHtml(call.formatted_duration || formatDurationShort(call.duration))}</span>
        </span>
      </button>
      ${open ? `<div class="cr-call__body">${crCallDetail(call, detail)}</div>` : ''}
    </div>`;
}
function crCallDetail(call, detail){
  if (!detail) return `<div class="blend-hint">Loading call detail…</div>`;
  if (detail.error) return `<div class="blend-empty"><b>Could not load this call</b>${escapeHtml(detail.error)}</div>`;
  const merged = Object.assign({}, call, detail.call || {});
  const facts = [
    ['Source', merged.source_name || merged.source],
    ['Campaign', merged.campaign],
    ['Keywords', merged.keywords],
    ['Landing page', merged.landing_page_url],
    ['Referrer', merged.referring_url || merged.referrer],
    ['Tracking number', merged.tracking_phone_number],
    ['Device', merged.device_type],
    ['Lead status', merged.lead_status]
  ].filter(([, value]) => value);

  let transcript = '';
  if (detail.transcriptState === 'ready' && detail.transcript?.length){
    transcript = `
      <div class="cr-transcript">
        <h5>Transcript</h5>
        ${detail.transcript.map(line => `
          <p class="cr-line"><span>${escapeHtml(line.role || '')}</span>${escapeHtml(line.text)}</p>
        `).join('')}
      </div>`;
  } else {
    // CallRail omits the field entirely when transcription is not on the plan,
    // so this is a plan state rather than an error.
    transcript = `<div class="blend-hint">No transcript for this call. Call transcription is a paid CallRail add-on and must be enabled on the company before recordings are transcribed.</div>`;
  }

  return `
    ${detail.summary ? `<div class="cr-summary">${escapeHtml(detail.summary)}</div>` : ''}
    ${facts.length ? `<dl class="cr-facts">${facts.map(([k,v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('')}</dl>` : ''}
    ${merged.recording_player || merged.recording ? `<a class="cr-rec" href="${escapeHtml(merged.recording_player || merged.recording)}" target="_blank" rel="noopener">Open recording in CallRail</a>` : ''}
    ${transcript}`;
}
function crCallsSection(model){
  const filters = `<input type="search" data-cr-filter="callSearch" placeholder="Filter callers" value="${escapeHtml(CR.filters.callSearch || '')}" />`;
  if (CR.callsLoading){
    return blendSectionShell({ src:'cr', id:'cr-calls', title:'CallRail · Calls',
      subtitle:'Loading', filters:'', body:`<div class="blend-hint">Loading individual calls…</div>` });
  }
  if (!CR.calls){
    return blendSectionShell({ src:'cr', id:'cr-calls', title:'CallRail · Calls',
      subtitle:'Not loaded', filters:'',
      body:`<div class="blend-empty"><b>Individual calls not loaded yet</b>Loading the call list is a separate request, so it only runs when you open this tab.</div>
            <div class="blend-events__actions"><button type="button" class="blend-mini" data-cr-loadcalls="1">Load calls</button></div>` });
  }
  if (CR.calls.error){
    return blendSectionShell({ src:'cr', id:'cr-calls', title:'CallRail · Calls',
      subtitle:'Failed', filters:'',
      body: blendNoData('Could not load calls', CR.calls.error) });
  }
  let rows = CR.calls.rows;
  const search = (CR.filters.callSearch || '').trim().toLowerCase();
  if (search){
    rows = rows.filter(call => [call.customer_name, call.customer_phone_number, call.source_name, call.campaign, call.keywords]
      .filter(Boolean).join(' ').toLowerCase().includes(search));
  }
  if (!rows.length){
    return blendSectionShell({ src:'cr', id:'cr-calls', title:'CallRail · Calls',
      subtitle:'Filtered', filters, body: blendNoData('No calls match', 'Clear the filter or widen the date range.') });
  }
  const selected = CR.filters.sources;
  const scope = selected && selected.size === 1 ? ` · ${Array.from(selected)[0]}` : '';
  return blendSectionShell({
    src:'cr', id:'cr-calls',
    title:'CallRail · Calls',
    subtitle:`${formatMetricValue(rows.length)} of ${formatMetricValue(CR.calls.total || rows.length)}${scope}`,
    filters,
    body:`<div class="cr-calls">${rows.map(crCallRow).join('')}</div>
      ${CR.calls.total > rows.length ? `<div class="blend-more">CallRail returns the 100 most recent calls for this range.</div>` : ''}`
  });
}
function crRenderSections(){
  const model = CR.data;
  const host = $('crSections');
  if (!model || !host) return;
  host.innerHTML = CR.tab === 'calls'
    ? crCallsSection(model)
    : [crOutcomeSection(model), crSourcesSection(model), crMoversSection(model)].join('');
}
function crRenderAll(){
  if (!CR.data) return;
  crRenderConnection();
  crRenderFilterCount();
  crRenderKpis();
  crRenderChart();
  crRenderSections();
  qsa('.cr-tab').forEach(tab => {
    const on = tab.getAttribute('data-cr-tab') === CR.tab;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
  });
}
async function crPersist(){
  if (!CR.data) return;
  await sessionSet(SESSION_KEYS.cr, {
    savedAt: Date.now(), tab: CR.tab, compare: CR.compare,
    filters: Object.assign({}, CR.filters, {
      sources: CR.filters.sources ? Array.from(CR.filters.sources) : null
    }),
    model: CR.data
  });
}
async function crRestore(){
  const saved = await sessionGet(SESSION_KEYS.cr);
  if (!saved?.model) return false;
  try{
    CR.compare = !!saved.compare;
    CR.tab = saved.tab === 'calls' ? 'calls' : 'overview';
    const filters = Object.assign({}, saved.filters || {});
    filters.sources = Array.isArray(filters.sources) ? new Set(filters.sources) : null;
    CR.filters = Object.assign(CR.filters, filters);
    CR.data = saved.model;
    const compareEl = $('crCompare');
    if (compareEl) compareEl.checked = CR.compare;
    renderHtml('crResult', '');
    crRenderAll();
    setCacheNote('crReportCacheStatus', { source:'cache', fetchedAt: saved.savedAt }, { cached:'Restored from this browser session' });
    return true;
  }catch(_){ return false; }
}
function mountCallRail(){
  on('crLoad', 'click', () => { void crLoadSummary(); });
  on('crRefreshData', 'click', () => { void crLoadSummary({ forceRefresh:true }); });
  on('crRange', 'change', () => {
    const custom = $('crRange')?.value === 'custom';
    setDateRangeMode('crRange', 'crStart', custom, { open:custom });
    if (!custom && CR.data) void crLoadSummary();
  });
  ['crCompare','crStart','crEnd','crDevice','crLeadStatus','crFirstTime','crMinDur','crMaxDur'].forEach(id => {
    on(id, 'change', () => { crRenderFilterCount(); if (CR.data) void crLoadSummary(); });
  });
  on('crAccount', 'change', async () => {
    crRenderConnection();
    try { await crLoadCompanies(); } catch(_){}
    crRenderConnection();
    if (CR.data) void crLoadSummary();
  });
  on('crCompany', 'change', () => { crRenderConnection(); if (CR.data) void crLoadSummary(); });

  $('crConnection')?.addEventListener('click', event => {
    const nav = event.target?.closest?.('[data-cr-nav]')?.getAttribute('data-cr-nav');
    if (nav) $(nav)?.click();
  });
  qsa('.cr-tab').forEach(tab => tab.addEventListener('click', () => {
    CR.tab = tab.getAttribute('data-cr-tab') === 'calls' ? 'calls' : 'overview';
    crRenderAll();
    if (CR.tab === 'calls' && !CR.calls && CR.data) void crLoadCalls();
    void crPersist();
  }));

  const sections = $('crSections');
  sections?.addEventListener('click', event => {
    const callId = event.target?.closest?.('[data-cr-call]')?.getAttribute('data-cr-call');
    if (callId) return void crToggleCall(callId);
    if (event.target?.closest?.('[data-cr-loadcalls]')) return void crLoadCalls();
    const source = event.target?.closest?.('[data-cr-source]')?.getAttribute('data-cr-source');
    if (source != null){
      if (!CR.filters.sources) CR.filters.sources = new Set();
      const set = CR.filters.sources;
      if (set.has(source)) set.delete(source); else set.add(source);
      CR.calls = null;
      crRenderSections();
      crRenderKpis();
      void crPersist();
      return;
    }
    const col = event.target?.closest?.('[data-blend-sort]')?.getAttribute('data-blend-sort');
    if (col){
      const current = CR.filters.sort;
      CR.filters.sort = current.col === col ? { col, dir: current.dir * -1 } : { col, dir:-1 };
      crRenderSections();
    }
  });
  sections?.addEventListener('change', event => {
    const key = event.target?.getAttribute?.('data-cr-filter');
    if (key !== 'group') return;
    CR.filters.group = event.target.value;
    CR.filters.sources = null;
    void crLoadSummary();
  });
  sections?.addEventListener('input', event => {
    const key = event.target?.getAttribute?.('data-cr-filter');
    if (key === 'search'){ CR.filters.search = event.target.value; crRenderSections(); }
    else if (key === 'callSearch'){ CR.filters.callSearch = event.target.value; crRenderSections(); }
  });

  crRenderConnection();
  crRenderFilterCount();
  void crRestore();
}

/* ==========================================================================
   SESSION REPORT CACHE
   chrome.storage.session lives for the browser session and is cleared when the
   browser closes — exactly the lifetime asked for. Reports rendered before the
   popup was dismissed are restored on reopen instead of being refetched.
   ========================================================================== */
const SESSION_KEYS = {
  blend: 'mcSessionBlend',
  perf: 'mcSessionPerf',
  ga: 'mcSessionGa',
  cr: 'mcSessionCr',
  nav: 'mcSessionNav'
};
const GSC_DATA_STATE_KEY = 'gscDataState';
function normalizeGscDataState(value){
  return value === 'all' ? 'all' : 'final';
}
// Search Console is always queried for finalized data. The fresh/"may change"
// option was removed from the UI; this is the single source of that decision.
function currentGscDataState(){
  return 'final';
}
async function applyGscDataState(value, { persist=true } = {}){
  const normalized = normalizeGscDataState(value);
  ['perfDataState', 'blendDataState'].forEach(id => { if ($(id)) $(id).value = normalized; });
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() - (normalized === 'all' ? 0 : 2));
  const maxIso = dateRangeIso(maxDate);
  [['perfCustomStart', 'dateStart', 'dateEnd'], ['blendCustomStart', 'blendStart', 'blendEnd']].forEach(([rootId, startId, endId]) => {
    const root = $(rootId);
    if (root) root.dataset.maxOffset = normalized === 'all' ? '0' : '2';
    const start = $(startId);
    const end = $(endId);
    if (end?.value && end.value > maxIso) end.value = maxIso;
    if (start?.value && end?.value && start.value > end.value) start.value = end.value;
    const state = DATE_RANGE_CONTROLS.get(startId);
    if (state){
      dateRangeSync(state);
      if (!state.popover.hidden) dateRangeRender(state);
    }
  });
  if (persist) await chrome.storage.local.set({ [GSC_DATA_STATE_KEY]: normalized });
  return normalized;
}
// Still runs on start-up: it is what applies the two-day lag to the date
// pickers, so a range cannot be chosen past the last finalized day.
async function hydrateGscDataState(){
  await applyGscDataState('final', { persist:false });
}
function sessionAvailable(){
  return !!(chrome?.storage?.session);
}
async function sessionGet(key){
  if (!sessionAvailable()) return null;
  try{
    const stored = await chrome.storage.session.get(key);
    return stored?.[key] ?? null;
  }catch(_){ return null; }
}
async function sessionSet(key, value){
  if (!sessionAvailable()) return;
  try{ await chrome.storage.session.set({ [key]: value }); }catch(_){ /* quota or unavailable */ }
}
async function sessionClear(key){
  if (!sessionAvailable()) return;
  try{ await chrome.storage.session.remove(key); }catch(_){ /* noop */ }
}
// Maps do not survive structured cloning into storage, so daily series are
// stored as plain arrays and rehydrated on read.
function sessionPackMaps(daily){
  const out = {};
  Object.entries(daily || {}).forEach(([key, map]) => {
    out[key] = map instanceof Map ? Array.from(map.entries()) : (Array.isArray(map) ? map : []);
  });
  return out;
}
function sessionUnpackMaps(packed){
  const out = {};
  Object.entries(packed || {}).forEach(([key, entries]) => {
    out[key] = new Map(Array.isArray(entries) ? entries : []);
  });
  return out;
}

/* ==========================================================================
   CLIENT WORKSPACES
   A workspace stores the GSC property + GA4 property + CallRail company as a
   single named client, so switching client is one click instead of three
   pickers. Stored locally; never leaves the browser.
   ========================================================================== */
const WS_KEYS = { list:'mcWorkspaces', active:'mcActiveWorkspace' };
const WS = { list: [], activeId: '', loaded: false, dirty: false };

async function wsLoad(){
  const stored = await new Promise(resolve => chrome.storage.local.get([WS_KEYS.list, WS_KEYS.active], resolve));
  // The read is async, so a save or delete can land while it is in flight.
  // Applying the snapshot then would silently discard that edit.
  if (WS.loaded || WS.dirty) return;
  WS.list = Array.isArray(stored[WS_KEYS.list]) ? stored[WS_KEYS.list] : [];
  WS.activeId = stored[WS_KEYS.active] || '';
  WS.loaded = true;
  wsRender();
}
async function wsPersist(){
  WS.dirty = true;
  WS.loaded = true;
  await new Promise(resolve => chrome.storage.local.set({
    [WS_KEYS.list]: WS.list,
    [WS_KEYS.active]: WS.activeId
  }, resolve));
}
function wsActive(){
  return WS.list.find(item => item.id === WS.activeId) || null;
}
function wsCaptureCurrent(name){
  const gaProp = gaCurrentPropertyId();
  const gaName = (GA.props || []).find(item => String(item.id) === String(gaProp))?.displayName || '';
  return {
    id: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    gscSiteUrl: $('sites')?.value || '',
    ga4PropertyId: gaProp || '',
    ga4PropertyName: gaName,
    callrailAccountId: $('crAccount')?.value || '',
    callrailCompanyId: $('crCompany')?.value || '',
    callrailCompanyName: $('crCompany')?.selectedOptions?.[0]?.textContent || '',
    googleEmail: $('accountLabel')?.textContent || '',
    createdAt: Date.now()
  };
}
function wsSummaryLine(workspace){
  const parts = [];
  if (workspace.gscSiteUrl) parts.push(workspace.gscSiteUrl.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, ''));
  if (workspace.ga4PropertyName) parts.push(workspace.ga4PropertyName);
  else if (workspace.ga4PropertyId) parts.push(`GA4 ${workspace.ga4PropertyId}`);
  if (workspace.callrailCompanyName) parts.push(workspace.callrailCompanyName);
  return parts.length ? parts.join(' · ') : 'No sources saved';
}
function wsRender(){
  const active = wsActive();
  const nameEl = $('wsCurrentName');
  if (nameEl) nameEl.textContent = active ? active.name : 'No client';
  const list = $('wsList');
  if (!list) return;
  if (!WS.list.length){
    list.innerHTML = `<div class="ws-empty">No clients saved yet. Pick a Search Console property, a GA4 property and a CallRail company, then save them here as a named client.</div>`;
    return;
  }
  list.innerHTML = WS.list.map(workspace => `
    <div class="ws-item ${workspace.id === WS.activeId ? 'is-active' : ''}" data-ws="${escapeHtml(workspace.id)}">
      <div class="ws-item__main">
        <div class="ws-item__name">${escapeHtml(workspace.name)}</div>
        <div class="ws-item__meta">${escapeHtml(wsSummaryLine(workspace))}</div>
      </div>
      <button class="ws-item__del" data-ws-del="${escapeHtml(workspace.id)}" title="Delete ${escapeHtml(workspace.name)}" aria-label="Delete ${escapeHtml(workspace.name)}">×</button>
    </div>
  `).join('');
}
async function wsApply(id){
  const workspace = WS.list.find(item => item.id === id);
  if (!workspace) return;
  WS.activeId = id;
  await wsPersist();
  wsRender();
  wsCloseMenu();

  if (workspace.gscSiteUrl && $('sites')){
    $('sites').value = workspace.gscSiteUrl;
    try { syncSitePickerLabel?.(); } catch(_){}
  }
  if (workspace.ga4PropertyId){
    try { await gaSetSelectedProperty(workspace.ga4PropertyId); } catch(_){}
  }
  if (workspace.callrailAccountId && $('crAccount')){
    $('crAccount').value = workspace.callrailAccountId;
    try{
      await crLoadCompanies();
      if (workspace.callrailCompanyId && $('crCompany')) $('crCompany').value = workspace.callrailCompanyId;
    }catch(_){}
  }
  clearResult(`Switched to ${workspace.name}.`);
}
function wsOpenMenu(){
  $('wsMenu')?.classList.remove('hidden');
  $('wsToggle')?.setAttribute('aria-expanded', 'true');
}
function wsCloseMenu(){
  $('wsMenu')?.classList.add('hidden');
  $('wsToggle')?.setAttribute('aria-expanded', 'false');
}
async function wsSaveCurrent(){
  const input = $('wsNewName');
  const name = (input?.value || '').trim();
  if (!name){
    input?.focus();
    return;
  }
  const workspace = wsCaptureCurrent(name);
  if (!workspace.gscSiteUrl && !workspace.ga4PropertyId && !workspace.callrailCompanyId){
    clearResult('Pick at least one property before saving a client.');
    return;
  }
  const existingIndex = WS.list.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
  if (existingIndex >= 0) WS.list[existingIndex] = Object.assign({}, workspace, { id: WS.list[existingIndex].id });
  else WS.list.push(workspace);
  WS.activeId = existingIndex >= 0 ? WS.list[existingIndex].id : workspace.id;
  await wsPersist();
  wsRender();
  if (input) input.value = '';
  clearResult(`Saved ${name}.`);
}
async function wsDelete(id){
  const workspace = WS.list.find(item => item.id === id);
  if (!workspace) return;
  WS.list = WS.list.filter(item => item.id !== id);
  if (WS.activeId === id) WS.activeId = '';
  await wsPersist();
  wsRender();
}
function mountWorkspaces(){
  on('wsToggle', 'click', (event) => {
    event.preventDefault();
    $('wsMenu')?.classList.contains('hidden') ? wsOpenMenu() : wsCloseMenu();
  });
  on('wsSave', 'click', () => { void wsSaveCurrent(); });
  on('wsNewName', 'keydown', (event) => { if (event.key === 'Enter') void wsSaveCurrent(); });
  on('wsList', 'click', (event) => {
    const deleteId = event.target?.getAttribute?.('data-ws-del');
    if (deleteId){
      event.stopPropagation();
      void wsDelete(deleteId);
      return;
    }
    const row = event.target?.closest?.('[data-ws]');
    if (row) void wsApply(row.getAttribute('data-ws'));
  });
  document.addEventListener('click', (event) => {
    if (!event.target?.closest?.('.ws-wrap')) wsCloseMenu();
  });
  void wsLoad();
}

/* ==========================================================================
   GOOGLE ACCOUNT SWITCHER
   ========================================================================== */
async function renderAccountSwitcher(){
  const host = $('googleAccountList');
  if (!host) return;
  let info = null;
  try{
    const response = await send({ type:'authListAccounts' });
    info = response?.ok ? response.data : null;
  }catch(_){ info = null; }

  if (!info){
    host.innerHTML = `<p class="subtle-note">Google account status is unavailable.</p>`;
    return;
  }
  const rows = [];
  if (info.chromeAccount?.email){
    rows.push(`
      <div class="ws-item ${info.provider === 'chrome' ? 'is-active' : ''}" data-auth-provider="chrome">
        <div class="ws-item__main">
          <div class="ws-item__name">${escapeHtml(info.chromeAccount.email)}</div>
          <div class="ws-item__meta">Chrome profile${info.provider === 'chrome' ? ' · Active account' : ' · Click to use'}</div>
        </div>
      </div>`);
  }
  (info.accounts || []).forEach(account => rows.push(`
    <div class="ws-item ${account.active ? 'is-active' : ''}" data-acct="${escapeHtml(account.email)}">
      <div class="ws-item__main">
        <div class="ws-item__name">${escapeHtml(account.email)}</div>
        <div class="ws-item__meta">Alternate account${account.active ? ' · Active account' : ' · Click to switch'}</div>
      </div>
      <button class="ws-item__del" data-acct-del="${escapeHtml(account.email)}" title="Disconnect ${escapeHtml(account.email)}" aria-label="Disconnect ${escapeHtml(account.email)}">×</button>
    </div>`));
  if (!rows.length){
    host.innerHTML = `<p class="subtle-note">No Google account connected yet. Start with your Chrome profile account.</p>`;
    return;
  }
  host.innerHTML = rows.join('') + (info.webAvailable ? '' : '<p class="subtle-note">Alternate-account sign-in is not configured.</p>');
}
function mountAccountSwitcher(){
  on('googleAccountList', 'click', async (event) => {
    const removeEmail = event.target?.getAttribute?.('data-acct-del');
    if (removeEmail){
      event.stopPropagation();
      await send({ type:'authRemoveAccount', email: removeEmail });
      await renderAccountSwitcher();
      await setAccountLabel();
      return;
    }
    const providerRow = event.target?.closest?.('[data-auth-provider="chrome"]');
    if (providerRow){
      if (!providerRow.classList.contains('is-active')) $('useChromeGoogle')?.click();
      return;
    }
    const row = event.target?.closest?.('[data-acct]');
    if (!row) return;
    const email = row.getAttribute('data-acct');
    const response = await send({ type:'authSelectAccount', email });
    if (!response?.ok){
      clearResult('❌ ' + (response?.error || 'Could not switch account.'));
      return;
    }
    await renderAccountSwitcher();
    await setAccountLabel();
    await loadSites({ forceRefresh:false }).catch(()=>{});
    await loadGaPropsOnce({ forceRefresh:false }).catch(()=>{});
    clearResult(`Switched to ${email}.`);
  });
  on('googleSwitchTipAction', 'click', async () => {
    await chrome.storage.local.set({ [GOOGLE_SWITCH_TIP_KEY]: true });
    $('googleSwitchTip')?.classList.add('hidden');
    $('navSettings')?.click();
    setTimeout(() => $('switchGoogle')?.focus(), 0);
  });
  on('googleSwitchTipDismiss', 'click', async () => {
    await chrome.storage.local.set({ [GOOGLE_SWITCH_TIP_KEY]: true });
    $('googleSwitchTip')?.classList.add('hidden');
  });
  void renderAccountSwitcher();
}

/* ==========================================================================
   SEARCH CONSOLE PERFORMANCE
   Four dimensions in one report (query / page / country / device), a real
   compare-to-previous, and an interactive clicks-and-impressions trend.
   ========================================================================== */
const PERF_DIMS = [
  { key:'query',   label:'Queries',   noun:'query' },
  { key:'page',    label:'Pages',     noun:'page' },
  { key:'country', label:'Countries', noun:'country' },
  { key:'device',  label:'Devices',   noun:'device' }
];
const PERF = {
  loading: false,
  data: null,
  compare: true,
  series: { clicks:true, impressions:true },
  filters: {
    query:   { search:'', sort:{ col:'clicks', dir:-1 } },
    page:    { search:'', sort:{ col:'clicks', dir:-1 } },
    country: { search:'', sort:{ col:'clicks', dir:-1 } },
    device:  { search:'', sort:{ col:'clicks', dir:-1 } },
    rows: 15
  }
};
function perfResolveRange(){
  const mode = $('perfRange')?.value || '28';
  const today = new Date();
  const lagDays = currentGscDataState() === 'all' ? 0 : 2;
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - lagDays);
  if (mode === 'custom'){
    const start = $('dateStart')?.value || '';
    let end = $('dateEnd')?.value || blendISO(anchor);
    if (!start) throw new Error('Pick a start date for the custom range.');
    // Search Console has no data for the last ~2 days; silently clamping is
    // kinder than returning an empty report the user cannot explain.
    if (end > blendISO(anchor)) end = blendISO(anchor);
    if (start > end) throw new Error('Start date must be before the end date.');
    return { start, end };
  }
  const days = Number(mode) || 28;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - (days - 1));
  return { start: blendISO(start), end: blendISO(anchor) };
}
async function perfLoadReport({ forceRefresh=false } = {}){
  if (PERF.loading) return;
  const siteUrl = $('sites')?.value?.trim();
  if (!siteUrl){
    renderHtml('perfResult', statusCard('Pick a Search Console property first.'));
    return;
  }
  const pageOnly = $('perfScope')?.value === 'page';
  const url = pageOnly ? normalizeUrl($('inspectUrl')?.value?.trim() || '') : null;
  if (pageOnly){
    if (!url){
      renderHtml('perfResult', statusCard('Enter a page URL, or switch the scope back to the whole property.'));
      return;
    }
    if (!propertyCoversUrl(siteUrl, url)){
      renderHtml('perfResult', statusCard('The selected property does not cover that URL.'));
      return;
    }
  }

  let range;
  try{ range = perfResolveRange(); }
  catch(e){ return renderHtml('perfResult', statusCard(e.message)); }

  const compare = !!$('perfCompare')?.checked;
  PERF.compare = compare;
  const prev = compare ? blendPrevRange(range) : null;

  PERF.loading = true;
  renderHtml('perfResult', statusCard(forceRefresh ? 'Refreshing Search Console…' : 'Loading Search Console…'));
  const dataState = currentGscDataState();
  const base = { type:'perf', siteUrl, url, pageOnly, dataState, forceRefresh };
  const job = (payload) => payload ? blendSend(payload) : Promise.resolve(null);

  try{
    const names = ['trend', 'trendPrev', 'summary', 'summaryPrev'];
    const requests = [
      job(Object.assign({}, base, { startDate:range.start, endDate:range.end, dimensions:['date'], rowLimit:1000 })),
      job(prev && Object.assign({}, base, { startDate:prev.start, endDate:prev.end, dimensions:['date'], rowLimit:1000 })),
      job(Object.assign({}, base, { startDate:range.start, endDate:range.end })),
      job(prev && Object.assign({}, base, { startDate:prev.start, endDate:prev.end }))
    ];
    PERF_DIMS.forEach(dim => {
      names.push(dim.key, `${dim.key}Prev`);
      requests.push(job(Object.assign({}, base, { startDate:range.start, endDate:range.end, dimensions:[dim.key], rowLimit:500 })));
      requests.push(job(prev && Object.assign({}, base, { startDate:prev.start, endDate:prev.end, dimensions:[dim.key], rowLimit:500 })));
    });

    const settled = await Promise.all(requests);
    const raw = {};
    names.forEach((name, index) => { raw[name] = settled[index]; });

    if (raw.trend && !raw.trend.ok && raw.summary && !raw.summary.ok){
      throw apiErrorFromResponse(raw.summary, 'Search Console request failed.');
    }

    const trendRows = blendGscRows(raw.trend);
    const trendPrevRows = blendGscRows(raw.trendPrev);
    const summaryRow = blendGscRows(raw.summary)[0] || null;
    const prevSummaryRow = blendGscRows(raw.summaryPrev)[0] || null;

    const totals = summaryRow || {
      clicks: blendSum(trendRows, 'clicks'),
      impressions: blendSum(trendRows, 'impressions'),
      ctr: 0, position: 0
    };
    const prevTotals = prevSummaryRow || (trendPrevRows.length ? {
      clicks: blendSum(trendPrevRows, 'clicks'),
      impressions: blendSum(trendPrevRows, 'impressions'),
      ctr: 0, position: 0
    } : null);

    const dims = {};
    PERF_DIMS.forEach(dim => {
      dims[dim.key] = {
        rows: blendGscRows(raw[dim.key]),
        prev: blendGscRows(raw[`${dim.key}Prev`])
      };
    });

    PERF.data = {
      range, prevRange: prev, compare, pageOnly, url, siteUrl, dataState,
      axis: blendDateAxis(range),
      daily: {
        clicks: blendDailyMap(trendRows, 0, row => row.clicks),
        impressions: blendDailyMap(trendRows, 0, row => row.impressions)
      },
      dailyPrev: {
        clicks: blendDailyMap(trendPrevRows, 0, row => row.clicks),
        impressions: blendDailyMap(trendPrevRows, 0, row => row.impressions)
      },
      totals, prevTotals, dims,
      positionBands: perfBands(dims.query.rows.length ? dims.query.rows : dims.page.rows)
    };
    renderHtml('perfResult', '');
    perfRenderAll();
    void perfPersist();
    setCacheNote('perfCacheStatus', { source: forceRefresh ? 'network' : 'mixed', fetchedAt: Date.now() }, {
      network:'Search Console refreshed', mixed:'Search Console updated'
    });
  }catch(e){
    renderApiError('perfResult', e, 'refreshPerf');
  }finally{
    PERF.loading = false;
  }
}
function perfBands(rows){
  if (!rows?.length) return null;
  const buckets = [
    { label:'1–3', tone:'strong', value:0 },
    { label:'4–10', tone:'mid', value:0 },
    { label:'11–20', tone:'opp', value:0 },
    { label:'21+', tone:'far', value:0 }
  ];
  rows.forEach(row => {
    const position = Number(row.position || 0);
    if (!position) return;
    if (position <= 3) buckets[0].value += 1;
    else if (position <= 10) buckets[1].value += 1;
    else if (position <= 20) buckets[2].value += 1;
    else buckets[3].value += 1;
  });
  return buckets.some(bucket => bucket.value) ? buckets : null;
}
function perfRenderKpis(){
  const model = PERF.data;
  const host = $('perfKpis');
  if (!model || !host) return;
  const t = model.totals;
  const p = model.prevTotals;
  const compare = PERF.compare && p;
  const ctr = t.impressions ? t.clicks / t.impressions : 0;
  const prevCtr = p && p.impressions ? p.clicks / p.impressions : null;

  host.innerHTML = [
    blendKpiCard({ src:'gsc', label:'Clicks', value: formatMetricValue(t.clicks),
      delta: compare ? metricDelta(t.clicks, p.clicks) : null,
      sub: `${escapeHtml(model.range.start)} → ${escapeHtml(model.range.end)}` }),
    blendKpiCard({ src:'gsc', label:'Impressions', value: formatMetricValue(t.impressions),
      delta: compare ? metricDelta(t.impressions, p.impressions) : null,
      sub: model.pageOnly ? 'This page only' : 'Whole property' }),
    blendKpiCard({ src:'gsc', label:'CTR', value: `${(ctr * 100).toFixed(2)}%`,
      delta: compare && prevCtr != null ? formatPointDelta(ctr, prevCtr, { digits:2 }) : null,
      sub: `<b>${escapeHtml(formatMetricValue(t.clicks))}</b> of ${escapeHtml(formatMetricValue(t.impressions))}` }),
    blendKpiCard({ src:'gsc', label:'Avg position', value: t.position ? t.position.toFixed(1) : '—',
      delta: compare && p.position ? formatAbsDelta(t.position, p.position, { inverse:true }) : null,
      sub: model.positionBands ? `${model.positionBands[0].value + model.positionBands[1].value} in the top 10` : 'Impression-weighted by Google' })
  ].join('');
}
function perfRenderChart(){
  const model = PERF.data;
  const host = $('perfChart');
  if (!model || !host) return;
  const axis = model.axis;
  if (axis.length < 2 || !model.daily.clicks.size){
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');
  const series = [
    { key:'clicks', label:'Clicks', colour:'#39e07a' },
    { key:'impressions', label:'Impressions', colour:'#5dcaa5' }
  ].filter(item => PERF.series[item.key]);

  const W = 700, H = 190, PAD_L = 6, PAD_R = 6, PAD_T = 12, PAD_B = 22;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const x = index => PAD_L + (index * plotW / Math.max(1, axis.length - 1));

  const paths = series.map(item => {
    const values = axis.map(date => Number(model.daily[item.key].get(date) || 0));
    const prevValues = axis.map((_, index) => {
      const prevAxis = Array.from(model.dailyPrev[item.key].values());
      return Number(prevAxis[index] || 0);
    });
    const max = Math.max(1, ...values, ...(PERF.compare ? prevValues : []));
    const y = value => PAD_T + plotH * (1 - (value / max));
    const line = values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
    const ghost = PERF.compare && prevValues.some(value => value > 0)
      ? `<path d="${prevValues.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ')}" fill="none" stroke="${item.colour}" stroke-width="1.4" stroke-dasharray="4 4" opacity=".38"></path>`
      : '';
    return `${ghost}<path d="${line}" fill="none" stroke="${item.colour}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }).join('');

  const grid = [0, 0.5, 1].map(fraction => {
    const y = PAD_T + plotH * fraction;
    return `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="rgba(255,255,255,.06)"></line>`;
  }).join('');
  const tickEvery = Math.max(1, Math.ceil(axis.length / 6));
  const ticks = axis.map((date, index) => (index % tickEvery === 0 || index === axis.length - 1)
    ? `<text x="${x(index).toFixed(1)}" y="${H - 6}" fill="rgba(136,168,150,.6)" font-size="10" text-anchor="middle">${escapeHtml(date.slice(5))}</text>`
    : '').join('');

  host.innerHTML = `
    <div class="blend-chart-head">
      <div>
        <div class="blend-chart-title">Daily performance</div>
        <div class="blend-chart-note">${PERF.compare ? 'Dashed line is the previous period. ' : ''}Each line is scaled to its own peak. Hover for exact values.</div>
      </div>
      <div class="blend-legend-toggles">
        ${['clicks', 'impressions'].map(key => `
          <button type="button" class="blend-legend-btn ${PERF.series[key] ? 'is-on' : ''}" data-perf-series="${key}">
            <i style="background:${key === 'clicks' ? '#39e07a' : '#5dcaa5'}"></i>${key === 'clicks' ? 'Clicks' : 'Impressions'}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="blend-plot" id="perfPlot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Search Console daily performance">
        ${grid}${paths}${ticks}
        <line id="perfCursor" x1="0" y1="${PAD_T}" x2="0" y2="${PAD_T + plotH}" stroke="rgba(255,255,255,.25)" opacity="0"></line>
        <rect class="blend-plot__hit" x="0" y="0" width="${W}" height="${H}" id="perfHit"></rect>
      </svg>
      <div class="blend-tip hidden" id="perfTip"></div>
    </div>
  `;
  perfBindChart({ W, PAD_L, plotW, axis });
}
function perfBindChart(geo){
  const plot = $('perfPlot'), hit = $('perfHit'), tip = $('perfTip'), cursor = $('perfCursor');
  if (!plot || !hit || !tip) return;
  hit.addEventListener('mousemove', event => {
    const rect = plot.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const step = geo.plotW / Math.max(1, geo.axis.length - 1);
    const index = Math.min(geo.axis.length - 1, Math.max(0, Math.round((ratio * geo.W - geo.PAD_L) / step)));
    const date = geo.axis[index];
    const model = PERF.data;
    const rows = [
      PERF.series.clicks ? ['Clicks', '#39e07a', model.daily.clicks.get(date) || 0] : null,
      PERF.series.impressions ? ['Impressions', '#5dcaa5', model.daily.impressions.get(date) || 0] : null
    ].filter(Boolean);
    if (!rows.length) return tip.classList.add('hidden');
    tip.innerHTML = `<div class="blend-tip__date">${escapeHtml(date)}</div>` + rows.map(([label, colour, value]) =>
      `<div class="blend-tip__row"><span><i style="background:${colour}"></i>${label}</span><strong>${escapeHtml(formatMetricValue(value))}</strong></div>`).join('');
    tip.classList.remove('hidden');
    const left = geo.PAD_L + index * step;
    tip.style.left = `${(left / geo.W) * 100}%`;
    tip.style.top = `${rect.height * 0.62}px`;
    if (cursor){ cursor.setAttribute('x1', left); cursor.setAttribute('x2', left); cursor.setAttribute('opacity', '1'); }
  });
  hit.addEventListener('mouseleave', () => {
    tip.classList.add('hidden');
    if (cursor) cursor.setAttribute('opacity', '0');
  });
}
function perfDimSection(dim){
  const model = PERF.data;
  const bucket = model.dims[dim.key];
  const state = PERF.filters[dim.key];
  const filters = `<input type="search" data-perf-filter="${dim.key}" placeholder="Filter ${escapeHtml(dim.noun)}s" value="${escapeHtml(state.search)}" />`;
  if (!bucket?.rows?.length){
    return blendSectionShell({
      src:'gsc', id:`perf-${dim.key}`, title:`Search Console · ${dim.label}`,
      subtitle:'No rows returned', filters,
      body: blendNoData(`No ${dim.noun} data`, 'Search Console may not have data for this dimension in the selected range.')
    });
  }
  const prevMap = new Map(bucket.prev.map(row => [row.key, row]));
  let rows = bucket.rows.map(row => Object.assign({}, row, { prevClicks: prevMap.get(row.key)?.clicks ?? null }));
  const search = state.search.trim().toLowerCase();
  if (search) rows = rows.filter(row => row.key.toLowerCase().includes(search));
  rows = blendSortRows(rows, state.sort);
  const shown = rows.slice(0, PERF.filters.rows);
  if (!shown.length){
    return blendSectionShell({
      src:'gsc', id:`perf-${dim.key}`, title:`Search Console · ${dim.label}`, subtitle:'Filtered', filters,
      body: blendNoData('No rows match', 'Clear the filter or widen the date range.')
    });
  }
  const max = Math.max(1, ...shown.map(row => row.clicks));
  const totalClicks = blendSum(rows, 'clicks');
  const totalImpr = blendSum(rows, 'impressions');
  return blendSectionShell({
    src:'gsc', id:`perf-${dim.key}`,
    title:`Search Console · ${dim.label}`,
    subtitle:`${formatMetricValue(rows.length)} ${dim.noun}${rows.length === 1 ? '' : 's'}`,
    filters,
    body:`
      <div class="blend-table-shell">
        <table class="blend-table">
          <thead><tr>
            ${blendHeadCell(dim.label.replace(/s$/, ''), 'key', state.sort, false)}
            ${blendHeadCell('Clicks', 'clicks', state.sort)}
            ${blendHeadCell('Impressions', 'impressions', state.sort)}
            ${blendHeadCell('CTR', 'ctr', state.sort)}
            ${blendHeadCell('Position', 'position', state.sort)}
          </tr></thead>
          <tbody>
            <tr class="is-total">
              <td>All ${escapeHtml(dim.noun)}s</td>
              <td class="num">${escapeHtml(formatMetricValue(totalClicks))}</td>
              <td class="num">${escapeHtml(formatMetricValue(totalImpr))}</td>
              <td class="num">${totalImpr ? ((totalClicks / totalImpr) * 100).toFixed(2) : '0.00'}%</td>
              <td class="num">—</td>
            </tr>
            ${shown.map(row => `
              <tr>
                <td><span class="blend-name" title="${escapeHtml(row.key)}">${escapeHtml(row.key || '—')}</span></td>
                <td class="num">${escapeHtml(formatMetricValue(row.clicks))}${PERF.compare ? blendDeltaTag(row.clicks, row.prevClicks) : ''}${blendBar(row.clicks, max)}</td>
                <td class="num">${escapeHtml(formatMetricValue(row.impressions))}</td>
                <td class="num">${(row.ctr * 100).toFixed(2)}%</td>
                <td class="num">${row.position ? row.position.toFixed(1) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length > shown.length ? `<div class="blend-more">Showing top ${shown.length} of ${formatMetricValue(rows.length)}.</div>` : ''}
      </div>
    `
  });
}
function perfRenderSections(){
  const model = PERF.data;
  const host = $('perfSections');
  if (!model || !host) return;
  const bands = model.positionBands
    ? blendSectionShell({
        src:'gsc', id:'perf-bands', title:'Search Console · Position bands',
        subtitle:'Where your queries currently rank', filters:'',
        body: buildInsightBandsSection({ type:'bands', title:'', bands: model.positionBands })
      })
    : '';
  host.innerHTML = bands + PERF_DIMS.map(perfDimSection).join('');
}
function perfRenderAll(){
  if (!PERF.data) return;
  perfRenderKpis();
  perfRenderChart();
  perfRenderSections();
}
async function perfPersist(){
  if (!PERF.data) return;
  await sessionSet(SESSION_KEYS.perf, {
    savedAt: Date.now(),
    compare: PERF.compare,
    series: PERF.series,
    model: Object.assign({}, PERF.data, {
      daily: sessionPackMaps(PERF.data.daily),
      dailyPrev: sessionPackMaps(PERF.data.dailyPrev)
    })
  });
}
async function perfRestore(){
  const saved = await sessionGet(SESSION_KEYS.perf);
  if (!saved?.model) return false;
  try{
    if (!saved.model.dataState || normalizeGscDataState(saved.model.dataState) !== currentGscDataState()) return false;
    PERF.compare = !!saved.compare;
    PERF.series = Object.assign(PERF.series, saved.series || {});
    PERF.data = Object.assign({}, saved.model, {
      daily: sessionUnpackMaps(saved.model.daily),
      dailyPrev: sessionUnpackMaps(saved.model.dailyPrev)
    });
    const compareEl = $('perfCompare');
    if (compareEl) compareEl.checked = PERF.compare;
    renderHtml('perfResult', '');
    perfRenderAll();
    setCacheNote('perfCacheStatus', { source:'cache', fetchedAt: saved.savedAt }, { cached:'Restored from this browser session' });
    return true;
  }catch(_){ return false; }
}
function mountPerf(){
  on('loadPerf', 'click', () => { void perfLoadReport(); });
  on('refreshPerf', 'click', () => { void perfLoadReport({ forceRefresh:true }); });
  on('perfRange', 'change', () => {
    const custom = $('perfRange')?.value === 'custom';
    setDateRangeMode('perfRange', 'dateStart', custom, { open:custom });
    if (!custom && PERF.data) void perfLoadReport();
  });
  ['perfScope', 'perfCompare', 'dateStart', 'dateEnd'].forEach(id => {
    on(id, 'change', () => { if (PERF.data) void perfLoadReport(); });
  });
  $('perfChart')?.addEventListener('click', event => {
    const key = event.target?.closest?.('[data-perf-series]')?.getAttribute('data-perf-series');
    if (!key) return;
    // Refuse to hide the last visible line; an empty chart is not a useful state.
    const visible = Object.values(PERF.series).filter(Boolean).length;
    if (PERF.series[key] && visible <= 1) return;
    PERF.series[key] = !PERF.series[key];
    perfRenderChart();
  });
  const sections = $('perfSections');
  sections?.addEventListener('click', event => {
    const col = event.target?.closest?.('[data-blend-sort]')?.getAttribute('data-blend-sort');
    if (!col) return;
    const id = event.target.closest('[data-blend-section]')?.getAttribute('data-blend-section') || '';
    const dimKey = id.replace('perf-', '');
    const state = PERF.filters[dimKey];
    if (!state) return;
    state.sort = state.sort.col === col ? { col, dir: state.sort.dir * -1 } : { col, dir: -1 };
    perfRenderSections();
  });
  sections?.addEventListener('input', event => {
    const dimKey = event.target?.getAttribute?.('data-perf-filter');
    if (!dimKey || !PERF.filters[dimKey]) return;
    PERF.filters[dimKey].search = event.target.value;
    perfRenderSections();
  });
  void perfRestore();
}

/* ==========================================================================
   BLENDED REPORT — Command Centre
   Pulls GSC + GA4 + CallRail for one client and renders KPIs, an interactive
   trend, and per-platform detail tables. Each source degrades independently:
   a missing connector greys out its own tiles rather than failing the report.
   ========================================================================== */
const BLEND_SRC = {
  gsc: { key:'gsc', label:'Search Console', colour:'#39e07a', cls:'src-gsc' },
  ga:  { key:'ga',  label:'GA4',            colour:'#7f77dd', cls:'src-ga'  },
  cr:  { key:'cr',  label:'CallRail',       colour:'#f1b84a', cls:'src-cr'  }
};
const BLEND = {
  loading: false,
  eventsOpen: false,
  range: null,
  compare: true,
  data: null,
  filters: {
    gaDim: 'sessionDefaultChannelGroup',
    gaSearch: '',
    gaSort: { col:'sessions', dir:-1 },
    keySort: { col:'keyEvents', dir:-1 },
    crGroup: 'source',
    crSources: null,
    crSort: { col:'total_calls', dir:-1 },
    gscDim: 'page',
    gscSearch: '',
    gscSort: { col:'clicks', dir:-1 },
    keySearch: '',
    keyChannels: null,
    rows: 15
  },
  series: { sessions:true, clicks:true, keyEvents:true, calls:true }
};

function blendNormalisePath(value){
  if (!value) return '';
  let path = String(value).trim();
  try{
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  }catch(_){ /* keep raw value */ }
  path = path.split('#')[0].split('?')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path.toLowerCase() || '/';
}
function blendISO(date){
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function blendResolveRange(){
  const mode = $('blendRange')?.value || '28';
  const today = new Date();
  // Search Console lags ~2 days; anchoring every source to the same window keeps
  // the sources comparable even though GA4 and CallRail could go later.
  const lagDays = currentGscDataState() === 'all' ? 0 : 2;
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - lagDays);
  if (mode === 'custom'){
    const start = $('blendStart')?.value || '';
    let end = $('blendEnd')?.value || blendISO(anchor);
    if (!start) throw new Error('Pick a start date for the custom range.');
    if (end > blendISO(anchor)) end = blendISO(anchor);
    if (start > end) throw new Error('Start date must be before the end date.');
    return { start, end };
  }
  const days = Number(mode) || 28;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - (days - 1));
  return { start: blendISO(start), end: blendISO(anchor) };
}
function blendPrevRange(range){
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  const days = Math.round((end - start) / 86400000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(start.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - (days - 1));
  return { start: blendISO(prevStart), end: blendISO(prevEnd) };
}
function blendGaDate(value){
  const raw = String(value || '');
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  return raw;
}

/* ---------- connector awareness ---------- */
function blendConnectorState(){
  const siteUrl = $('sites')?.value?.trim() || '';
  const gaProp = (typeof gaCurrentPropertyId === 'function' ? gaCurrentPropertyId() : '') || '';
  const gaName = (GA.props || []).find(item => String(item.id) === String(gaProp))?.displayName || '';
  const crAccount = $('crAccount')?.value || '';
  const crCompany = $('crCompany')?.value || '';
  const crCompanyName = crCompany
    ? ($('crCompany')?.selectedOptions?.[0]?.textContent || '')
    : 'All companies';
  const keyEvents = gaProp && typeof gaGetSelectedKeyEvents === 'function'
    ? gaGetSelectedKeyEvents(gaProp)
    : [];
  return {
    gsc: { on: !!siteUrl, value: siteUrl.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '') || 'No property selected', nav:'navPerf' },
    ga:  { on: !!gaProp, value: gaName || (gaProp ? `Property ${gaProp}` : 'No property selected'), nav:'navAnalytics', propertyId: gaProp, keyEvents },
    cr:  { on: !!crAccount, value: crAccount ? crCompanyName : 'Not connected', nav:'navCallRail', accountId: crAccount, companyId: crCompany }
  };
}
function blendRenderConnectors(){
  // The connector chips duplicated what the selectors already show, so the
  // status now lives on each selector as a dot instead of a separate row.
  const workspace = typeof wsActive === 'function' ? wsActive() : null;
  const nameEl = $('blendClientName');
  if (nameEl) nameEl.textContent = workspace ? workspace.name : 'Blended report';
  const host = $('blendConnectors');
  if (host) host.innerHTML = '';
}

/* ---------- fetch ---------- */
async function blendSend(payload){
  try{
    const response = await send(payload);
    if (!response?.ok) return {
      ok:false,
      error:response?.error || 'Request failed.',
      code:response?.code || 'unknown',
      retryable:!!response?.retryable,
      retryAfterSeconds:Number(response?.retryAfterSeconds || 0),
      detail:response?.detail || ''
    };
    return { ok:true, data: response.data, cache: response.cache || null };
  }catch(e){
    const error = normalizeApiError(e);
    return { ok:false, error:error.message, code:error.code || 'unknown', retryable:!!error.retryable, retryAfterSeconds:Number(error.retryAfterSeconds || 0), detail:error.detail || '' };
  }
}
async function blendFetchAll({ forceRefresh=false } = {}){
  const state = blendConnectorState();
  const range = blendResolveRange();
  const compare = !!$('blendCompare')?.checked;
  const prev = compare ? blendPrevRange(range) : null;
  BLEND.range = range;
  BLEND.compare = compare;

  const siteUrl = $('sites')?.value?.trim() || '';
  const propertyId = state.ga.propertyId;
  const keyEventNames = state.ga.keyEvents || [];
  const accountId = state.cr.accountId;
  const companyId = state.cr.companyId;
  const crGroup = BLEND.filters.crGroup;
  const gaDim = BLEND.filters.gaDim;
  const gscDim = BLEND.filters.gscDim;
  const dataState = currentGscDataState();

  const jobs = {};
  const add = (name, payload) => { jobs[name] = payload ? blendSend(payload) : Promise.resolve(null); };

  // --- Search Console ---
  const gscBase = { type:'perf', siteUrl, url:null, pageOnly:false, dataState, forceRefresh };
  add('gscTrend', siteUrl && Object.assign({}, gscBase, { startDate:range.start, endDate:range.end, dimensions:['date'], rowLimit:1000 }));
  add('gscBreak', siteUrl && Object.assign({}, gscBase, { startDate:range.start, endDate:range.end, dimensions:[gscDim], rowLimit:500 }));
  add('gscTrendPrev', (siteUrl && prev) && Object.assign({}, gscBase, { startDate:prev.start, endDate:prev.end, dimensions:['date'], rowLimit:1000 }));
  add('gscBreakPrev', (siteUrl && prev) && Object.assign({}, gscBase, { startDate:prev.start, endDate:prev.end, dimensions:[gscDim], rowLimit:500 }));

  // --- GA4 ---
  const gaBase = { type:'gaReport', propertyId, forceRefresh };
  const gaMetrics = ['sessions', 'keyEvents'];
  add('gaTrend', propertyId && Object.assign({}, gaBase, {
    startDate:range.start, endDate:range.end,
    dimensions:['date', 'sessionDefaultChannelGroup'], metrics:gaMetrics, rowLimit:2000
  }));
  add('gaTrendPrev', (propertyId && prev) && Object.assign({}, gaBase, {
    startDate:prev.start, endDate:prev.end,
    dimensions:['date', 'sessionDefaultChannelGroup'], metrics:gaMetrics, rowLimit:2000
  }));
  // Sessions are session-scoped, so a session spanning midnight is counted in
  // both days. Summing the date-split trend therefore overstates the total by a
  // few sessions. These date-free requests are what the KPI cards use, so the
  // headline matches the channel table and GA4 itself; the trend still drives
  // the per-day line.
  add('gaTotals', propertyId && Object.assign({}, gaBase, {
    startDate:range.start, endDate:range.end,
    dimensions:['sessionDefaultChannelGroup'], metrics:gaMetrics, rowLimit:100
  }));
  add('gaTotalsPrev', (propertyId && prev) && Object.assign({}, gaBase, {
    startDate:prev.start, endDate:prev.end,
    dimensions:['sessionDefaultChannelGroup'], metrics:gaMetrics, rowLimit:100
  }));
  add('gaBreak', propertyId && Object.assign({}, gaBase, {
    startDate:range.start, endDate:range.end,
    dimensions:[gaDim], metrics:gaMetrics, rowLimit:300, orderByMetric:'sessions'
  }));
  add('gaBreakPrev', (propertyId && prev) && Object.assign({}, gaBase, {
    startDate:prev.start, endDate:prev.end,
    dimensions:[gaDim], metrics:gaMetrics, rowLimit:300, orderByMetric:'sessions'
  }));
  const keyFilter = keyEventNames.length ? { fieldName:'eventName', values:keyEventNames } : null;
  add('gaEvents', propertyId && Object.assign({}, gaBase, {
    startDate:range.start, endDate:range.end,
    dimensions:['eventName'], metrics:['keyEvents', 'eventCount'],
    inListFilter:keyFilter, rowLimit:100, orderByMetric:'keyEvents'
  }));
  add('gaEventsPrev', (propertyId && prev) && Object.assign({}, gaBase, {
    startDate:prev.start, endDate:prev.end,
    dimensions:['eventName'], metrics:['keyEvents', 'eventCount'],
    inListFilter:keyFilter, rowLimit:100, orderByMetric:'keyEvents'
  }));
  add('gaEventsByChannel', propertyId && Object.assign({}, gaBase, {
    startDate:range.start, endDate:range.end,
    dimensions:['eventName', 'sessionDefaultChannelGroup'], metrics:['keyEvents', 'eventCount'],
    inListFilter:keyFilter, rowLimit:400, orderByMetric:'keyEvents'
  }));

  // --- CallRail ---
  // Match the CallRail panel's request exactly. It sends the filter fields and
  // the company name; blend used to omit them, which hashed to a different
  // cache entry, so the blended report never saw the result the CallRail tab
  // had already fetched successfully. Sharing the shape shares the cache, and
  // makes the blended figures honour the same filters.
  const crFilters = typeof crActiveFilters === 'function' ? crActiveFilters() : {};
  const crBase = {
    type:'callrailCallSummary', accountId, companyId, forceRefresh,
    companyName: $('crCompany')?.selectedOptions?.[0]?.textContent || '',
    device: crFilters.device,
    lead_status: crFilters.lead,
    first_time_callers: crFilters.first,
    min_duration: crFilters.min,
    max_duration: crFilters.max,
    include_voicemails: false
  };
  add('crBreak', accountId && Object.assign({}, crBase, { start_date:range.start, end_date:range.end, group_by:crGroup }));
  add('crBreakPrev', (accountId && prev) && Object.assign({}, crBase, { start_date:prev.start, end_date:prev.end, group_by:crGroup }));
  // The Calls KPI counts organic-search calls, so it needs the source split
  // rather than the date split the trend line uses.
  add('crSource', accountId && Object.assign({}, crBase, { start_date:range.start, end_date:range.end, group_by:'source' }));
  add('crSourcePrev', (accountId && prev) && Object.assign({}, crBase, { start_date:prev.start, end_date:prev.end, group_by:'source' }));
  add('crTrend', accountId && Object.assign({}, crBase, { start_date:range.start, end_date:range.end, group_by:'date' }));
  add('crTrendPrev', (accountId && prev) && Object.assign({}, crBase, { start_date:prev.start, end_date:prev.end, group_by:'date' }));

  const names = Object.keys(jobs);
  const settled = await Promise.all(names.map(name => jobs[name]));
  const out = {};
  names.forEach((name, index) => { out[name] = settled[index]; });
  out._state = state;
  out._range = range;
  out._prev = prev;
  out._dataState = dataState;
  return out;
}

/* ---------- shaping ---------- */
function blendGaRows(result, metricNames){
  if (!result?.ok) return [];
  const data = result.data || {};
  const index = Object.fromEntries((data.metricHeaders || []).map((header, i) => [header.name, i]));
  return (data.rows || []).map(row => {
    const dims = (row.dimensionValues || []).map(value => value.value || '');
    const entry = { dims, key: dims.join(' · ') };
    metricNames.forEach(name => {
      entry[name] = Number(row.metricValues?.[index[name]]?.value || 0);
    });
    return entry;
  });
}
function blendGscRows(result){
  if (!result?.ok) return [];
  return (result.data?.rows || []).map(row => ({
    key: row.keys?.[0] || '',
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0)
  }));
}
function blendCrRows(result){
  if (!result?.ok) return [];
  return (result.data?.rows || []).map(row => ({
    key: row.key || '',
    total_calls: Number(row.total_calls || 0),
    answered_calls: Number(row.answered_calls || 0),
    missed_calls: Number(row.missed_calls || 0),
    voicemails: Number(row.voicemails || 0),
    first_time_callers: Number(row.first_time_callers || 0),
    average_duration: Number(row.average_duration || 0),
    formatted_average_duration: row.formatted_average_duration || ''
  }));
}
function blendSum(rows, field){
  return (rows || []).reduce((total, row) => total + Number(row[field] || 0), 0);
}
function blendDailyMap(rows, dateIndex, valueFn){
  const map = new Map();
  (rows || []).forEach(row => {
    const date = blendGaDate(Array.isArray(row.dims) ? row.dims[dateIndex] : row.key);
    if (!date) return;
    map.set(date, (map.get(date) || 0) + Number(valueFn(row) || 0));
  });
  return map;
}
function blendDateAxis(range){
  const dates = [];
  const cursor = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  let guard = 0;
  while (cursor <= end && guard++ < 400){
    dates.push(blendISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
/* Organic *search* only. Social, video and community platforms are excluded
   even though CallRail also labels them "Organic". */
const BLEND_SEARCH_ENGINES = /\b(google|bing|yahoo|duck\s*duck\s*go|duckduckgo|yandex|baidu|ecosia|startpage|qwant|brave|naver|seznam|searx|mojeek|dogpile|lycos|petal|sogou|daum|aol|ask)\b/i;
const BLEND_NON_SEARCH_ORGANIC = /\b(facebook|fb|meta|instagram|threads|twitter|linkedin|pinterest|tiktok|youtube|reddit|snapchat|whatsapp|telegram|tumblr|quora|nextdoor|discord|twitch|vk|weibo|wechat|medium|substack)\b/i;
function blendIsOrganicSearchSource(key){
  const source = String(key || '');
  if (!/organic/i.test(source)) return false;
  if (BLEND_NON_SEARCH_ORGANIC.test(source)) return false;
  return BLEND_SEARCH_ENGINES.test(source) || /organic\s*search/i.test(source);
}

/* ==========================================================================
   BLEND SEGMENTS · 0.8.1
   Which slice of traffic the blended KPI cards describe. Each segment says how
   to recognise itself on the GA4 side (channel group) and on the CallRail side
   (call source), so sessions, key events and calls always describe the same
   audience. Chosen in Settings; Organic search is the default.
   ========================================================================== */
const BLEND_SEGMENT_KEY = 'blendSegment';
const BLEND_SEGMENT_DEFAULT = 'organicSearch';
const BLEND_SEGMENTS = {
  organicSearch: {
    label: 'Organic search',
    noun: 'Organic',
    channel: c => c === 'organic search',
    source: key => blendIsOrganicSearchSource(key)
  },
  paidSearch: {
    label: 'Paid search',
    noun: 'Paid search',
    channel: c => c === 'paid search',
    source: key => /\bpaid\b|\bcpc\b|\bppc\b|\bads?\b/i.test(String(key || '')) && BLEND_SEARCH_ENGINES.test(String(key || ''))
  },
  paidAll: {
    label: 'All paid',
    noun: 'Paid',
    channel: c => c.startsWith('paid') || c === 'display' || c === 'cross-network',
    source: key => /\bpaid\b|\bcpc\b|\bppc\b|\bads?\b|\bdisplay\b/i.test(String(key || ''))
  },
  organicAll: {
    label: 'All organic',
    noun: 'Organic',
    channel: c => c.startsWith('organic'),
    source: key => /organic/i.test(String(key || ''))
  },
  social: {
    label: 'Social',
    noun: 'Social',
    channel: c => c.includes('social'),
    source: key => BLEND_NON_SEARCH_ORGANIC.test(String(key || ''))
  },
  direct: {
    label: 'Direct',
    noun: 'Direct',
    channel: c => c === 'direct',
    source: key => /^\s*direct\b/i.test(String(key || ''))
  },
  referral: {
    label: 'Referral',
    noun: 'Referral',
    channel: c => c === 'referral',
    source: key => /referr/i.test(String(key || ''))
  },
  all: {
    label: 'All traffic',
    noun: 'Total',
    channel: () => true,
    source: () => true
  }
};
let BLEND_SEGMENT = BLEND_SEGMENT_DEFAULT;
function blendSegment(){
  return BLEND_SEGMENTS[BLEND_SEGMENT] || BLEND_SEGMENTS[BLEND_SEGMENT_DEFAULT];
}
async function blendHydrateSegment(){
  try{
    const stored = await chrome.storage.local.get(BLEND_SEGMENT_KEY);
    const value = stored?.[BLEND_SEGMENT_KEY];
    if (value && BLEND_SEGMENTS[value]) BLEND_SEGMENT = value;
  }catch(_){ /* keep the default */ }
  const select = $('blendSegmentChoice');
  if (select) select.value = BLEND_SEGMENT;
}
function mountBlendSegment(){
  const select = $('blendSegmentChoice');
  if (!select) return;
  select.innerHTML = Object.entries(BLEND_SEGMENTS)
    .map(([id, seg]) => `<option value="${id}">${escapeHtml(seg.label)}</option>`).join('');
  select.value = BLEND_SEGMENT;
  select.addEventListener('change', async () => {
    const value = select.value;
    if (!BLEND_SEGMENTS[value]) return;
    BLEND_SEGMENT = value;
    try { await chrome.storage.local.set({ [BLEND_SEGMENT_KEY]: value }); } catch(_){}
    // Re-render what is already loaded. Nothing refetches until Run.
    if (BLEND.data) blendRenderAll();
  });
}
function blendShape(raw){
  const range = raw._range;
  const state = raw._state;
  const axis = blendDateAxis(range);

  const gaTrend = blendGaRows(raw.gaTrend, ['sessions', 'keyEvents']);
  const gaTrendPrev = blendGaRows(raw.gaTrendPrev, ['sessions', 'keyEvents']);
  // GA4's channel group is matched exactly. The old /organic/i test also swept
  // in Organic Social, Organic Video and Organic Shopping, which inflated the
  // figure sitting next to Search Console clicks.
  const segment = blendSegment();
  const matchChannelAt = index => row => segment.channel(String(row.dims?.[index] || '').trim().toLowerCase());
  const isOrganic = matchChannelAt(1);       // date x channel rows
  const isOrganicTotal = matchChannelAt(0);  // channel-only rows
  // Prefer the date-free totals; fall back to the trend if that request failed.
  const gaTotalsRows = blendGaRows(raw.gaTotals, ['sessions', 'keyEvents']);
  const gaTotalsPrevRows = blendGaRows(raw.gaTotalsPrev, ['sessions', 'keyEvents']);
  const sumTotals = (rows, trendRows, field, organicOnly) => rows.length
    ? blendSum(organicOnly ? rows.filter(isOrganicTotal) : rows, field)
    : blendSum(organicOnly ? trendRows.filter(isOrganic) : trendRows, field);

  const gscTrend = blendGscRows(raw.gscTrend);
  const gscTrendPrev = blendGscRows(raw.gscTrendPrev);
  // CallRail labels sources like "Google Organic", "Bing Organic",
  // "Facebook Organic". The word "organic" alone is not enough: Facebook
  // Organic is organic *social*, not organic *search*, and counting it here
  // would not reconcile against Search Console. So the source has to name a
  // search engine, or say "organic search" outright, and known social and
  // video networks are rejected even when they say organic.
  const isOrganicCall = row => segment.source(row.key);
  const crSource = blendCrRows(raw.crSource);
  const crSourcePrev = blendCrRows(raw.crSourcePrev);
  const crOrganic = crSource.filter(isOrganicCall);
  const crOrganicPrev = crSourcePrev.filter(isOrganicCall);
  const crTrend = blendCrRows(raw.crTrend);
  const crTrendPrev = blendCrRows(raw.crTrendPrev);

  const daily = {
    sessions: blendDailyMap(gaTrend.filter(isOrganic), 0, row => row.sessions),
    // Key events follow the same segment as sessions. They used to sum all
    // traffic while the card divided them by organic sessions and called the
    // result "of organic", which inflated the rate by whatever share of the
    // property is not organic.
    keyEvents: blendDailyMap(gaTrend.filter(isOrganic), 0, row => row.keyEvents),
    clicks: blendDailyMap(gscTrend, 0, row => row.clicks),
    calls: blendDailyMap(crTrend, 0, row => row.total_calls)
  };

  const totals = {
    sessions: sumTotals(gaTotalsRows, gaTrend, 'sessions', true),
    sessionsAll: sumTotals(gaTotalsRows, gaTrend, 'sessions', false),
    keyEvents: sumTotals(gaTotalsRows, gaTrend, 'keyEvents', true),
    keyEventsAll: sumTotals(gaTotalsRows, gaTrend, 'keyEvents', false),
    clicks: blendSum(gscTrend, 'clicks'),
    impressions: blendSum(gscTrend, 'impressions'),
    calls: crSource.length ? blendSum(crOrganic, 'total_calls') : blendSum(crTrend, 'total_calls'),
    callsAll: blendSum(crSource.length ? crSource : crTrend, 'total_calls'),
    missed: crSource.length ? blendSum(crOrganic, 'missed_calls') : blendSum(crTrend, 'missed_calls')
  };
  const prevTotals = {
    sessions: sumTotals(gaTotalsPrevRows, gaTrendPrev, 'sessions', true),
    sessionsAll: sumTotals(gaTotalsPrevRows, gaTrendPrev, 'sessions', false),
    keyEvents: sumTotals(gaTotalsPrevRows, gaTrendPrev, 'keyEvents', true),
    keyEventsAll: sumTotals(gaTotalsPrevRows, gaTrendPrev, 'keyEvents', false),
    clicks: blendSum(gscTrendPrev, 'clicks'),
    impressions: blendSum(gscTrendPrev, 'impressions'),
    calls: crSourcePrev.length ? blendSum(crOrganicPrev, 'total_calls') : blendSum(crTrendPrev, 'total_calls'),
    callsAll: blendSum(crSourcePrev.length ? crSourcePrev : crTrendPrev, 'total_calls'),
    missed: crSourcePrev.length ? blendSum(crOrganicPrev, 'missed_calls') : blendSum(crTrendPrev, 'missed_calls')
  };

  return {
    state,
    range,
    segment: BLEND_SEGMENT,
    segmentLabel: segment.label,
    segmentNoun: segment.noun,
    dataState: normalizeGscDataState(raw._dataState),
    prevRange: raw._prev,
    axis,
    daily,
    totals,
    prevTotals,
    available: {
      gsc: !!raw.gscTrend?.ok,
      ga: !!raw.gaTrend?.ok,
      cr: !!raw.crTrend?.ok || !!raw.crBreak?.ok
    },
    errors: {
      gsc: raw.gscTrend && !raw.gscTrend.ok ? raw.gscTrend.error : '',
      ga: raw.gaTrend && !raw.gaTrend.ok ? raw.gaTrend.error : '',
      cr: raw.crBreak && !raw.crBreak.ok ? raw.crBreak.error : ''
    },
    ga: {
      channels: Array.from(new Set(gaTrend.map(row => row.dims?.[1]).filter(Boolean))).sort(),
      byChannel: blendGaRows(raw.gaEventsByChannel, ['keyEvents', 'eventCount']),
      breakdown: blendGaRows(raw.gaBreak, ['sessions', 'keyEvents']),
      breakdownPrev: blendGaRows(raw.gaBreakPrev, ['sessions', 'keyEvents']),
      events: blendGaRows(raw.gaEvents, ['keyEvents', 'eventCount']),
      eventsPrev: blendGaRows(raw.gaEventsPrev, ['keyEvents', 'eventCount']),
      selectedEvents: state.ga.keyEvents || []
    },
    gsc: {
      breakdown: blendGscRows(raw.gscBreak),
      breakdownPrev: blendGscRows(raw.gscBreakPrev)
    },
    cr: {
      breakdown: blendCrRows(raw.crBreak),
      breakdownPrev: blendCrRows(raw.crBreakPrev),
      trendAvailable: !!raw.crTrend?.ok
    }
  };
}

/* ---------- KPI cards ---------- */
function blendKpiCard({ src, label, value, delta, sub, empty }){
  const meta = BLEND_SRC[src];
  return `
    <article class="blend-kpi ${empty ? 'is-empty' : ''}">
      <div class="blend-kpi__top">
        <span class="blend-kpi__src ${meta.cls}" aria-hidden="true"></span>
        <span class="blend-kpi__label">${escapeHtml(label)}</span>
      </div>
      <div class="blend-kpi__value">
        <strong>${escapeHtml(value)}</strong>
        ${delta ? `<span class="blend-kpi__delta ${escapeHtml(delta.cls || '')}">${escapeHtml(delta.text)}</span>` : ''}
      </div>
      <div class="blend-kpi__sub">${sub}</div>
    </article>
  `;
}
function blendRenderKpis(model){
  const host = $('blendKpis');
  if (!host) return;
  const compare = BLEND.compare;
  const d = (curr, prev, opts) => compare ? metricDelta(curr, prev, opts) : null;
  const totals = model.totals;
  const prev = model.prevTotals;

  const organicShare = totals.sessionsAll ? (totals.sessions / totals.sessionsAll) * 100 : 0;
  const cvr = totals.sessions ? (totals.keyEvents / totals.sessions) * 100 : 0;
  const eventLabel = model.ga.selectedEvents.length
    ? (model.ga.selectedEvents.length === 1 ? model.ga.selectedEvents[0] : `${model.ga.selectedEvents.length} selected events`)
    : 'All key events';
  const missedRate = totals.calls ? (totals.missed / totals.calls) * 100 : 0;
  const ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
  const crSources = BLEND.filters.crSources;
  const organicCallShare = totals.callsAll ? (totals.calls / totals.callsAll) * 100 : 0;
  const callSub = model.available.cr
    ? (totals.callsAll
        ? `<b>${organicCallShare.toFixed(0)}%</b> of ${escapeHtml(formatMetricValue(totals.callsAll))} calls · missed ${missedRate.toFixed(0)}%`
        : 'No calls in this range')
    : 'Connect CallRail in Settings';

  host.innerHTML = [
    blendKpiCard({
      src:'ga', label:`${model.segmentNoun} sessions`,
      value: model.available.ga ? formatMetricValue(totals.sessions) : '—',
      delta: model.available.ga ? d(totals.sessions, prev.sessions) : null,
      sub: model.available.ga
        ? `<b>${organicShare.toFixed(0)}%</b> of ${escapeHtml(formatMetricValue(totals.sessionsAll))} total sessions`
        : 'Pick a GA4 property',
      empty: !model.available.ga
    }),
    blendKpiCard({
      src:'ga', label:'Key events',
      value: model.available.ga ? formatMetricValue(totals.keyEvents) : '—',
      delta: model.available.ga ? d(totals.keyEvents, prev.keyEvents) : null,
      sub: model.available.ga
        ? `${escapeHtml(eventLabel)} · <b>${cvr.toFixed(2)}%</b> of ${escapeHtml(String(model.segmentNoun).toLowerCase())}`
        : 'Pick a GA4 property',
      empty: !model.available.ga
    }),
    blendKpiCard({
      src:'cr', label:`${model.segmentNoun} calls`,
      value: model.available.cr ? formatMetricValue(totals.calls) : '—',
      delta: model.available.cr ? d(totals.calls, prev.calls) : null,
      sub: callSub,
      empty: !model.available.cr
    }),
    blendKpiCard({
      src:'gsc', label:'Search clicks',
      value: model.available.gsc ? formatMetricValue(totals.clicks) : '—',
      delta: model.available.gsc ? d(totals.clicks, prev.clicks) : null,
      sub: model.available.gsc
        ? `<b>${escapeHtml(formatMetricValue(totals.impressions))}</b> impressions · ${ctr.toFixed(2)}% CTR`
        : 'Pick a Search Console property',
      empty: !model.available.gsc
    })
  ].join('');
}

/* ---------- interactive chart ---------- */
const BLEND_SERIES = [
  { key:'sessions',  label:'Organic sessions', colour:'#7f77dd' },
  { key:'clicks',    label:'Search clicks',    colour:'#39e07a' },
  { key:'keyEvents', label:'Key events',       colour:'#5dcaa5' },
  { key:'calls',     label:'Calls',            colour:'#f1b84a' }
];
function blendRenderChart(model){
  const host = $('blendChart');
  if (!host) return;
  const axis = model.axis;
  const active = BLEND_SERIES.filter(series => {
    const map = model.daily[series.key];
    return map && map.size && BLEND.series[series.key];
  });
  const anyData = BLEND_SERIES.some(series => model.daily[series.key]?.size);
  if (!anyData || axis.length < 2){
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');

  const W = 700, H = 180, PAD_L = 6, PAD_R = 6, PAD_T = 12, PAD_B = 22;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = index => PAD_L + (index * plotW / Math.max(1, axis.length - 1));

  const paths = active.map(series => {
    const values = axis.map(date => Number(model.daily[series.key].get(date) || 0));
    const max = Math.max(1, ...values);
    const y = value => PAD_T + plotH * (1 - (value / max));
    const d = values.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${series.colour}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".95"></path>`;
  }).join('');

  const gridlines = [0, 0.5, 1].map(fraction => {
    const y = PAD_T + plotH * fraction;
    return `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="1"></line>`;
  }).join('');

  const tickEvery = Math.max(1, Math.ceil(axis.length / 6));
  const ticks = axis.map((date, index) => {
    if (index % tickEvery !== 0 && index !== axis.length - 1) return '';
    return `<text x="${x(index).toFixed(1)}" y="${H - 6}" fill="rgba(136,168,150,.6)" font-size="10" text-anchor="middle">${escapeHtml(date.slice(5))}</text>`;
  }).join('');

  host.innerHTML = `
    <div class="blend-chart-head">
      <div>
        <div class="blend-chart-title">Daily trend</div>
        <div class="blend-chart-note">Each line is scaled to its own peak so shapes can be compared. Hover for exact values.</div>
      </div>
      <div class="blend-legend-toggles">
        ${BLEND_SERIES.filter(series => model.daily[series.key]?.size).map(series => `
          <button type="button" class="blend-legend-btn ${BLEND.series[series.key] ? 'is-on' : ''}" data-blend-series="${escapeHtml(series.key)}">
            <i style="background:${series.colour}"></i>${escapeHtml(series.label)}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="blend-plot" id="blendPlot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily trend across connected sources">
        ${gridlines}
        ${paths}
        ${ticks}
        <line id="blendCursor" x1="0" y1="${PAD_T}" x2="0" y2="${PAD_T + plotH}" stroke="rgba(255,255,255,.25)" stroke-width="1" opacity="0"></line>
        <rect class="blend-plot__hit" x="0" y="0" width="${W}" height="${H}" id="blendHit"></rect>
      </svg>
      <div class="blend-tip hidden" id="blendTip"></div>
    </div>
  `;
  blendBindChart(model, { W, PAD_L, plotW, axis });
}
function blendBindChart(model, geo){
  const plot = $('blendPlot');
  const hit = $('blendHit');
  const tip = $('blendTip');
  const cursor = $('blendCursor');
  if (!plot || !hit || !tip) return;

  const move = event => {
    const rect = plot.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const svgX = ratio * geo.W;
    const step = geo.plotW / Math.max(1, geo.axis.length - 1);
    const index = Math.min(geo.axis.length - 1, Math.max(0, Math.round((svgX - geo.PAD_L) / step)));
    const date = geo.axis[index];
    const rows = BLEND_SERIES
      .filter(series => model.daily[series.key]?.size && BLEND.series[series.key])
      .map(series => `<div class="blend-tip__row"><span><i style="background:${series.colour}"></i>${escapeHtml(series.label)}</span><strong>${escapeHtml(formatMetricValue(model.daily[series.key].get(date) || 0))}</strong></div>`)
      .join('');
    if (!rows){
      tip.classList.add('hidden');
      return;
    }
    tip.innerHTML = `<div class="blend-tip__date">${escapeHtml(date)}</div>${rows}`;
    tip.classList.remove('hidden');
    const left = geo.PAD_L + index * step;
    tip.style.left = `${(left / geo.W) * 100}%`;
    tip.style.top = `${rect.height * 0.62}px`;
    if (cursor){
      cursor.setAttribute('x1', left);
      cursor.setAttribute('x2', left);
      cursor.setAttribute('opacity', '1');
    }
  };
  hit.addEventListener('mousemove', move);
  hit.addEventListener('mouseleave', () => {
    tip.classList.add('hidden');
    if (cursor) cursor.setAttribute('opacity', '0');
  });
}

/* ---------- section rendering ---------- */
function blendSortRows(rows, sort){
  const dir = sort.dir < 0 ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const av = a[sort.col];
    const bv = b[sort.col];
    if (typeof av === 'string' || typeof bv === 'string'){
      return String(av || '').localeCompare(String(bv || '')) * dir;
    }
    return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
  });
}
function blendHeadCell(label, col, sort, numeric=true){
  const isSorted = sort.col === col;
  const caret = isSorted ? (sort.dir < 0 ? '▾' : '▴') : '';
  return `<th class="${numeric ? 'num' : ''} ${isSorted ? 'is-sorted' : ''}" data-blend-sort="${escapeHtml(col)}">${escapeHtml(label)}${caret ? `<span class="sort-caret">${caret}</span>` : ''}</th>`;
}
function blendDeltaTag(curr, prev){
  if (!BLEND.compare || prev == null) return '';
  const delta = Number(curr || 0) - Number(prev || 0);
  if (!Number.isFinite(delta) || Math.abs(delta) < 1) return '';
  return `<span class="blend-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${escapeHtml(formatMetricValue(Math.abs(delta)))}</span>`;
}
function blendBar(value, max, cls=''){
  const width = max ? Math.max(2, Math.round((Number(value || 0) / max) * 100)) : 0;
  return `<span class="blend-cellbar ${cls}" style="width:${width}%"></span>`;
}
function blendSectionShell({ src, title, subtitle, filters, body, id }){
  const meta = BLEND_SRC[src];
  return `
    <section class="blend-section" data-blend-section="${escapeHtml(id)}">
      <div class="blend-section__head">
        <div class="blend-section__title">
          <i style="background:${meta.colour}" aria-hidden="true"></i>
          <div>
            <strong>${escapeHtml(title)}</strong><br>
            <span>${escapeHtml(subtitle)}</span>
          </div>
        </div>
        <div class="blend-filters">${filters}</div>
      </div>
      ${body}
    </section>
  `;
}
function blendNoData(title, hint){
  return `<div class="blend-empty"><b>${escapeHtml(title)}</b>${escapeHtml(hint)}</div>`;
}
function blendGaOverviewSection(model){
  const dimOptions = [
    ['sessionDefaultChannelGroup', 'Channel'],
    ['landingPagePlusQueryString', 'Landing page'],
    ['country', 'Country'],
    ['deviceCategory', 'Device'],
    ['sessionSourceMedium', 'Source / medium']
  ];
  const filters = `
    <select data-blend-filter="gaDim" title="Break down by">
      ${dimOptions.map(([value, label]) => `<option value="${value}" ${BLEND.filters.gaDim === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select>
    <input type="search" data-blend-filter="gaSearch" placeholder="Filter rows" value="${escapeHtml(BLEND.filters.gaSearch)}" />
  `;
  if (!model.available.ga){
    return blendSectionShell({
      src:'ga', id:'gaOverview', title:'GA4 · Overview', subtitle:'Sessions and conversions',
      filters,
      body: blendNoData('GA4 not connected', model.errors.ga || 'Open the Google Analytics tab and pick a property, then run the report again.')
    });
  }
  const prevMap = new Map(model.ga.breakdownPrev.map(row => [row.key, row]));
  let rows = model.ga.breakdown.map(row => ({
    key: row.key,
    sessions: row.sessions,
    keyEvents: row.keyEvents,
    cvr: row.sessions ? row.keyEvents / row.sessions : 0,
    prevSessions: prevMap.get(row.key)?.sessions ?? null
  }));
  const search = BLEND.filters.gaSearch.trim().toLowerCase();
  if (search) rows = rows.filter(row => row.key.toLowerCase().includes(search));
  rows = blendSortRows(rows, BLEND.filters.gaSort);
  const shown = rows.slice(0, BLEND.filters.rows);
  const max = Math.max(1, ...shown.map(row => row.sessions));
  const sort = BLEND.filters.gaSort;

  if (!shown.length){
    return blendSectionShell({
      src:'ga', id:'gaOverview', title:'GA4 · Overview', subtitle:'Sessions and conversions', filters,
      body: blendNoData('No rows match', 'Clear the filter or widen the date range.')
    });
  }
  return blendSectionShell({
    src:'ga', id:'gaOverview',
    title:'GA4 · Overview',
    subtitle:`${formatMetricValue(rows.length)} rows by ${(dimOptions.find(item => item[0] === BLEND.filters.gaDim) || [,'dimension'])[1].toLowerCase()}`,
    filters,
    body:`
      <div class="blend-table-shell">
        <table class="blend-table">
          <thead><tr>
            ${blendHeadCell('Name', 'key', sort, false)}
            ${blendHeadCell('Sessions', 'sessions', sort)}
            ${blendHeadCell('Key events', 'keyEvents', sort)}
            ${blendHeadCell('CVR', 'cvr', sort)}
          </tr></thead>
          <tbody>
            <tr class="is-total">
              <td>All rows</td>
              <td class="num">${escapeHtml(formatMetricValue(blendSum(rows, 'sessions')))}</td>
              <td class="num">${escapeHtml(formatMetricValue(blendSum(rows, 'keyEvents')))}</td>
              <td class="num">${blendSum(rows, 'sessions') ? ((blendSum(rows, 'keyEvents') / blendSum(rows, 'sessions')) * 100).toFixed(2) : '0.00'}%</td>
            </tr>
            ${shown.map(row => `
              <tr>
                <td><span class="blend-name" title="${escapeHtml(row.key)}">${escapeHtml(row.key || '—')}</span></td>
                <td class="num">${escapeHtml(formatMetricValue(row.sessions))}${blendDeltaTag(row.sessions, row.prevSessions)}${blendBar(row.sessions, max, 'ga')}</td>
                <td class="num">${escapeHtml(formatMetricValue(row.keyEvents))}</td>
                <td class="num">${(row.cvr * 100).toFixed(2)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length > shown.length ? `<div class="blend-more">Showing top ${shown.length} of ${formatMetricValue(rows.length)} rows.</div>` : ''}
      </div>
    `
  });
}
function blendGaEventsSection(model){
  const selected = model.ga.selectedEvents;
  const filters = `<input type="search" data-blend-filter="keySearch" placeholder="Filter events" value="${escapeHtml(BLEND.filters.keySearch || '')}" />`;
  if (!model.available.ga){
    return blendSectionShell({
      src:'ga', id:'gaEvents', title:'GA4 · Key events', subtitle:'Conversion events', filters,
      body: blendNoData('GA4 not connected', 'Pick a GA4 property in the Google Analytics tab.')
    });
  }
  const prevMap = new Map(model.ga.eventsPrev.map(row => [row.key, row]));
  const channelSel = BLEND.filters.keyChannels;
  const channelActive = !!(channelSel && channelSel.size);
  // With a channel filter on, totals must come from the event x channel report
  // rather than the event totals, or the numbers would ignore the filter.
  let rows;
  if (channelActive){
    const byEvent = new Map();
    (model.ga.byChannel || []).forEach(row => {
      const eventName = row.dims?.[0] || '';
      const channel = row.dims?.[1] || '';
      if (!eventName || !channelSel.has(channel)) return;
      const entry = byEvent.get(eventName) || { key:eventName, keyEvents:0, eventCount:0 };
      entry.keyEvents += row.keyEvents;
      entry.eventCount += row.eventCount;
      byEvent.set(eventName, entry);
    });
    rows = Array.from(byEvent.values()).map(row => Object.assign(row, { prev:null }));
  }else{
    rows = model.ga.events.map(row => ({
      key: row.key,
      keyEvents: row.keyEvents,
      eventCount: row.eventCount,
      prev: prevMap.get(row.key)?.keyEvents ?? null
    }));
  }
  const search = (BLEND.filters.keySearch || '').trim().toLowerCase();
  if (search) rows = rows.filter(row => row.key.toLowerCase().includes(search));
  rows = blendSortRows(rows, BLEND.filters.keySort);
  if (!rows.length){
    return blendSectionShell({
      src:'ga', id:'gaEvents', title:'GA4 · Key events', subtitle:'Conversion events', filters,
      body: blendNoData('No key events recorded', selected.length
        ? 'The selected events did not fire in this range. Try widening the date range or changing the selection in the Google Analytics tab.'
        : 'This property has no key events in this range.')
    });
  }
  const max = Math.max(1, ...rows.map(row => row.keyEvents));
  const sort = BLEND.filters.keySort;
  return blendSectionShell({
    src:'ga', id:'gaEvents',
    title:'GA4 · Key events',
    subtitle: selected.length ? `${selected.length} of the property's key events selected` : 'All key events',
    filters,
    body:`
      ${blendChannelChips(model)}
      ${channelActive ? `<div class="blend-hint">Filtered to ${escapeHtml(Array.from(channelSel).join(', '))}. Period comparison is unavailable while a channel filter is active.</div>` : ''}
      <div class="blend-table-shell">
        <table class="blend-table">
          <thead><tr>
            ${blendHeadCell('Event', 'key', sort, false)}
            ${blendHeadCell('Key events', 'keyEvents', sort)}
            ${blendHeadCell('Event count', 'eventCount', sort)}
          </tr></thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td><span class="blend-name" title="${escapeHtml(row.key)}">${escapeHtml(row.key || '—')}</span></td>
                <td class="num">${escapeHtml(formatMetricValue(row.keyEvents))}${blendDeltaTag(row.keyEvents, row.prev)}${blendBar(row.keyEvents, max, 'ga')}</td>
                <td class="num">${escapeHtml(formatMetricValue(row.eventCount))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  });
}
function blendCrSection(model){
  const groupOptions = [
    ['source', 'Source'],
    ['campaign', 'Campaign'],
    ['keywords', 'Keywords'],
    ['referrer', 'Referrer'],
    ['landing_page', 'Landing page']
  ];
  const filters = `
    <select data-blend-filter="crGroup" title="Group calls by">
      ${groupOptions.map(([value, label]) => `<option value="${value}" ${BLEND.filters.crGroup === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select>
  `;
  if (!model.available.cr){
    return blendSectionShell({
      src:'cr', id:'callrail', title:'CallRail · Calls', subtitle:'Call attribution', filters,
      body: blendNoData('CallRail not connected', model.errors.cr || 'Add your API key in Settings and pick an account, then run the report again.')
    });
  }
  const all = model.cr.breakdown;
  if (!all.length){
    return blendSectionShell({
      src:'cr', id:'callrail', title:'CallRail · Calls', subtitle:'Call attribution', filters,
      body: blendNoData('No calls in this range', 'Try a longer date range, or check the company selection in the CallRail tab.')
    });
  }
  const selected = BLEND.filters.crSources;
  const isOn = key => !selected || !selected.size || selected.has(key);
  const chips = all.slice(0, 12).map(row => `
    <button type="button" class="blend-chip ${isOn(row.key) ? 'is-on' : ''}" data-blend-source="${escapeHtml(row.key)}">
      <span>${escapeHtml(row.key || 'Unattributed')}</span>
      <span class="blend-chip__n">${escapeHtml(formatMetricValue(row.total_calls))}</span>
    </button>
  `).join('');

  const prevMap = new Map(model.cr.breakdownPrev.map(row => [row.key, row]));
  let rows = all.filter(row => isOn(row.key)).map(row => ({
    key: row.key,
    total_calls: row.total_calls,
    answered_calls: row.answered_calls,
    missed_calls: row.missed_calls,
    first_time_callers: row.first_time_callers,
    missedRate: row.total_calls ? row.missed_calls / row.total_calls : 0,
    duration: row.formatted_average_duration || formatDurationShort(row.average_duration),
    prev: prevMap.get(row.key)?.total_calls ?? null
  }));
  rows = blendSortRows(rows, BLEND.filters.crSort);
  const shown = rows.slice(0, BLEND.filters.rows);
  const max = Math.max(1, ...shown.map(row => row.total_calls));
  const sort = BLEND.filters.crSort;

  return blendSectionShell({
    src:'cr', id:'callrail',
    title:'CallRail · Calls',
    subtitle:`${formatMetricValue(rows.length)} of ${formatMetricValue(all.length)} ${BLEND.filters.crGroup.replace('_', ' ')} rows`,
    filters,
    body:`
      <div class="blend-chiprow">${chips}${all.length > 12 ? `<span class="blend-chip" style="cursor:default">+${all.length - 12} more</span>` : ''}</div>
      <div class="blend-table-shell">
        <table class="blend-table">
          <thead><tr>
            ${blendHeadCell('Name', 'key', sort, false)}
            ${blendHeadCell('Calls', 'total_calls', sort)}
            ${blendHeadCell('Answered', 'answered_calls', sort)}
            ${blendHeadCell('Missed %', 'missedRate', sort)}
            ${blendHeadCell('First-time', 'first_time_callers', sort)}
          </tr></thead>
          <tbody>
            <tr class="is-total">
              <td>Selected sources</td>
              <td class="num">${escapeHtml(formatMetricValue(blendSum(rows, 'total_calls')))}</td>
              <td class="num">${escapeHtml(formatMetricValue(blendSum(rows, 'answered_calls')))}</td>
              <td class="num">${blendSum(rows, 'total_calls') ? ((blendSum(rows, 'missed_calls') / blendSum(rows, 'total_calls')) * 100).toFixed(0) : '0'}%</td>
              <td class="num">${escapeHtml(formatMetricValue(blendSum(rows, 'first_time_callers')))}</td>
            </tr>
            ${shown.map(row => `
              <tr>
                <td><span class="blend-name" title="${escapeHtml(row.key)}">${escapeHtml(row.key || 'Unattributed')}</span></td>
                <td class="num">${escapeHtml(formatMetricValue(row.total_calls))}${blendDeltaTag(row.total_calls, row.prev)}${blendBar(row.total_calls, max, 'cr')}</td>
                <td class="num">${escapeHtml(formatMetricValue(row.answered_calls))}</td>
                <td class="num">${(row.missedRate * 100).toFixed(0)}%</td>
                <td class="num">${escapeHtml(formatMetricValue(row.first_time_callers))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length > shown.length ? `<div class="blend-more">Showing top ${shown.length} of ${formatMetricValue(rows.length)} rows.</div>` : ''}
      </div>
    `
  });
}
function blendGscSection(model){
  const filters = `
    <select data-blend-filter="gscDim" title="Break down by">
      <option value="page" ${BLEND.filters.gscDim === 'page' ? 'selected' : ''}>Page</option>
      <option value="query" ${BLEND.filters.gscDim === 'query' ? 'selected' : ''}>Query</option>
      <option value="country" ${BLEND.filters.gscDim === 'country' ? 'selected' : ''}>Country</option>
      <option value="device" ${BLEND.filters.gscDim === 'device' ? 'selected' : ''}>Device</option>
    </select>
    <input type="search" data-blend-filter="gscSearch" placeholder="Filter rows" value="${escapeHtml(BLEND.filters.gscSearch)}" />
  `;
  if (!model.available.gsc){
    return blendSectionShell({
      src:'gsc', id:'gsc', title:'Search Console · Performance', subtitle:'Clicks and impressions', filters,
      body: blendNoData('Search Console not connected', model.errors.gsc || 'Pick a property at the top of the panel, then run the report again.')
    });
  }
  const prevMap = new Map(model.gsc.breakdownPrev.map(row => [row.key, row]));
  let rows = model.gsc.breakdown.map(row => ({
    key: row.key,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    prev: prevMap.get(row.key)?.clicks ?? null
  }));
  const search = BLEND.filters.gscSearch.trim().toLowerCase();
  if (search) rows = rows.filter(row => row.key.toLowerCase().includes(search));
  rows = blendSortRows(rows, BLEND.filters.gscSort);
  const shown = rows.slice(0, BLEND.filters.rows);
  if (!shown.length){
    return blendSectionShell({
      src:'gsc', id:'gsc', title:'Search Console · Performance', subtitle:'Clicks and impressions', filters,
      body: blendNoData('No rows match', 'Clear the filter or widen the date range.')
    });
  }
  const max = Math.max(1, ...shown.map(row => row.clicks));
  const sort = BLEND.filters.gscSort;
  const totalClicks = blendSum(rows, 'clicks');
  const totalImpr = blendSum(rows, 'impressions');
  return blendSectionShell({
    src:'gsc', id:'gsc',
    title:'Search Console · Performance',
    subtitle:`${formatMetricValue(rows.length)} rows by ${BLEND.filters.gscDim}`,
    filters,
    body:`
      <div class="blend-table-shell">
        <table class="blend-table">
          <thead><tr>
            ${blendHeadCell('Name', 'key', sort, false)}
            ${blendHeadCell('Clicks', 'clicks', sort)}
            ${blendHeadCell('Impressions', 'impressions', sort)}
            ${blendHeadCell('CTR', 'ctr', sort)}
            ${blendHeadCell('Position', 'position', sort)}
          </tr></thead>
          <tbody>
            <tr class="is-total">
              <td>All rows</td>
              <td class="num">${escapeHtml(formatMetricValue(totalClicks))}</td>
              <td class="num">${escapeHtml(formatMetricValue(totalImpr))}</td>
              <td class="num">${totalImpr ? ((totalClicks / totalImpr) * 100).toFixed(2) : '0.00'}%</td>
              <td class="num">—</td>
            </tr>
            ${shown.map(row => `
              <tr>
                <td><span class="blend-name" title="${escapeHtml(row.key)}">${escapeHtml(row.key || '—')}</span></td>
                <td class="num">${escapeHtml(formatMetricValue(row.clicks))}${blendDeltaTag(row.clicks, row.prev)}${blendBar(row.clicks, max)}</td>
                <td class="num">${escapeHtml(formatMetricValue(row.impressions))}</td>
                <td class="num">${(row.ctr * 100).toFixed(2)}%</td>
                <td class="num">${row.position ? row.position.toFixed(1) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length > shown.length ? `<div class="blend-more">Showing top ${shown.length} of ${formatMetricValue(rows.length)} rows.</div>` : ''}
      </div>
    `
  });
}
function blendRenderSections(model){
  const host = $('blendSections');
  if (!host) return;
  host.innerHTML = [
    blendGaOverviewSection(model),
    blendGaEventsSection(model),
    blendCrSection(model),
    blendGscSection(model)
  ].join('');
}
function blendRenderAll(){
  const model = BLEND.data;
  if (!model) return;
  blendRenderKpis(model);
  blendRenderChart(model);
  blendRenderSections(model);
}

/* ---------- Command Centre inline source selectors ---------- */
function blendOptionList(items, current){
  return items.map(item => `<option value="${escapeHtml(item.value)}" ${String(item.value) === String(current) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
}
function blendSourceField({ id, src, label, options, current, disabled, emptyLabel, placeholder, on }){
  const meta = BLEND_SRC[src];
  return `
    <label class="blend-src ${on ? 'is-on' : 'is-off'}">
      <span class="blend-src__label">
        <i class="blend-dot ${meta.cls}" aria-hidden="true"></i>
        <span class="blend-src__name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <b class="blend-src__state">${on ? 'Connected' : 'Not set'}</b>
      </span>
      <select id="${escapeHtml(id)}" ${disabled ? 'disabled' : ''}>
        ${placeholder ? `<option value="">${escapeHtml(disabled ? emptyLabel : placeholder)}</option>` : ''}
        ${blendOptionList(options, current)}
      </select>
    </label>
  `;
}
function blendRenderSelectors(){
  const host = $('blendSources');
  if (!host) return;
  const state = blendConnectorState();

  const siteOptions = Array.from($('sites')?.options || []).map(option => ({
    value: option.value,
    label: String(option.textContent || option.value || '').replace(/\s{2,}/g, ' ').replace(/\s*\(site\w+\)\s*$/, '').trim()
  }));
  const gaOptions = (GA.props || []).map(item => ({ value: item.id, label: String(item.displayName || item.id || '') }));
  const crAccounts = Array.from($('crAccount')?.options || []).map(option => ({
    value: option.value, label: String(option.textContent || option.value || '').replace(/\s*•.*$/, '').trim()
  }));
  const crCompanies = Array.from($('crCompany')?.options || []).map(option => ({
    value: option.value, label: String(option.textContent || option.value || '')
  }));

  const events = state.ga.propertyId ? gaGetCurrentKeyEvents(state.ga.propertyId) : [];
  const selectedEvents = new Set(state.ga.keyEvents || []);
  const activeCount = selectedEvents.size || events.length;

  host.innerHTML = `
    <div class="blend-src-grid">
      ${blendSourceField({ id:'blendSite', src:'gsc', label:'Search Console', options:siteOptions,
        current:$('sites')?.value || '', disabled:!siteOptions.length,
        emptyLabel:'Sign in to load', placeholder:'Select property', on:state.gsc.on })}
      ${blendSourceField({ id:'blendGaProp', src:'ga', label:'GA4 property', options:gaOptions,
        current:state.ga.propertyId, disabled:!gaOptions.length,
        emptyLabel:'Sign in to load', placeholder:'Select property', on:state.ga.on })}
      ${blendSourceField({ id:'blendCrAccount', src:'cr', label:'CallRail account', options:crAccounts,
        current:state.cr.accountId, disabled:!crAccounts.length,
        emptyLabel:'Add key in Settings', placeholder:'Select account', on:state.cr.on })}
      ${blendSourceField({ id:'blendCrCompany', src:'cr', label:'CallRail company', options:crCompanies,
        current:state.cr.companyId, disabled:!crCompanies.length,
        emptyLabel:'Pick an account first', placeholder:'', on:!!state.cr.accountId })}
    </div>

    ${state.ga.propertyId && events.length ? `
      <details class="blend-events" ${BLEND.eventsOpen ? 'open' : ''}>
        <summary>
          <span><i class="blend-dot src-ga" aria-hidden="true"></i>Key events</span>
          <span class="blend-events__count">${escapeHtml(formatMetricValue(activeCount))} of ${escapeHtml(formatMetricValue(events.length))} selected</span>
        </summary>
        <div class="blend-events__body">
          <div class="blend-events__actions">
            <button type="button" class="blend-mini" data-blend-events="all">Select all</button>
            <button type="button" class="blend-mini" data-blend-events="none">Clear</button>
          </div>
          <div class="blend-chiprow" id="blendEventChips">
            ${events.map(item => `
              <button type="button" class="blend-chip ${selectedEvents.size === 0 || selectedEvents.has(item.eventName) ? 'is-on' : ''}" data-blend-event="${escapeHtml(item.eventName)}">
                <span>${escapeHtml(item.eventName)}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </details>
    ` : ''}
  `;
}
async function blendApplySite(value){
  const select = $('sites');
  if (!select) return;
  select.value = value;
  try { syncSitePickerLabel?.(); } catch(_){}
  try { updatePropertyContext?.(); } catch(_){}
}
async function blendApplyGaProperty(value){
  if (typeof gaSetSelectedProperty === 'function'){
    try { await gaSetSelectedProperty(value); } catch(_){}
  } else if ($('gaProps')){
    $('gaProps').value = value;
  }
  await blendEnsureKeyEvents();
}
async function blendApplyCrAccount(value){
  const select = $('crAccount');
  if (!select) return;
  select.value = value;
  // Chosen from the blended report, so no change event fires on the CallRail
  // panel's own select. Record it the same way the GA4 property does.
  if (typeof sessionSelectionRecord === 'function') sessionSelectionRecord('crAccount', value);
  if (typeof crLoadCompanies === 'function'){
    try { await crLoadCompanies(); } catch(_){}
  }
}
function blendToggleEvent(eventName){
  const propertyId = gaCurrentPropertyId();
  if (!propertyId) return;
  const available = gaGetCurrentKeyEvents(propertyId).map(item => item.eventName);
  // Without the loaded list there is nothing to seed "all" from, and the click
  // would store a single event - turning a deselect into "show only this one",
  // which reads as the card emptying out. Do nothing until the list is there.
  if (!available.length) return;
  const current = new Set(gaGetSelectedKeyEvents(propertyId));
  // An empty stored selection means "all", so the first click has to start from
  // the full list or deselecting one event would look like selecting one.
  if (!current.size) available.forEach(name => current.add(name));
  // Clearing the last one means "all" again rather than "none", which would
  // otherwise render an empty card with no way back.
  if (current.size === 1 && current.has(eventName)){
    GA.keyEventSelections[propertyId] = [];
    void gaSetStored({ [GA_STORAGE_KEYS.selections]: GA.keyEventSelections });
    return;
  }
  if (current.has(eventName)) current.delete(eventName);
  else current.add(eventName);
  GA.keyEventSelections[propertyId] = Array.from(current);
  void gaSetStored({ [GA_STORAGE_KEYS.selections]: GA.keyEventSelections });
}
function blendSetAllEvents(mode){
  const propertyId = gaCurrentPropertyId();
  if (!propertyId) return;
  const available = gaGetCurrentKeyEvents(propertyId).map(item => item.eventName);
  GA.keyEventSelections[propertyId] = mode === 'all' ? available.slice() : [];
  void gaSetStored({ [GA_STORAGE_KEYS.selections]: GA.keyEventSelections });
}

/* ---------- channel filter for the key-events table ---------- */
function blendChannelOptions(model){
  const set = new Set();
  (model?.ga?.channels || []).forEach(name => { if (name) set.add(name); });
  return Array.from(set).sort();
}
function blendChannelChips(model){
  const options = blendChannelOptions(model);
  if (!options.length) return '';
  const selected = BLEND.filters.keyChannels;
  const isOn = name => !selected || !selected.size || selected.has(name);
  return `
    <div class="blend-chiprow blend-chiprow--tight">
      ${options.map(name => `
        <button type="button" class="blend-chip ${isOn(name) ? 'is-on' : ''}" data-blend-channel="${escapeHtml(name)}">
          <span>${escapeHtml(name)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

/* ---------- session restore ---------- */
async function blendPersist(){
  if (!BLEND.data) return;
  const model = BLEND.data;
  await sessionSet(SESSION_KEYS.blend, {
    savedAt: Date.now(),
    range: model.range,
    prevRange: model.prevRange,
    compare: BLEND.compare,
    filters: Object.assign({}, BLEND.filters, {
      crSources: BLEND.filters.crSources ? Array.from(BLEND.filters.crSources) : null,
      keyChannels: BLEND.filters.keyChannels ? Array.from(BLEND.filters.keyChannels) : null
    }),
    series: BLEND.series,
    model: Object.assign({}, model, { daily: sessionPackMaps(model.daily) })
  });
}
async function blendRestore(){
  const saved = await sessionGet(SESSION_KEYS.blend);
  if (!saved?.model) return false;
  try{
    if (!saved.model.dataState || normalizeGscDataState(saved.model.dataState) !== currentGscDataState()) return false;
    BLEND.compare = !!saved.compare;
    BLEND.series = Object.assign(BLEND.series, saved.series || {});
    const filters = Object.assign({}, saved.filters || {});
    filters.crSources = Array.isArray(filters.crSources) ? new Set(filters.crSources) : null;
    filters.keyChannels = Array.isArray(filters.keyChannels) ? new Set(filters.keyChannels) : null;
    BLEND.filters = Object.assign(BLEND.filters, filters);
    BLEND.data = Object.assign({}, saved.model, { daily: sessionUnpackMaps(saved.model.daily) });
    BLEND.range = saved.range || null;

    const rangeEl = $('blendRange');
    if (rangeEl && saved.rangeMode) rangeEl.value = saved.rangeMode;
    const compareEl = $('blendCompare');
    if (compareEl) compareEl.checked = BLEND.compare;

    blendRenderAll();
    setCacheNote('blendCacheStatus', { source:'cache', fetchedAt: saved.savedAt }, {
      cached: 'Restored from this browser session'
    });
    return true;
  }catch(_){
    return false;
  }
}

/* ---------- orchestration ---------- */
async function blendRun({ forceRefresh=false, refetch=true } = {}){
  if (BLEND.loading) return;
  if (!refetch && BLEND.data){
    blendRenderAll();
    return;
  }
  await blendEnsureKeyEvents();
  blendRenderConnectors();
  blendRenderSelectors();
  const state = blendConnectorState();
  if (!state.gsc.on && !state.ga.on && !state.cr.on){
    renderHtml('blendResult', statusCard('Connect at least one source. Pick a Search Console property above, a GA4 property in the Analytics tab, or a CallRail account in Settings.'));
    return;
  }

  BLEND.loading = true;
  renderHtml('blendResult', statusCard(forceRefresh ? 'Refreshing every connected source…' : 'Pulling Search Console, GA4 and CallRail…'));
  try{
    const raw = await blendFetchAll({ forceRefresh });
    const attempted = [
      raw._state?.gsc?.on ? raw.gscTrend : null,
      raw._state?.ga?.on ? raw.gaTrend : null,
      raw._state?.cr?.on ? raw.crBreak : null
    ].filter(Boolean);
    if (attempted.length && attempted.every(result => !result.ok)){
      throw apiErrorFromResponse(attempted[0], 'Connected sources could not be loaded.');
    }
    BLEND.data = blendShape(raw);
    renderHtml('blendResult', '');
    blendRenderAll();
    void blendPersist();
    setCacheNote('blendCacheStatus', { source: forceRefresh ? 'network' : 'mixed', fetchedAt: Date.now() }, {
      network: 'Blended report refreshed',
      mixed: 'Blended report updated'
    });
  }catch(e){
    renderApiError('blendResult', e, 'blendRefresh');
  }finally{
    BLEND.loading = false;
  }
}
async function blendEnsureSources(){
  // The blended panel is the landing tab, so the GA4 and CallRail pickers may
  // never have been opened. Initialise them here or their columns come back
  // empty and the report looks broken rather than unconfigured.
  const tasks = [];
  if (typeof loadGaPropsOnce === 'function' && !(GA.props || []).length){
    tasks.push(loadGaPropsOnce().catch(() => {}));
  }
  if (typeof crEnsureInit === 'function' && !$('crAccount')?.options?.length){
    tasks.push(crEnsureInit().catch(() => {}));
  }
  if (tasks.length) await Promise.all(tasks);
  await blendEnsureKeyEvents();
  blendRenderConnectors();
  blendRenderSelectors();
}
async function blendEnsureKeyEvents(){
  // gaGetSelectedKeyEvents() validates the saved selection against the list of
  // events loaded for the property. Without that list the selection is silently
  // discarded and the report falls back to every key event, so load it first.
  const propertyId = typeof gaCurrentPropertyId === 'function' ? gaCurrentPropertyId() : '';
  if (!propertyId) return;
  if ((GA.keyEventsByProperty?.[propertyId] || []).length) return;
  if (typeof gaLoadKeyEvents !== 'function') return;
  try { await gaLoadKeyEvents(propertyId); } catch(_) { /* selection stays unfiltered */ }
}
function mountBlend(){
  on('blendRun', 'click', () => { void blendRun(); });
  on('blendRefresh', 'click', () => { void blendRun({ forceRefresh:true }); });
  on('blendRange', 'change', () => {
    const custom = $('blendRange')?.value === 'custom';
    setDateRangeMode('blendRange', 'blendStart', custom, { open:custom });
    // Changing the range no longer refetches; press Run.
  });
  /* Nothing re-fetches on a control change; Run and the refresh icon are the
     only things that spend API quota. */

  // Delegated: inline handlers are blocked by the extension CSP.
  const sections = $('blendSections');
  sections?.addEventListener('click', event => {
    const sortCol = event.target?.closest?.('[data-blend-sort]')?.getAttribute('data-blend-sort');
    if (sortCol){
      const sectionId = event.target.closest('[data-blend-section]')?.getAttribute('data-blend-section');
      const key = { gaOverview:'gaSort', gaEvents:'keySort', callrail:'crSort', gsc:'gscSort' }[sectionId];
      if (key){
        const current = BLEND.filters[key];
        BLEND.filters[key] = current.col === sortCol
          ? { col:sortCol, dir: current.dir * -1 }
          : { col:sortCol, dir: -1 };
        blendRenderSections(BLEND.data);
      }
      return;
    }
    const channel = event.target?.closest?.('[data-blend-channel]')?.getAttribute('data-blend-channel');
    if (channel != null){
      if (!BLEND.filters.keyChannels) BLEND.filters.keyChannels = new Set();
      const set = BLEND.filters.keyChannels;
      if (set.has(channel)) set.delete(channel);
      else set.add(channel);
      blendRenderSections(BLEND.data);
      void blendPersist();
      return;
    }
    const source = event.target?.closest?.('[data-blend-source]')?.getAttribute('data-blend-source');
    if (source != null){
      if (!BLEND.filters.crSources) BLEND.filters.crSources = new Set();
      const set = BLEND.filters.crSources;
      if (set.has(source)) set.delete(source);
      else set.add(source);
      // An empty set means "all", so a full deselect reads as no filter.
      blendRenderSections(BLEND.data);
      blendRenderKpis(BLEND.data);
    }
  });
  sections?.addEventListener('change', event => {
    const filter = event.target?.getAttribute?.('data-blend-filter');
    if (!filter) return;
    BLEND.filters[filter] = event.target.value;
    // Dimension and grouping changes need new data; text filters do not.
    if (filter === 'gaDim' || filter === 'gscDim' || filter === 'crGroup'){
      if (filter === 'crGroup') BLEND.filters.crSources = null;
      void blendRun();
    }else{
      blendRenderSections(BLEND.data);
    }
  });
  sections?.addEventListener('input', event => {
    const filter = event.target?.getAttribute?.('data-blend-filter');
    if (!filter || !/Search$/.test(filter)) return;
    BLEND.filters[filter] = event.target.value;
    blendRenderSections(BLEND.data);
  });

  $('blendChart')?.addEventListener('click', event => {
    const key = event.target?.closest?.('[data-blend-series]')?.getAttribute('data-blend-series');
    if (!key) return;
    BLEND.series[key] = !BLEND.series[key];
    blendRenderChart(BLEND.data);
  });
  $('blendConnectors')?.addEventListener('click', event => {
    const nav = event.target?.closest?.('[data-blend-nav]')?.getAttribute('data-blend-nav');
    if (nav) $(nav)?.click();
  });

  const sources = $('blendSources');
  sources?.addEventListener('change', async event => {
    const id = event.target?.id;
    if (id === 'blendSite') await blendApplySite(event.target.value);
    else if (id === 'blendGaProp') await blendApplyGaProperty(event.target.value);
    else if (id === 'blendCrAccount') await blendApplyCrAccount(event.target.value);
    else if (id === 'blendCrCompany' && $('crCompany')){
      $('crCompany').value = event.target.value;
      if (typeof sessionSelectionRecord === 'function') sessionSelectionRecord('crCompany', event.target.value);
    }
    else return;
    blendRenderConnectors();
    blendRenderSelectors();
  });
  sources?.addEventListener('toggle', event => {
    if (event.target?.tagName === 'DETAILS') BLEND.eventsOpen = event.target.open;
  }, true);
  sources?.addEventListener('click', event => {
    const eventName = event.target?.closest?.('[data-blend-event]')?.getAttribute('data-blend-event');
    if (eventName){
      blendToggleEvent(eventName);
      blendRenderSelectors();
      return;
    }
    const bulk = event.target?.closest?.('[data-blend-events]')?.getAttribute('data-blend-events');
    if (bulk){
      blendSetAllEvents(bulk);
      blendRenderSelectors();
    }
  });

  blendRenderConnectors();
  blendRenderSelectors();
  void blendRestore();
}

/* ==========================================================================
   SIDE PANEL
   ========================================================================== */
function mountSidePanel(){
  const button = $('openSidePanel');
  if (!button) return;
  if (!chrome.sidePanel){
    button.hidden = true;
    return;
  }
  if (document.documentElement.dataset.mode === 'panel'){
    button.hidden = true;
    return;
  }
  button.addEventListener('click', async () => {
    try{
      const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    }catch(e){
      clearResult('Could not open the side panel: ' + (e?.message || e));
    }
  });
}

/* ---------- INIT ---------- */
async function init(){
  await initSidebarUX();
  await gaHydrateState();
  await hydrateGscDataState();
  const retryTargets = new Set(['refreshSites', 'inspect', 'refreshPerf', 'blendRefresh', 'crRefreshData', 'gaRefreshData']);
  document.addEventListener('click', event => {
    const nav = event.target?.closest?.('[data-status-nav]')?.getAttribute('data-status-nav');
    if (nav === 'navSettings'){
      event.preventDefault();
      $('navSettings')?.click();
      return;
    }
    const retry = event.target?.closest?.('[data-status-retry]')?.getAttribute('data-status-retry');
    if (retry && retryTargets.has(retry)){
      event.preventDefault();
      $(retry)?.click();
    }
  });
  const manifest = chrome.runtime.getManifest();
  const versionText = (manifest.version_name || manifest.version || '0').replace(/\s+-\s+/g, ' · ');
  $('version').textContent = versionText;

  clearResult('Pick a property.');
  mountNav();
  void mountPanelEmptyStates();
  void mountSessionSelections();
  mountBlendSegment();
  void blendHydrateSegment();
  mountWorkspaces();
  mountAccountSwitcher();
  mountPerf();
  mountCallRail();
  mountBlend();
  mountDateRanges();
  mountSidePanel();
  let googleSyncTimer = null;
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!['googleAccounts', 'activeGoogleEmail', 'accountProfile', 'googleAuthProvider', 'chromeGoogleProfile'].some(key => Object.prototype.hasOwnProperty.call(changes, key))) return;
    clearTimeout(googleSyncTimer);
    googleSyncTimer = setTimeout(() => {
      void Promise.all([setAccountLabel(), renderAccountSwitcher()]);
    }, 25);
  });
  await consumeGoogleAuthEvent();
  const googleEmail = await setAccountLabel();

  // prefill active tab url
  const tabUrlRaw = await getActiveTabUrl().catch(()=> '');
  const tabUrl = tabUrlRaw ? normalizeUrl(tabUrlRaw) : '';
  if (tabUrl && $('inspectUrl')) $('inspectUrl').value = tabUrl;

  // load sites
  if (googleEmail){
    try{
      await loadSites();
      clearResult('');
    }catch(e){
      renderHtml('result', statusCardForError(e, { retryTarget:'refreshSites' }));
    }
  } else {
    clearResult('Connect Google in Settings to load Search Console data.');
  }

  // input enables
  $('inspectUrl').addEventListener('input', autoSelectPropertyForUrl);
  $('sites').addEventListener('change', ()=>{ updatePropertyMeta('manual'); setEnabled(); });
  $('sitePickerToggle').addEventListener('click', (e)=>{
    e.preventDefault();
    $('sitePickerMenu')?.classList.contains('hidden') ? openSitePicker() : closeSitePicker();
  });
  $('sitePickerSearch').addEventListener('input', (e)=>{
    state.ui.siteFilter = e.target.value || '';
    renderSitePicker(state.ui.siteFilter);
  });
  $('sitePickerSearch').addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') closeSitePicker();
  });
  document.addEventListener('click', (e)=>{
    const shell = e.target?.closest?.('.property-shell');
    if (!shell) closeSitePicker();
  });

  // Buttons
  const refreshSites = async ()=>{
    try{
      await loadSites({ forceRefresh:true });
      clearResult('');
    }catch(e){
      renderHtml('result', statusCardForError(e, { retryTarget:'refreshSites' }));
    }
  };
  $('refreshSites').onclick = refreshSites;
  $('settingsRefreshSites').onclick = refreshSites;

  $('connectGoogle').onclick = ()=> runGoogleAccountChoice('connectGoogle', 'connectGoogle');
  $('switchGoogle').onclick = ()=> runGoogleAccountChoice('switchGoogleAccount', 'switchGoogle');
  $('useChromeGoogle').onclick = ()=> runGoogleAccountChoice('useChromeGoogleAccount', 'useChromeGoogle');

  $('useActiveUrl').onclick = async ()=>{
    const url = await getActiveTabUrl().catch(()=> '');
    const normalized = url ? normalizeUrl(url) : '';
    if (!normalized) return clearResult('Open a public page.');
    $('inspectUrl').value = normalized;
    autoSelectPropertyForUrl();
  };

  $('inspect').onclick = async ()=>{
    const siteUrl = $('sites')?.value?.trim(); const url = normalizeUrl($('inspectUrl')?.value?.trim() || '');
    if(!url) return clearResult('Enter a valid URL.');
    if(!propertyCoversUrl(siteUrl, url)) return clearResult(`Property doesn't cover this URL.`);
    clearResult('Inspecting…', 'indexResult');
    const r = await send({ type:'inspect', siteUrl, url });
    if(r.ok){
      let livePage = null;
      try { livePage = await collectIndexingSupplement(url); } catch (_) { livePage = null; }
      renderIndexing({ ...(r.data || {}), livePage });
    } else {
      renderApiError('indexResult', apiErrorFromResponse(r, 'Search Console inspection failed.'), 'inspect');
    }
  };

  $('openGSC').onclick = ()=>{
    const siteUrl = $('sites')?.value?.trim(); const url = normalizeUrl($('inspectUrl')?.value?.trim() || '');
    if(siteUrl && url) openGSCInspect(siteUrl, url);
  };

  $('runOnPage').onclick = ()=>{ runOnPageAudit({ reason:'button' }); };


  $('runStructuredData').onclick = ()=>{ runStructuredDataScan({ reason:'button' }); };

  $('openSchemaValidator').onclick = async ()=>{
    const url = normalizeUrl($('inspectUrl')?.value?.trim() || '') || normalizeUrl(await getActiveTabUrl().catch(()=> ''));
    openSchemaValidator(url || '');
  };

  $('openRichResults').onclick = async ()=>{
    const url = normalizeUrl($('inspectUrl')?.value?.trim() || '') || normalizeUrl(await getActiveTabUrl().catch(()=> ''));
    openRichResultsTest(url || '');
  };

  $('logoutSettings').onclick = async ()=>{
    await send({ type:'logout' });
    await resetGoogleUiState({ clearSelections:true });
    $('accountLabel').textContent = '';
    $('accountMini').textContent = '—';
    const settingsEmail = $('settingsAccountEmail'); if (settingsEmail) settingsEmail.textContent = 'Not connected';
    const settingsHint = $('settingsAccountHint'); if (settingsHint) settingsHint.textContent = 'Connect your Chrome profile account to continue.';
    setServiceActive('googleActiveStatus', false);
    $('settingsGoogleCard')?.classList.remove('is-connected');
    $('connectGoogle').hidden = false;
    $('switchGoogle').hidden = true;
    $('useChromeGoogle').hidden = true;
    $('googleAuthMode')?.classList.add('hidden');
    $('googleSwitchTip')?.classList.add('hidden');
    $('logoutSettings').hidden = true;
    await renderAccountSwitcher();
    clearResult('Signed out.');
  };
}


/* ==========================================================================
   PANEL EMPTY STATE · 0.8.1
   Every panel gets a card in place of its blank result area: what the panel
   would return, when it last returned it, and the button to run it. Once a
   result renders, the card gets out of the way.

   Nothing else about the panels changes - the card drives each panel's own
   existing Run and refresh buttons.

   TO REVERT: delete this block, delete the "PANEL EMPTY STATE" block in
   popup.html and panel.html, and remove the mountPanelEmptyStates() call in
   init().
   ========================================================================== */
const EMPTY_STATE_KEY = 'panelLastRun';

const EMPTY_STATE_PANELS = {
  navBlend: {
    run: 'blendRun', refresh: 'blendRefresh',
    results: ['blendKpis', 'blendChart', 'blendSections', 'blendResult'],
    desc: 'Search Console, GA4 and CallRail in one place.',
    blocked: 'Pick your sources above, then run the report.'
  },
  navPerf: {
    run: 'loadPerf', refresh: 'refreshPerf',
    results: ['perfKpis', 'perfChart', 'perfSections', 'perfResult'],
    desc: 'Clicks, impressions, CTR and position by query, page, country or device.',
    blocked: 'Select a Search Console property above to enable this panel.'
  },
  navAnalytics: {
    run: 'gaLoad', refresh: 'gaRefreshData',
    results: ['gaResult'],
    desc: 'Users, sessions and key events for the selected property.',
    blocked: 'Select a GA4 property above to enable this panel.'
  },
  navCallRail: {
    run: 'crLoad', refresh: 'crRefreshData',
    results: ['crKpis', 'crChart', 'crSections', 'crResult'],
    desc: 'Attribution, volume and individual call detail.',
    blocked: 'Add your CallRail API key in Settings, then pick an account.'
  },
  navIndex: {
    run: 'inspect', refresh: null,
    results: ['indexResult'],
    desc: 'Coverage, canonical and rich-results state for the selected URL.',
    blocked: 'Enter a URL above to inspect it.'
  }
  // On-Page and Structured Data are deliberately absent: both scan the active
  // tab the moment you open them, so a card telling you to run them would be
  // gone before it could be read.
};

const EMPTY_STATE = { lastRun: {}, ready: false };

function emptyStateRelTime(ts){
  const seconds = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// A panel counts as empty when its result containers hold nothing, or hold
// only a status card - "Pick a property" is a message, not a report, and a
// panel showing one has still not run.
function emptyStateIsEmpty(cfg){
  return (cfg.results || []).every(id => {
    const el = $(id);
    if (!el) return true;
    if (el.classList.contains('hidden')) return true;
    const children = Array.from(el.children);
    if (!children.length) return !el.textContent.trim();
    return children.every(child => child.classList.contains('status-card'));
  });
}

function emptyStateEnsure(navId, cfg){
  const existing = $(`emptyState_${navId}`);
  if (existing) return existing;
  const anchor = $(cfg.results[0]);
  if (!anchor?.parentNode) return null;
  const box = document.createElement('div');
  box.id = `emptyState_${navId}`;
  box.className = 'l2-empty';
  box.innerHTML = `
    <p class="l2-empty__title"></p>
    <p class="l2-empty__desc"></p>
    <div class="l2-empty__actions">
      <button type="button" class="btn-top" data-empty-cached>Show cached</button>
      <button type="button" class="btn-top l2-primary" data-empty-run>Run</button>
    </div>`;
  anchor.parentNode.insertBefore(box, anchor);
  // Cached reads through the panel's normal load path; fresh forces a refetch
  // where the panel has a refresh button of its own.
  box.querySelector('[data-empty-cached]').addEventListener('click', () => $(cfg.run)?.click());
  box.querySelector('[data-empty-run]').addEventListener('click', () => {
    const target = (EMPTY_STATE.lastRun[navId] && cfg.refresh) ? $(cfg.refresh) : $(cfg.run);
    target?.click();
  });
  return box;
}

function emptyStateRefresh(navId){
  const cfg = EMPTY_STATE_PANELS[navId];
  if (!cfg) return;
  const box = emptyStateEnsure(navId, cfg);
  if (!box) return;

  const empty = emptyStateIsEmpty(cfg);
  box.classList.toggle('l2-hide', !empty);
  if (!empty) return;

  const last = EMPTY_STATE.lastRun[navId];
  const runButton = $(cfg.run);
  const blocked = !!runButton?.disabled;
  box.querySelector('.l2-empty__title').textContent = last
    ? `Last run ${emptyStateRelTime(last)}`
    : 'Nothing loaded yet';
  box.querySelector('.l2-empty__desc').textContent = (blocked && cfg.blocked) ? cfg.blocked : cfg.desc;

  const cached = box.querySelector('[data-empty-cached]');
  const run = box.querySelector('[data-empty-run]');
  cached.classList.toggle('l2-hide', !(last && cfg.refresh));
  run.textContent = (last && cfg.refresh) ? 'Run fresh' : 'Run';
  cached.disabled = blocked;
  run.disabled = blocked;
}

function emptyStateRefreshAll(){
  Object.keys(EMPTY_STATE_PANELS).forEach(emptyStateRefresh);
}

async function mountPanelEmptyStates(){
  const stored = await chrome.storage.local.get(EMPTY_STATE_KEY).catch(() => ({}));
  EMPTY_STATE.lastRun = stored?.[EMPTY_STATE_KEY] || {};

  // Results are rendered from a dozen code paths, so watch the output
  // containers rather than hooking every one of them.
  const observer = new MutationObserver(() => {
    if (!EMPTY_STATE.ready) return;
    let changed = false;
    Object.entries(EMPTY_STATE_PANELS).forEach(([navId, cfg]) => {
      if (emptyStateIsEmpty(cfg)) return;
      if (Date.now() - (EMPTY_STATE.lastRun[navId] || 0) < 1500) return;
      EMPTY_STATE.lastRun[navId] = Date.now();
      changed = true;
    });
    if (changed) chrome.storage.local.set({ [EMPTY_STATE_KEY]: EMPTY_STATE.lastRun }).catch(() => {});
    emptyStateRefreshAll();
  });
  Object.values(EMPTY_STATE_PANELS).forEach(cfg => cfg.results.forEach(id => {
    const el = $(id);
    if (el) observer.observe(el, { childList: true, subtree: true, characterData: true });
  }));

  // A panel can become runnable long after it was drawn, so re-read the button
  // state whenever the user lands on it.
  Object.keys(EMPTY_STATE_PANELS).forEach(navId => {
    $(navId)?.addEventListener('click', () => setTimeout(() => emptyStateRefresh(navId), 80));
  });

  EMPTY_STATE.ready = true;
  emptyStateRefreshAll();
  setInterval(emptyStateRefreshAll, 60000);
}
/* ===== end PANEL EMPTY STATE ============================================= */


/* ==========================================================================
   SESSION SELECTIONS · 0.8.1
   The property, GA4 property and CallRail account/company you pick stay put
   for as long as the browser is open, then reset. chrome.storage.session is
   cleared when the browser closes, which is exactly the requested lifetime.

   These lists load asynchronously. Assigning select.value before its options
   exist silently falls back to the first entry, which is why reopening the
   popup landed on a different account each time. Re-applying on every
   repopulation is what makes the choice stick.
   ========================================================================== */
const SESSION_SELECTION_KEY = 'sessionSelections';
const SESSION_SELECTION_IDS = ['sites', 'gaProps', 'crAccount', 'crCompany'];
// "All companies" is a deliberate choice whose value is the empty string, so an
// empty value has to be storable for that one select.
const SESSION_SELECTION_ALLOW_EMPTY = new Set(['crCompany']);
let SESSION_SELECTION = {};

// The GA4 picker assigns gaProps.value directly without firing a change event,
// so nothing observes it. It records itself here instead. Dispatching change
// would double-fire gaHandlePropertyChange, which already runs in the setter.
function sessionSelectionRecord(id, value){
  if (!value && !SESSION_SELECTION_ALLOW_EMPTY.has(id)) return;
  if (SESSION_SELECTION[id] === value) return;
  SESSION_SELECTION[id] = value;
  void sessionSet(SESSION_SELECTION_KEY, SESSION_SELECTION);
}
function sessionSelectionApply(id){
  const el = $(id);
  const wanted = SESSION_SELECTION[id];
  if (!el || wanted === undefined || wanted === null || el.value === wanted) return false;
  if (!wanted && !SESSION_SELECTION_ALLOW_EMPTY.has(id)) return false;
  if (!Array.from(el.options).some(option => option.value === wanted)) return false;
  // A GA4 property is more than a select value: the picker label and the key
  // event list follow it, so restore it the same way a click would.
  if (id === 'gaProps' && typeof gaSetSelectedProperty === 'function'){
    void gaSetSelectedProperty(wanted).then(() => {
      try { blendRenderConnectors?.(); blendRenderSelectors?.(); } catch(_){}
    });
    return true;
  }
  el.value = wanted;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

async function mountSessionSelections(){
  SESSION_SELECTION = (await sessionGet(SESSION_SELECTION_KEY)) || {};

  SESSION_SELECTION_IDS.forEach(id => {
    const el = $(id);
    if (!el) return;

    el.addEventListener('change', () => {
      // An empty value usually means the list was cleared or reset rather than
      // chosen - except for the company select, where empty is "All companies".
      if (!el.value && !SESSION_SELECTION_ALLOW_EMPTY.has(id)) return;
      if (SESSION_SELECTION[id] === el.value) return;
      SESSION_SELECTION[id] = el.value;
      void sessionSet(SESSION_SELECTION_KEY, SESSION_SELECTION);
    });

    // Options arrive later, and CallRail companies are rebuilt whenever the
    // account changes, so watch for both.
    new MutationObserver(() => sessionSelectionApply(id)).observe(el, { childList: true });
    sessionSelectionApply(id);
  });
}
/* ===== end SESSION SELECTIONS ============================================ */

/* ---------- Kick off ---------- */
const start = () => safe(init);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once:true });
} else {
  start();
}
