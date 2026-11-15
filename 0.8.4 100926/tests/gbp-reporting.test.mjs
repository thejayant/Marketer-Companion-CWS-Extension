import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createGbpApi} from '../gbp-api.js';
import {createGbpUI} from '../gbp-ui.js';
import {dates,months,previousMonths,resource,keywordValue,count,normalizeDaily,periodTotals,combineDaily,change,filterReviews,reviewSummary,auditProfile,CORE_METRICS} from '../gbp-reporting.js';
import {gbpApi,gbpLocations,gbpFixtureRequest} from './gbp-fixture.js';
const input={locationName:'locations/8001',accountName:'accounts/100',report:'overview',range:'custom',startDate:'2026-09-01',endDate:'2026-09-30',comparison:'previous_period',timeZone:'Asia/Kolkata'};
const make=request=>createGbpApi({request,pace:0,sleep:async()=>{},now:()=>new Date('2026-10-02T00:00:00Z')});
test('date ranges use the named timezone and validate real dates',()=>{
  const result=dates({range:'yesterday',comparison:'previous_period',timeZone:'Asia/Kolkata'},new Date('2026-10-01T20:00:00Z'));
  assert.equal(result.current.endDate,'2026-10-01');assert.equal(result.previous.endDate,'2026-09-30');
  assert.throws(()=>dates({...input,startDate:'2026-02-30'}));assert.throws(()=>dates({...input,timeZone:'Unknown'}));
});
test('monthly ranges remain monthly and support equal-length and year comparisons',()=>{
  const list=months('2026-01','2026-03');assert.equal(list.length,3);assert.deepEqual(previousMonths(list,'previous'),['2025-10','2025-11','2025-12']);assert.equal(previousMonths(list,'year')[0],'2025-01');assert.throws(()=>months('2026-13','2026-13'));assert.throws(()=>months('2023-01','2026-01'));
});
test('keyword privacy thresholds and large integers are preserved exactly',()=>{
  assert.deepEqual(keywordValue({threshold:'15'}),{type:'threshold',value:'15'});assert.equal(keywordValue({value:'9007199254740993'}).value,'9007199254740993');assert.throws(()=>count('9007199254740993'));assert.throws(()=>keywordValue({value:'NaN'}));
});
test('resource identifiers reject injected paths and unrelated resources',()=>{
  assert.equal(resource('locations/123'),'locations/123');for(const id of ['locations/1/../2','https://evil','accounts/2','locations/x'])assert.throws(()=>resource(id));
});
test('daily totals use full metric coverage and never count breakdown series twice',()=>{
  const datedValues=[{date:{year:2026,month:9,day:1},value:'10'}];
  const data={multiDailyMetricTimeSeries:[{dailyMetricTimeSeries:[...CORE_METRICS.map(dailyMetric=>({dailyMetric,timeSeries:{datedValues}})),{dailyMetric:'WEBSITE_CLICKS',dailySubEntityType:{dayOfWeek:'MONDAY'},timeSeries:{datedValues}}]}]};
  const series=normalizeDaily(data);assert.equal(series.rows[0].impressions,40);assert.equal(series.rows[0].website,10);
  assert.equal(periodTotals({...series,range:{startDate:'2026-09-01',endDate:'2026-09-02'}}).website,null);
});
test('missing dates and locations remain unavailable in portfolio trends',()=>{
  const rows=combineDaily([{current:{rows:[{date:'2026-09-01',website:4}]}},{current:{rows:[{date:'2026-09-02',website:6}]}}]);assert.equal(rows[0].website,null);assert.equal(rows[1].website,null);assert.equal(change(10,0),'New · no baseline');assert.equal(change(null,3),'Unavailable');
});
test('review filters use creation/updated timestamps in the selected timezone',()=>{
  const row={starRating:'ONE',createTime:'2026-09-30T21:00:00Z',updateTime:'2026-10-02T01:00:00Z',comment:'Coffee'};
  assert.equal(filterReviews([row],{reply:'unreplied'}, {startDate:'2026-10-01',endDate:'2026-10-01'},'Asia/Kolkata').length,1);
  assert.equal(filterReviews([row],{dateField:'updated'}, {startDate:'2026-10-01',endDate:'2026-10-01'},'Asia/Kolkata').length,0);
  assert.equal(reviewSummary([row]).rating,1);
});
test('service-area audit does not require a storefront address',()=>{
  const audit=auditProfile({title:'Plumber',serviceArea:{businessType:'CUSTOMER_LOCATION_ONLY',places:{placeInfos:[{}]}},categories:{primaryCategory:{displayName:'Plumber'}}});assert.equal(audit.checks.find(row=>row.key==='address').applicable,false);assert.ok(audit.note.includes('not a Google ranking'));
});
test('organization discovery traverses nested groups and deduplicates location routes',async()=>{
  const api=make(async href=>{const url=new URL(href);if(url.hostname.includes('accountmanagement')){const parent=url.searchParams.get('parentAccount');return {accounts:!parent?[{name:'accounts/1',type:'ORGANIZATION'}]:parent==='accounts/1'?[{name:'accounts/2',type:'USER_GROUP'}]:[{name:'accounts/3',type:'LOCATION_GROUP'}]};}return {locations:[{name:'locations/10',title:'Test'}]};});
  const result=await api.discover();assert.equal(result.accounts.length,3);assert.equal(result.locations.length,1);assert.equal(result.locations[0].accountName,'accounts/3');assert.equal(result.locations[0].accountNames.length,3);
});
test('pagination retrieves all reviews beyond the fifty-row first page',async()=>{const data=await gbpApi.run({...input,report:'reviews'});assert.equal(data.reviews.rows.length,56);assert.equal(data.reviews.totalReviewCount,56);});
test('repeated page tokens reject incomplete reports',async()=>{const api=make(async()=>({reviews:[{}],nextPageToken:'same'}));await assert.rejects(()=>api.run({...input,report:'reviews'}),/repeated page token/);});
test('keyword paging is independent for every current and previous month',async()=>{const result=await gbpApi.run({...input,report:'keywords',monthStart:'2026-08',monthEnd:'2026-09',monthComparison:'previous'});assert.equal(result.keywords.length,6);assert.equal(result.previousKeywords.length,6);assert.equal(result.keywords[2].type,'threshold');});
test('daily reports have complete current and previous periods',async()=>{const result=await gbpApi.run(input);assert.equal(result.current.rows.length,30);assert.equal(result.previous.rows.length,30);assert.ok(periodTotals(result.current).website>0);});
test('a denied comparison preserves current results with explicit warnings',async()=>{const api=make(async(href,opts)=>{const url=new URL(href);if(url.searchParams.get('dailyRange.start_date.month')==='8')throw new Error('Comparison unavailable');return gbpFixtureRequest(href,opts);});const result=await api.run(input);assert.ok(result.current);assert.equal(result.previous,undefined);assert.equal(result.warnings.length,1);});
test('optional audit capability failures do not block profile audit',async()=>{const api=make(async(href,opts)=>{if(href.includes('/VoiceOfMerchantState'))throw Object.assign(new Error('Denied'),{httpStatus:403});return gbpFixtureRequest(href,opts);});const result=await api.run({...input,report:'audit'});assert.ok(result.audit.profile);assert.equal(result.audit.capabilities.find(row=>row.key==='verification').ok,false);});
test('rate-limited reads retry while writes are never automatically replayed',async()=>{
  let reads=0;const api=make(async()=>{if(++reads===1)throw Object.assign(new Error('Quota'),{httpStatus:429});return {reviews:[]};});await api.run({...input,report:'reviews'});assert.equal(reads,2);
  let writes=0;const failed=make(async()=>{writes++;throw Object.assign(new Error('Unavailable'),{httpStatus:503});});await assert.rejects(()=>failed.write({...input,action:'post',summary:'Hello',confirmed:true}),/Unavailable/);assert.equal(writes,1);
});
test('writes require explicit confirmation and supported fields / safe URLs',async()=>{
  const api=make(async()=>({}));await assert.rejects(()=>api.write({...input,action:'reply',reviewId:'a',comment:'Hello'}),/explicitly/);await assert.rejects(()=>api.write({...input,action:'profile',field:'title',value:'Bad',confirmed:true}),/Unsupported profile/);await assert.rejects(()=>api.write({...input,action:'post',summary:'Hello',url:'javascript:bad',confirmed:true}));
});
test('profile edits validate before mutation and then read back',async()=>{
  const calls=[];const api=make(async(href,options)=>{calls.push({url:new URL(href),options});return {};});await api.write({...input,action:'profile',field:'websiteUri',value:'https://example.com/new',confirmed:true});assert.equal(calls.length,3);assert.equal(calls[0].url.searchParams.get('validateOnly'),'true');assert.equal(calls[1].options.method,'PATCH');assert.equal(calls[2].options.method,undefined);
});
test('account switches between validation and submission prevent the write',async()=>{
  let scope='first',writes=0;const api=createGbpApi({pace:0,sleep:async()=>{},assertContext:async expected=>{if(expected!==scope)throw new Error('Account changed');},request:async()=>{writes++;scope='second';return {};}});await assert.rejects(()=>api.write({...input,action:'profile',field:'websiteUri',value:'https://example.com',confirmed:true,authScope:'first'}),/Account changed/);assert.equal(writes,1);
});
test('runtime package grants matching GBP scopes and includes every module',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url)));assert.ok(manifest.oauth2.scopes.includes('https://www.googleapis.com/auth/business.manage'));
  for(const host of ['mybusinessaccountmanagement','mybusinessbusinessinformation','businessprofileperformance','mybusiness','mybusinessverifications','mybusinessplaceactions'])assert.ok(manifest.host_permissions.includes(`https://${host}.googleapis.com/*`));
  assert.equal(typeof createGbpUI,'function');
});
test('photo publishing accepts only explicit HTTPS URLs and supported categories',async()=>{
  const calls=[];const api=make(async(href,options)=>{calls.push({href,options});return {};});
  await assert.rejects(()=>api.write({...input,action:'media',confirmed:true,sourceUrl:'http://example.com/image.jpg',category:'EXTERIOR'}),/HTTPS/);
  await api.write({...input,action:'media',confirmed:true,sourceUrl:'https://example.com/image.jpg',category:'EXTERIOR'});
  const body=JSON.parse(calls[0].options.body);assert.equal(body.mediaFormat,'PHOTO');assert.equal(body.locationAssociation.category,'EXTERIOR');
});
test('safety row bounds reject a full page before returning incomplete analytics',async()=>{
  const api=createGbpApi({request:async()=>({reviews:[{},{},{}]}),maxRows:2,pace:0,sleep:async()=>{}});await assert.rejects(()=>api.run({...input,report:'reviews'}),/row limit/);
});
test('the location picker, charted metric, comparison columns and session restore keep their UX contract',()=>{
  const source=fs.readFileSync(new URL('../gbp-ui.js',import.meta.url),'utf8');
  assert.ok(!/id="gbpLocations"[^>]*multiple/.test(source),'locations must not use a Ctrl/Command multi-select');
  assert.ok(source.includes('data-gbp-location='),'locations must render individual checkboxes');
  assert.ok(source.includes('data-gbp-deselect='),'selected locations must be removable from the chip list');
  assert.ok(/const on=state\.chart===metric/.test(source)&&/aria-pressed="\$\{on\}"/.test(source),'KPI tiles must expose their charted state');
  assert.ok(source.includes('data-gbp-report=')&&source.includes('role="tablist"'),'reports must be a visible rail, not a hidden select');
  assert.ok(source.includes('gbp-coverage')&&source.includes('is-partial'),'coverage must be stated before the numbers');
  assert.ok(source.includes("matchMedia('(prefers-reduced-motion: reduce)')"),'motion must honour reduced-motion');
  assert.ok(/input\.comparison==='none'\?\[\]:\[\['change'/.test(source),'the impression change column needs a comparison');
  assert.ok(source.includes('chrome.storage.session.set')&&source.includes('chrome.storage.session.remove'),'the last run must be kept in session storage and cleared on reset');
  assert.ok(source.includes('runKey(){return `gbpLastRun:${getIdentity()')," the stored run must be scoped to the signed-in identity");
  assert.ok(source.includes('role="progressbar"'),'portfolio runs need a progress indicator');
});
