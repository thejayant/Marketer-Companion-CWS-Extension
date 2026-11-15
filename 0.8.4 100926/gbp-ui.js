import {GBP_REPORTS,GBP_LABELS,format,totals,periodTotals,combineDaily,change,filterReviews,reviewSummary,stars,attention,dates,months,previousMonths,timezone} from './gbp-reporting.js';

export function createGbpUI({request,escape,getClient=()=>null,getIdentity=()=>''}) {
  const $=id=>document.getElementById(id),e=value=>escape(String(value??''));
  const state={discovery:null,loading:false,loadToken:0,runToken:0,busy:false,data:[],errors:[],rows:[],columns:[],visible:new Set(),page:0,pageSize:25,sort:null,search:'',chart:'impressions',stale:false,writeBusy:false,selection:new Set(),restoredSelection:null,report:'overview',setupOpen:true};
  const option=(value,label)=>`<option value="${e(value)}">${e(label)}</option>`;
  const field=(id,label,control,extra='')=>`<label class="gbp-field ${extra}" for="${id}"><span>${label}</span>${control}</label>`;
  const select=(id,values)=>`<select id="${id}">${values.map(([value,label])=>option(value,label)).join('')}</select>`;
  const input=(id,type='text',extra='')=>`<input id="${id}" type="${type}" ${extra}>`;
  const selected=()=>[...state.selection];
  const report=()=>state.report;
  function setReport(value) {
    if(!GBP_REPORTS.some(([id])=>id===value))return;
    state.report=value;
    document.querySelectorAll('[data-gbp-report]').forEach(tab=>{
      const on=tab.dataset.gbpReport===value;
      tab.classList.toggle('is-active',on);tab.setAttribute('aria-selected',String(on));
    });
    modes();
  }
  function setSetup(open) {
    state.setupOpen=open;
    if(!$('gbpSetup'))return;
    $('gbpSetup').hidden=!open;
    $('gbpEditRun').hidden=open;
    $('gbpEditRun').setAttribute('aria-expanded',String(open));
  }
  function runChips(input,coverage) {
    const wrap=$('gbpRunChips');if(!wrap)return;
    if(!input){wrap.hidden=true;wrap.innerHTML='';return;}
    const chip=(label,value)=>`<span class="gbp-runchip"><span>${e(label)}</span>${e(value)}</span>`;
    let period=input.report==='keywords'?`${input.monthStart} → ${input.monthEnd}`:'';
    if(!period) {
      const range=state.data[0]?.ranges?.current;
      if(range)period=`${range.startDate} → ${range.endDate}`;
      else try{const fallback=dates(input).current;period=`${fallback.startDate} → ${fallback.endDate}`;}catch{period='—';}
    }
    const comparison=input.report==='keywords'?input.monthComparison:input.comparison;
    wrap.innerHTML=chip('Locations',coverage)+chip('Dates',period)
      +chip('Compare',comparison==='none'?'No comparison':comparison.replace(/_/g,' '))
      +chip('Zone',input.timeZone);
    wrap.hidden=false;
  }
  function periodNote() {
    const target=$('gbpPeriodNote');if(!target)return;
    try {
      if(report()==='keywords'){target.textContent=`${$('gbpMonthStart').value} to ${$('gbpMonthEnd').value}, complete calendar months only.`;target.hidden=false;return;}
      const range=dates({range:$('gbpRange').value,startDate:$('gbpStart').value,endDate:$('gbpEnd').value,comparison:$('gbpCompare').value,compareStart:$('gbpCompareStart').value,compareEnd:$('gbpCompareEnd').value,timeZone:timezone($('gbpTimezone').value.trim())});
      target.textContent=range.previous
        ?`${range.current.startDate} → ${range.current.endDate}, against ${range.previous.startDate} → ${range.previous.endDate}. Both periods use the same selected locations.`
        :`${range.current.startDate} → ${range.current.endDate}. No comparison selected.`;
      target.hidden=false;
    }catch(error){target.textContent=error.message;target.hidden=false;}
  }
  function filterCount() {
    const badge=$('gbpFilterCount');if(!badge)return;
    const ids=['gbpCategory','gbpRegion','gbpLabel','gbpOpen','gbpThreshold','gbpKeywordText','gbpKeywordExclude','gbpKeywordType','gbpBrandTerms','gbpBrandFilter','gbpRating','gbpReplyFilter','gbpCommentFilter','gbpReviewText','gbpReviewAge','gbpContentType','gbpContentText','gbpContentState'];
    const applied=ids.filter(id=>$(id)&&!$(id).closest('[hidden]')&&$(id).value!=='').length;
    badge.textContent=`${applied} applied`;badge.hidden=!applied;
  }
  function status(text,error=false){$('gbpStatus').textContent=text;$('gbpStatus').classList.toggle('gbp-error',error);}
  function buttons(){ $('gbpRun').disabled=state.busy||state.loading||!selected().length;$('gbpRun').textContent=state.busy?'Loading…':'Run report';$('gbpCancel').hidden=!state.busy;$('gbpRefresh').disabled=state.loading||state.busy;$('gbpResult').setAttribute('aria-busy',String(state.busy)); }
  function invalidate(){state.runToken++;state.busy=false;state.stale=state.data.length>0;buttons();if(state.stale)status('Selection changed. Run the report to update the results.');}
  function prefsKey(){return `gbpPreferences:${getIdentity()||'signed-out'}`;}
  async function prefs(){return (await chrome.storage.local.get(prefsKey()))[prefsKey()]||{};}
  async function savePrefs(change){const key=prefsKey();const previous=(await chrome.storage.local.get(key))[key]||{};await chrome.storage.local.set({[key]:{...previous,...change}});}
  function filterLocations(location) {
    const account=$('gbpAccount').value;
    const text=$('gbpLocationSearch').value.toLowerCase().trim(),category=$('gbpCategory').value.toLowerCase().trim(),region=$('gbpRegion').value.toLowerCase().trim(),label=$('gbpLabel').value.toLowerCase().trim(),open=$('gbpOpen').value;
    return (!account||location.accountNames.includes(account))&&(!text||`${location.title} ${location.storeCode||''}`.toLowerCase().includes(text))&&(!category||JSON.stringify(location.categories||{}).toLowerCase().includes(category))&&(!region||JSON.stringify(location.storefrontAddress||{}).toLowerCase().includes(region))&&(!label||(location.labels||[]).some(value=>value.toLowerCase().includes(label)))&&(!open||location.openInfo?.status===open);
  }
  const locationCode=location=>location.storeCode||location.name.split('/').pop();
  function renderSelection() {
    const all=state.discovery?.locations||[];
    const shown=all.filter(filterLocations).length;
    const chosen=all.filter(location=>state.selection.has(location.name));
    if($('gbpSelectionCount'))$('gbpSelectionCount').textContent=`${chosen.length} selected · ${shown} shown`;
    const chips=$('gbpSelectedChips');if(!chips)return;
    const visible=chosen.slice(0,12);
    chips.innerHTML=chosen.length
      ?visible.map(location=>`<span class="gbp-chip" role="listitem">${e(location.title)} · ${e(locationCode(location))}<button type="button" class="gbp-chip-remove" data-gbp-deselect="${e(location.name)}" aria-label="Remove ${e(location.title)} from the selection">×</button></span>`).join('')
        +(chosen.length>visible.length?`<span class="gbp-chip gbp-chip-more" role="listitem">+${chosen.length-visible.length} more</span>`:'')
        +`<button type="button" id="gbpClearChips" class="gbp-chip-clear">Clear all</button>`
      :'';
    chips.querySelectorAll('[data-gbp-deselect]').forEach(button=>{button.onclick=()=>toggleLocation(button.dataset.gbpDeselect,false);});
    if($('gbpClearChips'))$('gbpClearChips').onclick=()=>{fillLocations([]);invalidate();};
  }
  function toggleLocation(name,on) {
    if(on)state.selection.add(name);else state.selection.delete(name);
    const box=$('gbpLocations')?.querySelector(`input[data-gbp-location="${CSS.escape(name)}"]`);
    if(box&&box.checked!==on)box.checked=on;
    renderSelection();invalidate();buttons();
  }
  function fillLocations(ids=selected()) {
    const all=state.discovery?.locations||[];
    const known=new Set(all.map(location=>location.name));
    state.selection=new Set(ids.filter(name=>known.has(name)));
    const locations=all.filter(filterLocations);
    const list=$('gbpLocations');
    list.innerHTML=locations.length
      ?locations.map(location=>`<label class="gbp-location-row"><input type="checkbox" data-gbp-location="${e(location.name)}"${state.selection.has(location.name)?' checked':''}><span class="gbp-location-text"><span class="gbp-location-name">${e(location.title)}</span><span class="gbp-location-meta">${e(locationCode(location))}</span></span></label>`).join('')
      :'<p class="gbp-caption gbp-location-empty">No locations match the current search or filters.</p>';
    list.querySelectorAll('input[data-gbp-location]').forEach(box=>{box.onchange=()=>toggleLocation(box.dataset.gbpLocation,box.checked);});
    renderSelection();
    buttons();
  }
  // Motion: one timeline per state change, nothing loops. Entrances use
  // cubic-bezier(.22,1,.36,1); exits are shorter. prefers-reduced-motion drops
  // every transform and duration, so content simply appears.
  const ENTER='cubic-bezier(.22, 1, .36, 1)';
  const calm=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function rise(element,delay,duration,shift) {
    if(!element||typeof element.animate!=='function')return;
    const soft=calm();
    element.animate(
      [{opacity:0,transform:soft?'none':`translateY(${shift}px)`},{opacity:1,transform:'none'}],
      {duration:soft?1:duration,delay:soft?0:delay,easing:ENTER,fill:'backwards'}
    );
  }
  function marked(name,root){return [...(root||$('gbpResult')||document).querySelectorAll(`[data-anim="${name}"]`)];}
  function reveal(only) {
    const result=$('gbpResult');if(!result)return;
    if(only==='line') {
      const line=marked('line')[0];
      if(!line)return;
      const polylines=[...line.querySelectorAll('polyline')];
      polylines.forEach(shape=>{
        if(calm()||typeof shape.getTotalLength!=='function'||typeof shape.animate!=='function')return;
        const length=shape.getTotalLength();
        if(!length)return;
        shape.animate(
          [{strokeDasharray:`${length} ${length}`,strokeDashoffset:length},{strokeDasharray:`${length} ${length}`,strokeDashoffset:0}],
          {duration:480,delay:160,easing:ENTER,fill:'backwards'}
        );
      });
      return;
    }
    rise(result.querySelector('.gbp-coverage'),0,180,6);
    marked('kpi').forEach((card,index)=>rise(card,60+index*35,220,8));
    marked('finding').forEach((card,index)=>rise(card,260+Math.min(index,6)*28,200,8));
  }
  function revealRows() {
    marked('row').slice(0,25).forEach((row,index)=>rise(row,index*18,180,6));
  }
  function progress(done,total,current='') {
    const wrap=$('gbpProgress');if(!wrap)return;
    wrap.hidden=!state.busy;
    const bar=wrap.querySelector('.gbp-progress-bar');
    bar.setAttribute('aria-valuenow',String(done));bar.setAttribute('aria-valuemax',String(total));
    $('gbpProgressFill').style.width=`${total?Math.round(done/total*100):0}%`;
    $('gbpProgressText').textContent=`${done} of ${total} locations${current?` · loading ${current}`:''}${state.errors.length?` · ${state.errors.length} failed`:''}`;
  }
  // Holds the MV3 service worker awake for the length of a run, so a long
  // paginated report is not cut off mid-request.
  function keepAlive() {
    let port=null;
    try{port=chrome.runtime.connect({name:'keepalive'});}catch{port=null;}
    return ()=>{try{port&&port.disconnect();}catch{}};
  }
  function runKey(){return `gbpLastRun:${getIdentity()||'signed-out'}`;}
  async function saveRun() {
    try {
      const payload={input:state.input,selectedCount:state.selectedCount,errors:state.errors,names:selected(),data:state.data,savedAt:Date.now()};
      if(JSON.stringify(payload).length>4000000)return;
      await chrome.storage.session.set({[runKey()]:payload});
    }catch{}
  }
  async function clearRun(){try{await chrome.storage.session.remove(runKey());}catch{}}
  async function restoreRun() {
    try {
      const saved=(await chrome.storage.session.get(runKey()))[runKey()];
      if(!saved?.data?.length||state.busy||state.data.length)return;
      state.data=saved.data;state.input=saved.input;state.selectedCount=saved.selectedCount;state.errors=saved.errors||[];state.restoredSelection=saved.names||[];
      setReport(saved.input.report);
      if(saved.input.timeZone)$('gbpTimezone').value=saved.input.timeZone;
      if(saved.input.range)$('gbpRange').value=saved.input.range;
      if(saved.input.comparison)$('gbpCompare').value=saved.input.comparison;
      if(saved.input.monthStart)$('gbpMonthStart').value=saved.input.monthStart;
      if(saved.input.monthEnd)$('gbpMonthEnd').value=saved.input.monthEnd;
      modes();render();
      if(state.restoredSelection.length)fillLocations(state.restoredSelection);
      status(`Showing the last report from this browser session, run ${new Date(saved.savedAt).toLocaleString()}. Run again for current data.`);
    }catch{}
  }
  async function load(force=false) {
    if(state.loading||state.discovery&&!force)return;
    const token=++state.loadToken;state.loading=true;invalidate();status('Discovering accounts and locations…');buttons();
    try {
      const data=await request('gbpDiscover',{});if(token!==state.loadToken)return;
      state.discovery=data;
      $('gbpAccount').innerHTML=option('','All accounts / groups')+data.accounts.map(account=>option(account.name,account.accountName||account.name)).join('');
      const saved=await prefs();if(token!==state.loadToken)return;
      $('gbpTimezone').value=saved.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
      const client=getClient();applyClient(client);
      status(data.warnings.length?`Discovery warnings: ${data.warnings.join(' · ')}`:`${data.locations.length} locations discovered. Select locations to begin.`,!!data.warnings.length);
      $('gbpConnection').textContent='Shared Google connection · business.manage access';
      const chip=$('gbpAccountChip');chip.textContent=`${data.locations.length} locations discovered`;chip.hidden=false;
      periodNote();
      await restoreRun();if(token!==state.loadToken)return;
    }catch(error){if(token===state.loadToken)status(error.message,true);}
    finally{if(token===state.loadToken){state.loading=false;buttons();}}
  }
  function modes() {
    const key=report(),keyword=key==='keywords',dated=['overview','performance','locations','reviews','content'].includes(key);
    $('gbpDailyControls').hidden=!dated;$('gbpMonthControls').hidden=!keyword;
    $('gbpCustomDates').hidden=$('gbpRange').value!=='custom';$('gbpCustomCompare').hidden=$('gbpCompare').value!=='custom';
    $('gbpReviewFilters').hidden=key!=='reviews';$('gbpKeywordFilters').hidden=!keyword;$('gbpContentFilters').hidden=key!=='content';
    $('gbpMetricFilters').hidden=!['overview','performance','locations'].includes(key);
    $('gbpGrain').hidden=key!=='performance';
    $('gbpDataNote').textContent=keyword?'Keywords use complete calendar months. Below-threshold values remain <N.':key==='reviews'?'Reviews are currently retrievable records. Current all-time ratings are separate from selected-period results.':key==='audit'?'Current profile fields and an extension checklist. Availability and category rules vary.':key==='content'?'Post and media inventory; legacy post/photo insights are unavailable.':'Impressions are not unique people across platforms or days. Call clicks are button clicks, not answered calls.';
  }
  function readInput() {
    const base={report:report(),range:$('gbpRange').value,startDate:$('gbpStart').value,endDate:$('gbpEnd').value,comparison:$('gbpCompare').value,compareStart:$('gbpCompareStart').value,compareEnd:$('gbpCompareEnd').value,timeZone:timezone($('gbpTimezone').value.trim()),monthStart:$('gbpMonthStart').value,monthEnd:$('gbpMonthEnd').value,monthComparison:$('gbpMonthCompare').value,optionalMetrics:[...document.querySelectorAll('#gbpOptionalMetrics input:checked')].map(el=>el.value)};
    if(base.report==='keywords'){const list=months(base.monthStart,base.monthEnd);previousMonths(list,base.monthComparison);const today=dates({...base,range:'this_month',comparison:'none'}).current.startDate.slice(0,7);if(base.monthEnd>=today)throw new Error('Select completed months for keyword reports.');}
    else if(['overview','performance','locations','reviews','content'].includes(base.report))dates(base);
    const threshold=$('gbpThreshold').value;if(threshold!==''&&(!Number.isFinite(Number(threshold))||Number(threshold)<0))throw new Error('Metric threshold must be zero or greater.');
    return base;
  }
  async function run() {
    let input;try{input=readInput();}catch(error){status(error.message,true);return;}
    const names=selected();if(!names.length)return;if(names.length>100){status('Choose up to 100 locations per run.',true);return;}
    const token=++state.runToken;state.busy=true;state.stale=false;state.data=[];state.errors=[];state.rows=[];state.page=0;state.sort=null;state.search='';$('gbpResult').innerHTML='';$('gbpInspector').innerHTML='';buttons();
    setSetup(false);
    void savePrefs({timeZone:input.timeZone});
    let cursor=0,done=0;
    const locations=names.map(name=>state.discovery.locations.find(location=>location.name===name));
    const alive=keepAlive();
    status(`Running ${GBP_REPORTS.find(([id])=>id===input.report)[1]} for ${locations.length} ${locations.length===1?'location':'locations'}…`);
    progress(0,locations.length,locations[0]?.title||'');
    async function worker() {
      while(cursor<locations.length&&token===state.runToken) {
        const location=locations[cursor++];
        try {const data=await request('gbpRunLocation',{...input,locationName:location.name,accountName:location.accountName});if(token!==state.runToken)return;state.data.push({...data,location});}
        catch(error){if(token!==state.runToken)return;state.errors.push({location:location.title,error:error.message});}
        done++;progress(done,locations.length,locations[cursor]?.title||'');
      }
    }
    await Promise.all([worker(),worker()]).finally(alive);if(token!==state.runToken)return;
    state.busy=false;state.input=input;state.selectedCount=names.length;state.restoredSelection=null;buttons();$('gbpProgress').hidden=true;render();void saveRun();
    const warnings=state.data.flatMap(item=>item.warnings||[]);
    status(`${state.data.length}/${names.length} locations loaded${state.errors.length?' · Partial coverage':''}${warnings.length?' · '+warnings.join(' · '):''}`,state.errors.length>0||warnings.length>0);
  }
  const summary=(label,value,note='')=>`<div class="gbp-kpi"><span>${e(label)}</span><strong>${e(value)}</strong><small>${e(note)}</small></div>`;
  const CARET_UP='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 15l7-7 7 7"></path></svg>';
  const CARET_DOWN='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 9l-7 7-7-7"></path></svg>';
  function sparkline(rows,metric) {
    const values=(rows||[]).map(row=>row[metric]).filter(value=>value!=null);
    if(values.length<2)return '';
    const max=Math.max(...values),min=Math.min(...values),span=max-min||1;
    const points=rows.map((row,index)=>row[metric]==null?null:`${(index/(rows.length-1)*100).toFixed(2)},${(24-(row[metric]-min)/span*22).toFixed(2)}`).filter(Boolean).join(' ');
    return `<svg class="gbp-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline></svg>`;
  }
  function trend(current,previous) {
    if(current==null||previous==null||previous===0)return 'flat';
    return current>previous?'up':current<previous?'down':'flat';
  }
  function columns(list){return list.map(([key,label,type='text'])=>({key,label,type}));}
  function columnsLabel(){return `Columns · ${state.visible.size} of ${state.columns.length}`;}
  function syncColumns() {
    if($('gbpColumnsSummary'))$('gbpColumnsSummary').textContent=columnsLabel();
    document.querySelectorAll('[data-gbp-column]').forEach(control=>{control.checked=state.visible.has(control.dataset.gbpColumn);});
  }
  function render() {
    const input=state.input,key=input.report;
    state.fresh=true;
    let items=[...state.data];
    if(['overview','performance','locations'].includes(key)&&$('gbpThreshold').value!=='') {
      const metric=$('gbpThresholdMetric').value,threshold=Number($('gbpThreshold').value),op=$('gbpThresholdOp').value;
      items=items.filter(item=>{const n=periodTotals(item.current)[metric];return n!=null&&(op==='gte'?n>=threshold:n<=threshold);});
    }
    const loaded=state.data.length,asked=state.selectedCount||loaded,complete=!state.errors.length&&loaded===asked;
    runChips(input,`${loaded} of ${asked}`);
    let html=`<div class="gbp-coverage${complete?'':' is-partial'}">`
      +`<span class="gbp-coverage-mark" aria-hidden="true">${complete?'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 6L9 17l-5-5"></path></svg>':'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 8v5"></path><path d="M12 16.5v.01"></path><circle cx="12" cy="12" r="9"></circle></svg>'}</span>`
      +`<strong>${complete?'Complete coverage':'Partial coverage'}</strong>`
      +`<span>${e(loaded)} of ${e(asked)} locations${complete?' · every requested day returned':' · these totals are not a portfolio total'} · fetched ${e(new Date().toLocaleTimeString())} · ${e(input.timeZone)}</span>`
      +`</div>`;
    html+=`<div class="gbp-report-heading"><div><h4>${e(GBP_REPORTS.find(([id])=>id===key)[1])}</h4></div><span>${items.length} included / ${state.selectedCount} selected</span></div>`;
    if(state.errors.length)html+=`<details class="gbp-warning" open><summary>Some locations could not load</summary>${state.errors.map(item=>`<p><strong>${e(item.location)}</strong> · ${e(item.error)}</p>`).join('')}</details>`;
    if(!items.length) {
      const blocked=state.errors[0];
      $('gbpResult').innerHTML=html+(blocked
        ?`<div class="gbp-empty-state"><h4>${e(GBP_REPORTS.find(([id])=>id===key)[1])} could not be loaded</h4><p>${e(blocked.error)}</p><ul><li>Check that this report's API is enabled in the Cloud project that owns your OAuth client: reviews, posts and media need the Google My Business API, search keywords need the Business Profile Performance API.</li><li>Reopen Settings and reconnect Google if the account recently changed.</li><li>If the message says the request never reached Google, reload the extension at chrome://extensions and run it again.</li></ul></div>`
        :'<p class="gbp-empty">No rows matched the filters for the locations you selected.</p>');
      return;
    }
    if(['overview','performance','locations'].includes(key)) {
      const daily=combineDaily(items),previous=items.every(item=>item.previous)?combineDaily(items,'previous'):[],a=periodTotals({rows:daily,range:items[0].ranges.current}),b=periodTotals({rows:previous,range:items[0].ranges.previous});state.series={daily,previous};
      html+=`<p class="gbp-caption">${e(items[0].ranges.current.startDate)} → ${e(items[0].ranges.current.endDate)}${items[0].ranges.previous?' · compared with '+e(items[0].ranges.previous.startDate)+' → '+e(items[0].ranges.previous.endDate):''}</p>`;
      html+=`<div class="gbp-kpis" role="group" aria-label="Choose the charted metric">${['impressions','website','calls','directions'].map(metric=>{
        const on=state.chart===metric,tone=trend(a[metric],b[metric]);
        const note=input.comparison==='none'
          ?`<small class="gbp-kpi-note">${on?'Charted below':'Show trend'}</small>`
          :`<small class="gbp-kpi-note is-${tone}">${tone==='up'?CARET_UP:tone==='down'?CARET_DOWN:''}${e(change(a[metric],b[metric]))}</small>`;
        return `<button class="gbp-kpi${on?' is-charted':''}" data-anim="kpi" data-gbp-metric="${metric}" type="button" aria-pressed="${on}"><span>${e(GBP_LABELS[metric])}</span><strong>${e(format(a[metric]))}</strong>${note}${sparkline(daily,metric)}</button>`;
      }).join('')}</div>`;
      html+='<div id="gbpChart"></div>';
      html+='<p class="gbp-caption">— means unavailable or incomplete coverage. Totals require every requested day for each metric. Grouped tables sum available daily values.</p>';
      const insights=attention(items);
      if(insights.length)html+=`<section class="gbp-attention"><div class="gbp-attention-head"><h4>Needs investigation</h4><span class="gbp-pill">${insights.length} ${insights.length===1?'finding':'findings'}</span><span class="gbp-caption">Rules are visible and deterministic</span></div><div class="gbp-finding-grid">${insights.map(item=>`<article class="gbp-finding${item.kind==='Performance'?' is-down':''}" data-anim="finding"><span class="gbp-finding-kind">${e(item.kind)}</span><h5>${e(item.location)}</h5><p>${e(item.text)}</p></article>`).join('')}</div></section>`;
      state.rows=items.map(item=>({name:item.location.title,locationName:item.location.name,storeCode:item.location.storeCode||'',...periodTotals(item.current),previous:item.previous?periodTotals(item.previous):{},change:change(periodTotals(item.current).impressions,item.previous?periodTotals(item.previous).impressions:null)}));
      state.columns=columns([['name','Location'],['storeCode','Store code'],...Object.entries(GBP_LABELS).map(([metric,label])=>[metric,label,'number']),...(input.comparison==='none'?[]:[['change','Impression change']])]);
      if(key==='performance')state.rows=groupDaily(daily,$('gbpGrainSelect').value);
      if(key==='performance')state.columns=columns([['date','Period'],...Object.entries(GBP_LABELS).map(([metric,label])=>[metric,label,'number'])]);
    }else if(key==='keywords') {
      const brand=$('gbpBrandTerms').value.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean),text=$('gbpKeywordText').value.toLowerCase(),exclude=$('gbpKeywordExclude').value.toLowerCase();
      state.rows=items.flatMap(item=>item.keywords.map(row=>{
        const index=item.months.indexOf(row.month),priorMonth=item.priorMonths?.[index];const prev=item.previousKeywords?.find(previous=>previous.month===priorMonth&&previous.keyword===row.keyword);
        const isBrand=brand.length?brand.some(term=>row.keyword.includes(term)):null;
        return {name:item.location.title,locationName:item.location.name,...row,impressions:row.type==='threshold'?`<${row.value}`:row.value??'Unavailable',brand:isBrand==null?'Unclassified':isBrand?'Brand':'Nonbrand',previous:prev?prev.type==='threshold'?`<${prev.value}`:prev.value:'Unavailable',change:row.type==='exact'&&prev?.type==='exact'?preciseChange(row.value,prev.value):'Unavailable'};
      })).filter(row=>(!text||row.keyword.includes(text))&&(!exclude||!row.keyword.includes(exclude))&&(!$('gbpKeywordType').value||row.type===$('gbpKeywordType').value)&&(!$('gbpBrandFilter').value||row.brand===$('gbpBrandFilter').value));
      html+=`<p class="gbp-caption">${e(input.monthStart)} → ${e(input.monthEnd)} · monthly data · brand labels use your rules</p><div class="gbp-kpis">${summary('Keyword rows',format(state.rows.length))}${summary('Exact values',format(state.rows.filter(row=>row.type==='exact').length))}${summary('Below threshold',format(state.rows.filter(row=>row.type==='threshold').length),'Never included as exact counts')}</div>`;
      state.columns=columns([['name','Location'],['month','Month'],['keyword','Search keyword'],['impressions','Impressions'],['brand','Classification'],...(input.monthComparison==='none'?[]:[['previous','Previous month value'],['change','Change']])]);
    }else if(key==='reviews') {
      const all=items.flatMap(item=>item.reviews.rows.map(row=>({...row,name:item.location.title,locationName:item.location.name,accountName:item.location.accountName})));
      const filter={rating:$('gbpRating').value,reply:$('gbpReplyFilter').value,comment:$('gbpCommentFilter').value,text:$('gbpReviewText').value,dateField:$('gbpReviewDate').value};
      const range=$('gbpReviewScope').value==='all'?null:items[0].ranges.current;
      let rows=filterReviews(all,filter,range,input.timeZone);
      const age=$('gbpReviewAge').value;if(age!=='')rows=rows.filter(row=>!row.reviewReply?.comment&&(Date.now()-new Date(row.createTime))/86400000>=Number(age));
      const a=reviewSummary(rows);let count=0,weighted=0,weight=0;
      for(const item of items){const n=item.reviews.totalReviewCount;if(n!=null)count+=n;if(n>0&&item.reviews.averageRating!=null){weighted+=n*item.reviews.averageRating;weight+=n;}}
      html+=`<div class="gbp-kpis">${summary('Matching reviews',format(a.count))}${summary('Matching average',format(a.rating),'Currently retrievable records')}${summary('Unanswered',format(a.unreplied))}${summary('Current weighted rating',format(weight?weighted/weight:null),`API all-time count: ${format(count)}`)}</div>`;
      if(input.comparison!=='none'&&range){const previous=reviewSummary(filterReviews(all,filter,items[0].ranges.previous,input.timeZone));html+=`<p class="gbp-caption">Matching review count: ${e(change(a.count,previous.count))} vs previous period. Both periods use current review/reply state.</p>`;}
      html+=`<div class="gbp-distribution" aria-label="Rating distribution">${a.distribution.map(row=>`<span>${row.star}★ <strong>${row.count}</strong></span>`).join('')}</div>`;
      state.rows=rows.map(row=>({...row,rating:stars(row),reviewer:row.reviewer?.displayName||'Anonymous',reply:row.reviewReply?.comment||'',created:row.createTime,updated:row.updateTime}));
      state.columns=columns([['name','Location'],['rating','Stars','number'],['reviewer','Reviewer'],['comment','Review'],['reply','Reply'],['created','Created'],['updated','Updated']]);
    }else if(key==='audit') {
      const findings=attention(items);
      html+=`<div class="gbp-kpis">${summary('Profiles checked',items.length)}${summary('Checklist findings',findings.reduce((n,item)=>n+1,0),'Locations with applicable missing fields')}</div><p class="gbp-caption">Extension checklist, equal weights. Applicability needs category review; this is not a Google ranking score.</p>`;
      state.rows=items.map(item=>({name:item.location.title,locationName:item.location.name,score:item.audit.score,missing:item.audit.missing.map(check=>check.label).join(', ')||'None',status:item.audit.profile.openInfo?.status||'Unavailable',changes:item.audit.googleChanges?.diffMask||'None returned',access:item.audit.capabilities.filter(cap=>!cap.ok).map(cap=>cap.key).join(', ')||'All requested reads available'}));
      state.columns=columns([['name','Location'],['score','Checklist %','number'],['missing','Missing fields'],['status','Open status'],['changes','Google changes'],['access','Unavailable capabilities']]);
    }else if(key==='content') {
      const type=$('gbpContentType').value,needle=$('gbpContentText').value.toLowerCase();
      state.rows=items.flatMap(item=>[...(item.content.posts||[]).map(post=>({name:item.location.title,locationName:item.location.name,kind:'Post',type:post.topicType,state:post.state||'',text:post.summary||'',date:post.createTime,link:post.searchUrl||post.callToAction?.url||'',raw:post})),...(item.content.media||[]).map(media=>({name:item.location.title,locationName:item.location.name,kind:'Media',type:media.locationAssociation?.category||media.mediaFormat,state:'Inventory',text:media.description||'',date:media.createTime,link:media.googleUrl||media.sourceUrl||'',raw:media}))]).filter(row=>(!type||row.kind===type)&&(!needle||`${row.text} ${row.type}`.toLowerCase().includes(needle))&&(!$('gbpContentState').value||row.state.toLowerCase().includes($('gbpContentState').value.toLowerCase())));
      if($('gbpContentDates').checked){const range=dates(input).current;state.rows=state.rows.filter(row=>row.date&&row.date.slice(0,10)>=range.startDate&&row.date.slice(0,10)<=range.endDate);}
      const posts=state.rows.filter(row=>row.kind==='Post'),media=state.rows.filter(row=>row.kind==='Media');
      const newest=state.rows.map(row=>row.date).filter(Boolean).sort().pop();
      html+=`<div class="gbp-kpis">${summary('Inventory records',format(state.rows.length))}${summary('Posts',format(posts.length))}${summary('Photos and media',format(media.length))}${summary('Most recent',newest?newest.slice(0,10):'—','Created date returned by Google')}</div>`;
      html+=items.flatMap(item=>item.content.capabilities.filter(cap=>!cap.ok).map(cap=>`<p class="gbp-warning">${e(item.location.title)} · ${e(cap.key)}: ${e(cap.error)}</p>`)).join('');
      const cards=[...state.rows].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,12);
      if(cards.length)html+=`<section class="gbp-content"><div class="gbp-attention-head"><h4>Most recent first</h4><span class="gbp-pill">${cards.length} of ${state.rows.length} shown</span><span class="gbp-caption">Every record stays in the table below</span></div><div class="gbp-content-grid">${cards.map(row=>{
        const image=row.kind==='Media'&&/^https:\/\//.test(row.link||'')?row.link:'';
        return `<article class="gbp-card" data-anim="finding">`
          +(image?`<img class="gbp-card-shot" src="${e(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span class="gbp-card-shot is-empty" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5h16v14H4z"></path><path d="M4 15l4-4 4 4 3-3 5 5"></path></svg></span>`)
          +`<div class="gbp-card-body">`
            +`<div class="gbp-card-top"><span class="gbp-card-kind${row.kind==='Media'?' is-media':''}">${e(row.kind)}</span><span class="gbp-card-type">${e(row.type||'—')}</span></div>`
            +`<p class="gbp-card-text">${e(row.text||'No description returned')}</p>`
            +`<div class="gbp-card-foot"><span>${e(row.name)}</span><span>${e(row.date?row.date.slice(0,10):'—')}</span>${row.state?`<span class="gbp-card-state">${e(row.state)}</span>`:''}</div>`
          +`</div></article>`;
      }).join('')}</div></section>`;
      state.columns=columns([['name','Location'],['kind','Kind'],['type','Type'],['state','Status'],['text','Description'],['date','Created'],['link','URL']]);
    }
    state.visible=new Set(state.columns.filter(col=>!['overview','performance','locations'].includes(key)||['name','storeCode','date','impressions','website','calls','directions','change'].includes(col.key)).map(col=>col.key));
    state.defaultVisible=new Set(state.visible);
    html+=`<div class="gbp-table-toolbar">`
      +`<label class="gbp-search" for="gbpTableSearch"><span>Find in report</span><input id="gbpTableSearch" type="search" placeholder="Filter the rows below" value="${e(state.search)}"></label>`
      +`<label class="gbp-rows" for="gbpPageSize"><span>Rows</span>${select('gbpPageSize',[['25','25'],['50','50'],['100','100']])}</label>`
      +`<details class="gbp-columns"><summary id="gbpColumnsSummary">${columnsLabel()}</summary>`
        +`<div class="gbp-columns-panel">`
          +`<p class="gbp-caption">Every field Google returned for this report. Tick one to add it to the table and to anything you copy out of it; the hidden ones are still fetched, so nothing re-runs.</p>`
          +`<div class="gbp-columns-list">${state.columns.map(col=>`<label><input type="checkbox" data-gbp-column="${e(col.key)}" ${state.visible.has(col.key)?'checked':''}> ${e(col.label)}</label>`).join('')}</div>`
          +`<div class="gbp-actions"><button id="gbpColumnsAll" class="btn-top" type="button">Show all</button><button id="gbpColumnsReset" class="btn-top" type="button">Reset to default</button></div>`
        +`</div></details>`
      +`</div>`
      +`<div id="gbpTable"></div>`
      +`<div class="gbp-pager"><button id="gbpPrev" type="button" class="btn-top">Previous</button><span id="gbpPageLabel"></span><button id="gbpNext" type="button" class="btn-top">Next</button></div>`
      +`<p class="gbp-caption">Searching filters rows only, never the totals above. Report data is kept for this browser session and cleared on sign-out or account changes.</p>`;
    $('gbpResult').innerHTML=html;
    // A media URL Google returns can expire or be blocked; fall back to the
    // placeholder rather than leaving a broken image in the card.
    $('gbpResult').querySelectorAll('img.gbp-card-shot').forEach(image=>{
      image.addEventListener('error',()=>{image.classList.add('is-broken');},{once:true});
    });
    reveal();
    document.querySelectorAll('[data-gbp-column]').forEach(control=>control.onchange=()=>{if(control.checked)state.visible.add(control.dataset.gbpColumn);else if(state.visible.size>1)state.visible.delete(control.dataset.gbpColumn);else control.checked=true;syncColumns();renderTable();});
    $('gbpColumnsAll').onclick=()=>{state.visible=new Set(state.columns.map(col=>col.key));syncColumns();renderTable();};
    $('gbpColumnsReset').onclick=()=>{state.visible=new Set(state.defaultVisible);syncColumns();renderTable();};
    $('gbpTableSearch').addEventListener('input',event=>{state.search=event.target.value;state.page=0;renderTable();});
    $('gbpPageSize').value=String(state.pageSize);$('gbpPageSize').addEventListener('change',event=>{state.pageSize=Number(event.target.value);state.page=0;renderTable();});
    $('gbpPrev').onclick=()=>{state.page--;renderTable();};$('gbpNext').onclick=()=>{state.page++;renderTable();};
    document.querySelectorAll('[data-gbp-metric]').forEach(button=>button.onclick=()=>{state.chart=button.dataset.gbpMetric;syncKpis();renderChart();});
    if(state.series&&['overview','performance','locations'].includes(key))renderChart();
    renderTable();
  }
  function preciseChange(a,b){const n=BigInt(a),p=BigInt(b);if(!p)return n?'New · no baseline':'No change';const basis=(n-p)*10000n/p,absolute=basis<0n?-basis:basis;return `${basis>0n?'+':basis<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}%`;}
  function groupDaily(rows,grain) {
    if(grain==='daily')return rows;
    const groups=new Map();
    for(const row of rows){let key=row.date;if(grain==='monthly')key=key.slice(0,7);else if(grain==='weekday')key=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(row.date+'T00:00:00Z').getUTCDay()];else {const d=new Date(row.date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);key=d.toISOString().slice(0,10);}if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    return [...groups].map(([date,values])=>({date,...totals(values)}));
  }
  function syncKpis() {
    const compare=state.input?.comparison;
    document.querySelectorAll('[data-gbp-metric]').forEach(button=>{
      const on=button.dataset.gbpMetric===state.chart;
      button.classList.toggle('is-charted',on);button.setAttribute('aria-pressed',String(on));
      if(compare==='none'){const note=button.querySelector('.gbp-kpi-note');if(note)note.textContent=on?'Charted below':'Show trend';}
    });
  }
  function renderChart() {
    const target=$('gbpChart');if(!target)return;
    const key=state.chart,current=state.series.daily,previous=state.series.previous;
    const values=[...current,...previous].map(row=>row[key]).filter(n=>n!=null),max=Math.max(1,...values),n=Math.max(current.length,previous.length,2);
    const width=780,height=196,left=52,right=10,top=16,base=170;
    const niceMax=(()=>{const step=Math.pow(10,Math.floor(Math.log10(max)));const rounded=Math.ceil(max/step)*step;return rounded||1;})();
    const x=index=>(left+index/(n-1)*(width-left-right)),y=value=>(base-value/niceMax*(base-top));
    const ticks=[0,0.25,0.5,0.75,1].map(fraction=>({value:niceMax*fraction,y:y(niceMax*fraction)}));
    const path=rows=>{const segments=[];let segment=[];rows.forEach((row,index)=>{if(row[key]==null){if(segment.length)segments.push(segment);segment=[];}else segment.push(`${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`);});if(segment.length)segments.push(segment);return segments.map(points=>`<polyline points="${points.join(' ')}"/>`).join('');};
    const labels=[0,Math.floor((n-1)/2),n-1].map(index=>({index,date:current[index]?.date||''})).filter(item=>item.date);
    target.innerHTML=`<div class="gbp-chart-head"><div><h4>${e(GBP_LABELS[key])}, daily</h4><p class="gbp-caption">Gaps mean unavailable data; period lengths can differ.</p></div>${select('gbpChartMetric',Object.entries(GBP_LABELS))}</div>`
      +`<div class="gbp-chart-plot">`
      +`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${e(GBP_LABELS[key])} daily trend for the current and previous period. Exact values are in the accessible table below.">`
      +ticks.map(tick=>`<line class="gbp-gridline" x1="${left}" y1="${tick.y.toFixed(1)}" x2="${width-right}" y2="${tick.y.toFixed(1)}"></line>`).join('')
      +ticks.map(tick=>`<text class="gbp-axis" x="${left-8}" y="${(tick.y+3.5).toFixed(1)}" text-anchor="end">${e(format(Math.round(tick.value)))}</text>`).join('')
      +labels.map(item=>`<text class="gbp-axis" x="${Math.min(width-right-28,Math.max(left,x(item.index)-14)).toFixed(1)}" y="${height-6}">${e(item.date.slice(5))}</text>`).join('')
      +`<g class="gbp-prior-line">${path(previous)}</g><g class="gbp-current-line" data-anim="line">${path(current)}</g>`
      +`<g class="gbp-crosshair" hidden><line y1="${top}" y2="${base}"></line><circle r="4"></circle></g>`
      +`<rect class="gbp-chart-hit" x="${left}" y="${top}" width="${width-left-right}" height="${base-top}" fill="transparent"></rect>`
      +`</svg>`
      +`<div class="gbp-tip" hidden></div>`
      +`</div>`
      +`<div class="gbp-chart-legend"><span class="gbp-legend-current">Current</span><span class="gbp-legend-prior">Previous</span><span>Peak ${e(format(max))}</span></div>`
      +`<details><summary>Accessible daily values</summary><div class="gbp-table-wrap"><table><thead><tr><th scope="col">Day</th><th scope="col">Current date</th><th scope="col">Current value</th><th scope="col">Previous date</th><th scope="col">Previous value</th></tr></thead><tbody>${Array.from({length:n},(_,i)=>`<tr><td>${i+1}</td><td>${e(current[i]?.date||'—')}</td><td>${e(format(current[i]?.[key]))}</td><td>${e(previous[i]?.date||'—')}</td><td>${e(format(previous[i]?.[key]))}</td></tr>`).join('')}</tbody></table></div></details>`;
    $('gbpChartMetric').value=key;$('gbpChartMetric').onchange=event=>{state.chart=event.target.value;syncKpis();renderChart();};
    const svg=target.querySelector('svg'),hit=target.querySelector('.gbp-chart-hit'),cross=target.querySelector('.gbp-crosshair'),tip=target.querySelector('.gbp-tip');
    const hide=()=>{cross.hidden=true;tip.hidden=true;};
    hit.addEventListener('pointerleave',hide);
    hit.addEventListener('pointermove',event=>{
      const box=svg.getBoundingClientRect();
      const ratio=(event.clientX-box.left)/box.width*width;
      const index=Math.max(0,Math.min(n-1,Math.round((ratio-left)/(width-left-right)*(n-1))));
      const row=current[index],prior=previous[index];
      if(!row||row[key]==null){hide();return;}
      cross.hidden=false;
      cross.querySelector('line').setAttribute('x1',x(index).toFixed(1));
      cross.querySelector('line').setAttribute('x2',x(index).toFixed(1));
      cross.querySelector('circle').setAttribute('cx',x(index).toFixed(1));
      cross.querySelector('circle').setAttribute('cy',y(row[key]).toFixed(1));
      tip.hidden=false;
      tip.style.left=`${Math.min(82,Math.max(4,(x(index)-left)/(width-left-right)*100))}%`;
      tip.innerHTML=`<strong>${e(row.date)}</strong><span class="gbp-tip-current">Current <b>${e(format(row[key]))}</b></span>`
        +(prior?`<span class="gbp-tip-prior">Previous <b>${e(format(prior[key]))}</b></span>`:'');
    });
    syncKpis();
    reveal('line');
  }
  function renderTable() {
    const visible=state.columns.filter(col=>state.visible.has(col.key));
    let rows=state.rows.map((row,index)=>({...row,__index:index})).filter(row=>!state.search||state.columns.some(col=>String(row[col.key]??'').toLowerCase().includes(state.search.toLowerCase())));
    if(state.sort){const {key,direction}=state.sort;rows.sort((a,b)=>{if(a[key]==null)return b[key]==null?0:1;if(b[key]==null)return -1;return direction*(typeof a[key]==='number'?a[key]-b[key]:String(a[key]).localeCompare(String(b[key]),undefined,{numeric:true}));});}
    const pages=Math.max(1,Math.ceil(rows.length/state.pageSize));state.page=Math.max(0,Math.min(state.page,pages-1));const slice=rows.slice(state.page*state.pageSize,(state.page+1)*state.pageSize);
    $('gbpTable').innerHTML=`<div class="gbp-table-wrap"><table><thead><tr>${visible.map(col=>`<th scope="col" aria-sort="${state.sort?.key===col.key?(state.sort.direction===1?'ascending':'descending'):'none'}"><button type="button" data-gbp-sort="${e(col.key)}">${e(col.label)} ${state.sort?.key===col.key?(state.sort.direction===1?'↑':'↓'):''}</button></th>`).join('')}<th scope="col">Details</th></tr></thead><tbody>${slice.map(row=>`<tr data-anim="row">${visible.map(col=>`<td class="${col.type==='number'?'gbp-number':''}">${e(col.type==='number'?format(row[col.key]):row[col.key]??'—')}</td>`).join('')}<td>${row.locationName?`<button class="gbp-detail-button" type="button" data-gbp-detail="${row.__index}">Open</button>`:'—'}</td></tr>`).join('')||`<tr><td colspan="${visible.length+1}">No matching rows.</td></tr>`}</tbody></table></div>`;
    $('gbpPageLabel').textContent=`${rows.length} rows · ${state.page+1}/${pages}`;$('gbpPrev').disabled=state.page===0;$('gbpNext').disabled=state.page===pages-1;
    document.querySelectorAll('[data-gbp-sort]').forEach(button=>button.onclick=()=>{state.sort={key:button.dataset.gbpSort,direction:state.sort?.key===button.dataset.gbpSort?-state.sort.direction:1};renderTable();});
    document.querySelectorAll('[data-gbp-detail]').forEach(button=>button.onclick=()=>inspect(state.rows[Number(button.dataset.gbpDetail)]));
    if(state.fresh){state.fresh=false;revealRows();}
  }
  function inspect(row) {
    const item=state.data.find(item=>item.location.name===row.locationName),target=$('gbpInspector');if(!item)return;
    const location=item.audit?.profile||item.location;
    let html=`<div class="gbp-inspector-head"><div><span class="eyebrow">Location details</span><h4>${e(location.title)}</h4><small>${e(location.name)}</small></div><button id="gbpCloseInspector" type="button" class="btn-top">Close</button></div>`;
    if(location.metadata?.mapsUri){try{const uri=new URL(location.metadata.mapsUri);if(uri.protocol==='https:')html+=`<p><a href="${e(uri.href)}" target="_blank" rel="noopener noreferrer">Open business listing in Google Maps ↗</a></p>`;}catch{}}
    if(row.reviewId){html+=`<p>${e(row.reviewer)} · ${row.rating}★ · ${e(row.created)}</p><blockquote>${e(row.comment||'No written comment')}</blockquote><p><strong>Current reply</strong></p><blockquote>${e(row.reply||'Unanswered')}</blockquote><button id="gbpReply" type="button" class="btn-top">Draft reply</button>`;}
    else {
      html+=`<dl class="gbp-profile-list"><dt>Category</dt><dd>${e(location.categories?.primaryCategory?.displayName||'Unavailable')}</dd><dt>Website</dt><dd>${e(location.websiteUri||'Not supplied')}</dd><dt>Phone</dt><dd>${e(location.phoneNumbers?.primaryPhone||'Not supplied')}</dd><dt>Hours</dt><dd>${e(location.regularHours?.periods?.map(period=>`${period.openDay} ${period.openTime?.hours||0}:${String(period.openTime?.minutes||0).padStart(2,'0')} → ${period.closeDay} ${period.closeTime?.hours||0}:${String(period.closeTime?.minutes||0).padStart(2,'0')}`).join(' · ')||'Not supplied')}</dd><dt>Address / service area</dt><dd>${e(location.storefrontAddress?Object.values(location.storefrontAddress).flat().join(', '):JSON.stringify(location.serviceArea||{}))}</dd></dl>`;
      if(item.audit){
        const changed=(item.audit.googleChanges?.diffMask||'').split(',').filter(Boolean),get=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object),describe=value=>value==null?'Not supplied':typeof value==='object'?JSON.stringify(value):String(value);
        const standing=item.audit.verification;
        html+=`<ul class="gbp-checklist">${item.audit.checks.map(check=>`<li>${check.applicable?(check.present?'✓':'○'):'—'} ${e(check.label)} <small>${check.applicable?'':'Not applicable'}</small></li>`).join('')}</ul><h4>Merchant standing</h4><p>${e(standing?standing.hasVoiceOfMerchant?'Good standing':standing.verify?'Verification required':standing.waitForVoiceOfMerchant?'Under review':standing.resolveOwnershipConflict?'Ownership conflict':standing.complyWithGuidelines?.recommendationReason||'Action required':'Status unavailable')}</p><h4>Google changes</h4>${changed.length?`<div class="gbp-table-wrap"><table><thead><tr><th>Field</th><th>Current profile</th><th>Google version</th></tr></thead><tbody>${changed.map(path=>`<tr><td>${e(path)}</td><td>${e(describe(get(location,path)))}</td><td>${e(describe(get(item.audit.googleChanges.location,path)))}</td></tr>`).join('')}</tbody></table></div>`:'<p>No changed fields returned.</p>'}<details><summary>Attributes and access diagnostics</summary><pre>${e(JSON.stringify({attributes:item.audit.attributes,actionLinks:item.audit.actionLinks,capabilities:item.audit.capabilities},null,2))}</pre></details>`;
      }
      if(row.raw)html+=`<details><summary>Content details</summary><pre>${e(JSON.stringify(row.raw,null,2))}</pre></details>`;
      html+='<div class="gbp-actions"><button id="gbpNewPost" class="btn-top" type="button">Draft post</button><button id="gbpEditProfile" class="btn-top" type="button">Edit profile field</button><button id="gbpAddPhoto" class="btn-top" type="button">Add photo by URL</button></div>';
    }
    html+='<div id="gbpDraft"></div>';
    target.innerHTML=html;target.hidden=false;
    if(typeof target.animate==='function'&&!calm())target.animate([{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'none'}],{duration:240,easing:ENTER,fill:'backwards'});
    $('gbpCloseInspector').onclick=()=>{if(!state.writeBusy){target.hidden=true;target.innerHTML='';}};
    $('gbpReply')?.addEventListener('click',()=>draft(item,'reply',row));$('gbpNewPost')?.addEventListener('click',()=>draft(item,'post'));$('gbpEditProfile')?.addEventListener('click',()=>draft(item,'profile'));
    $('gbpAddPhoto')?.addEventListener('click',()=>draft(item,'media'));
    target.scrollIntoView({behavior:'smooth',block:'start'});$('gbpCloseInspector').focus();
  }
  function draft(item,action,row={}) {
    if(state.writeBusy)return;
    const target=$('gbpDraft'),location=item.audit?.profile||item.location;
    target.innerHTML=`<h4>${action==='reply'?'Reply draft':action==='post'?'New update post':'Profile field edit'}</h4><p class="gbp-caption">Review the exact location and content before submitting. This changes your public business profile.</p>${action==='profile'?field('gbpEditField','Field',select('gbpEditField',[['websiteUri','Website URL'],['phoneNumbers.primaryPhone','Primary phone'],['profile.description','Description']])):''}${field('gbpDraftText',action==='reply'?'Reply':action==='post'?'Post text':'New value',`<textarea id="gbpDraftText" rows="5" maxlength="${action==='reply'?4096:action==='post'?1500:750}">${e(action==='reply'?row.reply||'':'')}</textarea>`)}${action==='post'?field('gbpPostUrl','Optional Learn more URL',input('gbpPostUrl','url'))+field('gbpPostLanguage','Language code',input('gbpPostLanguage','text','value="en" maxlength="10"')):''}<button id="gbpPreviewWrite" class="btn-top" type="button">Preview change</button><div id="gbpWritePreview"></div>`;
    if(action==='profile'){
      const update=()=>{$('gbpDraftText').value=$('gbpEditField').value==='websiteUri'?location.websiteUri||'':$('gbpEditField').value==='profile.description'?location.profile?.description||'':location.phoneNumbers?.primaryPhone||'';};$('gbpEditField').onchange=()=>{update();$('gbpWritePreview').innerHTML='';};update();
    }
    target.querySelectorAll('input,textarea').forEach(el=>el.addEventListener('input',()=>{$('gbpWritePreview').innerHTML='';}));
    if(action==='media'){
      target.querySelector('h4').textContent='Photo by public URL';
      const label=$('gbpDraftText').closest('label').querySelector('span');label.textContent='Public HTTPS image URL';
      $('gbpDraftText').rows=2;
      $('gbpDraftText').maxLength=2048;
      const field=document.createElement('label');field.className='gbp-field';field.innerHTML=`<span>Photo category</span>${select('gbpPhotoCategory',[['ADDITIONAL','Additional'],['EXTERIOR','Exterior'],['INTERIOR','Interior']])}`;
      target.insertBefore(field,$('gbpPreviewWrite'));
      $('gbpPhotoCategory').onchange=()=>{$('gbpWritePreview').innerHTML='';};
    }
    $('gbpPreviewWrite').onclick=()=>{
      const value=$('gbpDraftText').value.trim();if(!value){status('Enter the proposed content first.',true);return;}
      const payload={action,locationName:item.location.name,accountName:item.location.accountName,confirmed:true};
      payload.expectedEmail=getIdentity().split(':').slice(1).join(':');
      if(action==='reply')Object.assign(payload,{reviewId:row.reviewId,comment:value});
      if(action==='post')Object.assign(payload,{summary:value,url:$('gbpPostUrl').value.trim(),languageCode:$('gbpPostLanguage').value.trim()});
      if(action==='profile')Object.assign(payload,{field:$('gbpEditField').value,value});
      if(action==='media')Object.assign(payload,{sourceUrl:value,category:$('gbpPhotoCategory').value});
      const identity=getIdentity();
      $('gbpWritePreview').innerHTML=`<div class="gbp-write-preview"><strong>${e(item.location.title)} · ${e(action)}</strong><p>${action==='profile'?e(payload.field):action==='reply'?`Review by ${e(row.reviewer)} (${row.rating}★)`:e(payload.languageCode)}</p><blockquote>${e(value)}</blockquote>${payload.url?`<p>${e(payload.url)}</p>`:''}<label class="gbp-consent"><input id="gbpWriteConsent" type="checkbox"> I am authorized to publish this change for this location.</label><button id="gbpSubmitWrite" class="btn-top" type="button" disabled>Submit ${action==='reply'?'reply':action==='post'?'post':'profile change'}</button><p id="gbpWriteStatus" role="status"></p></div>`;
      $('gbpWriteConsent').onchange=event=>{$('gbpSubmitWrite').disabled=!event.target.checked;};
      if(action==='media')$('gbpSubmitWrite').textContent='Submit photo';
      $('gbpSubmitWrite').onclick=async()=>{
        if(state.writeBusy||identity!==getIdentity()||!$('gbpWriteConsent').checked)return;
        state.writeBusy=true;const submit=$('gbpSubmitWrite'),note=$('gbpWriteStatus');submit.disabled=true;
        target.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=true);note.textContent='Submitting…';
        try {
          const accepted=await request('gbpWrite',payload);if(identity!==getIdentity())return;note.textContent='Google accepted the change. Refresh the report to verify its current state.';state.stale=true;status('Google accepted the change. Run the report again to refresh results.');
          if(action==='profile'){if(item.audit)item.audit.profile=accepted;Object.assign(item.location,accepted);}
          if(action==='reply'){row.reply=value;row.reviewReply={comment:value};const original=item.reviews?.rows.find(review=>review.reviewId===row.reviewId);if(original)original.reviewReply={comment:value};renderTable();}
        }catch(error){note.textContent=error.message;}
        finally{state.writeBusy=false;const close=$('gbpCloseInspector');if(close)close.disabled=false;}
      };
    };
  }
  function reset(){state.loadToken++;state.runToken++;state.discovery=null;state.loading=false;state.busy=false;state.data=[];state.rows=[];state.series=null;state.errors=[];state.selection.clear();state.restoredSelection=null;void clearRun();if(!$('gbpAccount'))return;setReport('overview');setSetup(true);runChips(null);$('gbpAccountChip').hidden=true;$('gbpAccount').innerHTML=option('','Reconnect Google to load');$('gbpLocations').innerHTML='';$('gbpSelectedChips').innerHTML='';$('gbpProgress').hidden=true;renderSelection();$('gbpResult').innerHTML='';$('gbpInspector').innerHTML='';$('gbpInspector').hidden=true;status('Connect Google, then reload accounts and locations.');buttons();}
  function applyClient(client){if(!$('gbpMappingNote'))return;invalidate();const matches=!client?.gbpGoogleIdentity||client.gbpGoogleIdentity===getIdentity();fillLocations(matches?client?.gbpLocationNames||[]:[]);$('gbpMappingNote').textContent=client?`Client: ${client.name} · ${matches?(client.gbpLocationNames?.length||0)+' mapped locations':'mapping belongs to another Google account'}`:'Select a saved client to map these locations.';}
  function mount() {
    const panel=$('panelGbp');if(!panel)return;
    panel.innerHTML=`<div class="gbp-context">
      <div class="gbp-context-top">
        <span class="gbp-mark" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"></path><path d="M4 9v11h16V9"></path><path d="M9 20v-6h6v6"></path></svg></span>
        <div class="gbp-id"><span class="eyebrow">Local business</span><h3>Google Business Profile</h3></div>
        <span id="gbpAccountChip" class="gbp-pill" hidden></span>
        <div class="gbp-actions">
          <button id="gbpEditRun" class="btn-top" type="button" hidden>Edit run</button>
          <button id="gbpCancel" class="btn-top" type="button" hidden>Cancel</button>
          <button id="gbpRun" class="btn-top btn-run" type="button" disabled>Run report</button>
        </div>
      </div>
      <p id="gbpConnection" class="gbp-caption">Uses your connected Google account. Reconnect Google to grant Business Profile access.</p>
      <div id="gbpRunChips" class="gbp-runchips" hidden></div>
      <div id="gbpRail" class="gbp-rail" role="tablist" aria-label="Report">${GBP_REPORTS.map(([id,label])=>`<button class="gbp-rail-tab${id==='overview'?' is-active':''}" type="button" role="tab" id="gbpTab-${id}" data-gbp-report="${e(id)}" aria-selected="${id==='overview'}">${e(label)}<span class="gbp-rail-count" data-gbp-count="${e(id)}" hidden></span></button>`).join('')}</div>
    </div>
    <div id="gbpSetup" class="gbp-setup">
      <section class="gbp-step">
        <div class="gbp-step-head"><span class="gbp-step-mark">1</span><h4>Which locations</h4><span id="gbpSelectionCount" class="gbp-step-meta">0 selected</span></div>
        <div class="gbp-controls">${field('gbpAccount','Account or group',select('gbpAccount',[['','Reload accounts to begin']]))}${field('gbpLocationSearch','Find locations',input('gbpLocationSearch','search','placeholder="Name or store code"'))}</div>
        <div class="gbp-field"><span id="gbpLocationsLabel">Choose locations</span><div id="gbpLocations" class="gbp-location-list" role="group" aria-labelledby="gbpLocationsLabel" aria-describedby="gbpSelectionHelp"></div></div>
        <div id="gbpSelectedChips" class="gbp-chips" role="list" aria-label="Selected locations" aria-live="polite"></div>
        <p id="gbpSelectionHelp" class="gbp-caption">Tick each location to include. Searching or filtering narrows the list without clearing your selection.</p>
        <div class="gbp-actions">
          <button id="gbpSelectAll" class="btn-top" type="button">Select all shown</button>
          <button id="gbpSelectNone" class="btn-top" type="button">Clear selection</button>
          <button id="gbpRefresh" class="btn-top" type="button">Reload accounts &amp; locations</button>
          <button id="gbpSaveMapping" class="btn-top" type="button">Map to current client</button>
        </div>
        <p id="gbpMappingNote" class="gbp-caption"></p>
      </section>
      <section class="gbp-step">
        <div class="gbp-step-head"><span class="gbp-step-mark">2</span><h4>Over what dates</h4></div>
        <div id="gbpDailyControls" class="gbp-controls">${field('gbpRange','Date range',select('gbpRange',[['30','Last 30 completed days'],['7','Last 7 completed days'],['90','Last 90 completed days'],['yesterday','Yesterday'],['this_month','This month (includes today)'],['last_month','Last month'],['year_to_date','Year to date (includes today)'],['custom','Custom']]))}${field('gbpCompare','Compare with',select('gbpCompare',[['none','No comparison'],['previous_period','Previous period'],['previous_year','Previous year'],['custom','Custom earlier period']]))}<div id="gbpCustomDates" class="gbp-pair" hidden>${field('gbpStart','Start date',input('gbpStart','date'))}${field('gbpEnd','End date',input('gbpEnd','date'))}</div><div id="gbpCustomCompare" class="gbp-pair" hidden>${field('gbpCompareStart','Comparison start',input('gbpCompareStart','date'))}${field('gbpCompareEnd','Comparison end',input('gbpCompareEnd','date'))}</div></div>
        <div id="gbpMonthControls" class="gbp-controls" hidden>${field('gbpMonthStart','Start month',input('gbpMonthStart','month'))}${field('gbpMonthEnd','End month',input('gbpMonthEnd','month'))}${field('gbpMonthCompare','Monthly comparison',select('gbpMonthCompare',[['none','No comparison'],['previous','Previous equal month range'],['year','Previous year']]))}</div>
        <div class="gbp-controls">${field('gbpTimezone','Report timezone',input('gbpTimezone','text','placeholder="Asia/Kolkata"'))}</div>
        <p id="gbpPeriodNote" class="gbp-note"></p>
      </section>
      <details class="gbp-filters">
        <summary><span class="gbp-step-mark is-quiet">3</span>Filters and report options<span id="gbpFilterCount" class="gbp-applied" hidden></span></summary>
        <div class="gbp-controls">${field('gbpCategory','Category contains',input('gbpCategory'))}${field('gbpRegion','Address region contains',input('gbpRegion'))}${field('gbpLabel','Label contains',input('gbpLabel'))}${field('gbpOpen','Open status',select('gbpOpen',[['','Any'],['OPEN','Open'],['CLOSED_TEMPORARILY','Temporarily closed'],['CLOSED_PERMANENTLY','Permanently closed']]))}</div>
        <div id="gbpMetricFilters"><div class="gbp-controls">${field('gbpThresholdMetric','Location metric',select('gbpThresholdMetric',Object.entries(GBP_LABELS)))}${field('gbpThresholdOp','Operator',select('gbpThresholdOp',[['gte','At least'],['lte','At most']]))}${field('gbpThreshold','Threshold (optional)',input('gbpThreshold','number','min="0"'))}</div><div id="gbpOptionalMetrics" class="gbp-actions"><label><input type="checkbox" value="BUSINESS_BOOKINGS"> Include applicable bookings</label><label><input type="checkbox" value="BUSINESS_FOOD_MENU_CLICKS"> Include applicable menu interactions</label></div></div>
        <div id="gbpGrain" hidden>${field('gbpGrainSelect','Performance table grain',select('gbpGrainSelect',[['daily','Daily'],['weekly','Week starting Monday'],['monthly','Monthly'],['weekday','Weekday totals']]))}</div>
        <div id="gbpKeywordFilters" class="gbp-controls" hidden>${field('gbpKeywordText','Keyword contains',input('gbpKeywordText'))}${field('gbpKeywordExclude','Keyword excludes',input('gbpKeywordExclude'))}${field('gbpKeywordType','Value type',select('gbpKeywordType',[['','Any'],['exact','Exact count'],['threshold','Below threshold']]))}${field('gbpBrandTerms','Brand terms (comma separated)',input('gbpBrandTerms'))}${field('gbpBrandFilter','Your classification',select('gbpBrandFilter',[['','All'],['Brand','Brand'],['Nonbrand','Nonbrand']]))}</div>
        <div id="gbpReviewFilters" class="gbp-controls" hidden>${field('gbpReviewScope','Review dates',select('gbpReviewScope',[['period','Selected period'],['all','All currently retrievable']]))}${field('gbpReviewDate','Date field',select('gbpReviewDate',[['created','Created'],['updated','Updated']]))}${field('gbpRating','Stars',select('gbpRating',[['','Any'],...Array.from({length:5},(_,i)=>[String(i+1),`${i+1} stars`])]))}${field('gbpReplyFilter','Reply status',select('gbpReplyFilter',[['','Any'],['unreplied','Unanswered'],['replied','Replied']]))}${field('gbpCommentFilter','Written comment',select('gbpCommentFilter',[['','Any'],['with','With comment'],['without','Without comment']]))}${field('gbpReviewText','Review contains',input('gbpReviewText'))}${field('gbpReviewAge','Unanswered age ≥ days',input('gbpReviewAge','number','min="0"'))}</div>
        <div id="gbpContentFilters" class="gbp-controls" hidden>${field('gbpContentType','Content kind',select('gbpContentType',[['','All'],['Post','Posts'],['Media','Media']]))}${field('gbpContentText','Description or type contains',input('gbpContentText'))}${field('gbpContentState','Status contains',input('gbpContentState'))}<label><input id="gbpContentDates" type="checkbox"> Filter content by selected creation dates (UTC)</label></div>
      </details>
    </div>
    <p id="gbpDataNote" class="gbp-caption"></p>
    <div id="gbpStatus" role="status" aria-live="polite">Reload accounts and select locations to begin.</div>
    <div id="gbpProgress" class="gbp-progress" hidden><div class="gbp-progress-bar" role="progressbar" aria-label="Report progress" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0"><span id="gbpProgressFill"></span></div><p id="gbpProgressText" class="gbp-caption"></p></div>
    <div id="gbpResult"></div>
    <section id="gbpInspector" class="gbp-inspector" aria-label="Report details and actions" hidden></section>`;
    $('gbpTimezone').value=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);$('gbpMonthStart').value=$('gbpMonthEnd').value=d.toISOString().slice(0,7);
    $('gbpRefresh').onclick=()=>load(true);$('gbpRun').onclick=run;$('gbpCancel').onclick=()=>{state.runToken++;state.busy=false;buttons();$('gbpProgress').hidden=true;status('Cancelled. Already-issued requests may still finish; run again for a complete report.');};
    $('gbpSelectAll').onclick=()=>{fillLocations([...new Set([...selected(),...(state.discovery?.locations||[]).filter(filterLocations).map(location=>location.name)])]);invalidate();};$('gbpSelectNone').onclick=()=>{fillLocations([]);invalidate();};
    for(const id of ['gbpAccount','gbpLocationSearch','gbpCategory','gbpRegion','gbpLabel','gbpOpen'])$(id).addEventListener(id.includes('Search')?'input':'change',()=>{invalidate();fillLocations();});
    panel.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',()=>{invalidate();modes();renderSelection();periodNote();filterCount();}));
    panel.querySelectorAll('[data-gbp-report]').forEach(tab=>{tab.onclick=()=>{setReport(tab.dataset.gbpReport);invalidate();periodNote();filterCount();};});
    $('gbpEditRun').onclick=()=>setSetup(true);
    $('gbpSaveMapping').onclick=async()=>{const client=getClient();if(!client){status('Select a saved client before mapping locations.',true);return;}const event=new CustomEvent('gbp-map-client',{detail:{clientId:client.id,names:selected()}});document.dispatchEvent(event);};
    setReport('overview');buttons();applyClient(getClient());periodNote();filterCount();
  }
  return {mount,load,run,reset,applyClient,selected,state};
}
