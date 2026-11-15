import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAdsUI} from '../ads-ui.js';
import { ADS_REPORTS, getReport, metricKeys, aggregateRows, summarizeRows, reportDates, comparisonDates, validateDate, validateFilters, buildReportQuery, formatValue, csvCell } from '../ads-reporting.js';
import { createAdsApi } from '../ads-api.js';

const customerId = '1234567890';
const account = { id:customerId, descriptiveName:'Test account', currencyCode:'INR', timeZone:'Asia/Kolkata', manager:false, status:'ENABLED' };
const raw = (id, date, cost, conversions, impressions = 100, clicks = 10) => ({ campaign:{id:String(id),name:`Campaign ${id}`,status:'ENABLED',advertisingChannelType:'SEARCH'}, segments:{date}, metrics:{costMicros:cost*1e6,conversions,conversionsValue:conversions*100,impressions,clicks,interactions:clicks} });
function apiFor(rows, extras = {}) {
  const calls = [];
  const api = createAdsApi({ getConfig:async()=>({}), ...extras, request:async(path,options,login) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({path,...body,login});
    if (/ FROM customer$/.test(body.query)) return {results:[{customer:account}]};
    if (extras.respond) return extras.respond(path,body,login);
    return {results:rows};
  }});
  return {api,calls};
}
const input = {customerId,preset:'campaign_performance',range:'custom',custom:{startDate:'2026-09-01',endDate:'2026-09-02'}};

test('all old presets have explicit conversion columns, without a ten-column cap',()=>{
  for(const id of ['campaign_performance','ad_group_performance','keyword_performance','asset_performance']){
    assert.ok(metricKeys(getReport(id)).includes('conversions'));
    assert.ok(metricKeys(getReport(id)).includes('value'));
    assert.ok(metricKeys(getReport(id)).includes('cost'));
  }
});
test('totals calculate weighted rates and retain fractional conversion attribution',()=>{
  const definition=getReport('campaign_performance');
  const rows=aggregateRows([raw(1,'2026-09-01',10,0.5,100,10),raw(1,'2026-09-02',30,1.25,900,30)],definition);
  assert.equal(rows.length,1);
  const summary=summarizeRows(rows,definition);
  assert.equal(summary.cost,40);assert.equal(summary.conversions,1.75);
  assert.equal(summary.ctr,0.04);assert.equal(summary.cpc,1);
  assert.equal(summary.cvr,1.75/40);assert.equal(summary.roas,175/40);
});
test('zero denominators display missing rates instead of infinity or zero CPA',()=>{
  const rows=aggregateRows([raw(1,'2026-09-01',10,0,0,0)],getReport('campaign_performance'));
  assert.equal(rows[0].metrics.cpa,null);assert.equal(rows[0].metrics.ctr,null);
  assert.equal(formatValue(null,'money','INR'),'—');
});
test('date presets use the account day across UTC boundaries',()=>{
  const now=new Date('2026-10-01T23:30:00Z');
  assert.deepEqual(reportDates('yesterday','Asia/Kolkata',{},now),{startDate:'2026-10-01',endDate:'2026-10-01'});
  assert.deepEqual(reportDates('yesterday','America/Los_Angeles',{},now),{startDate:'2026-09-30',endDate:'2026-09-30'});
  assert.deepEqual(reportDates('last_month','Asia/Kolkata',{},now),{startDate:'2026-09-01',endDate:'2026-09-30'});
});
test('custom dates reject impossible dates, reversed ranges, and future dates',()=>{
  assert.throws(()=>validateDate('2026-02-30'));
  assert.throws(()=>reportDates('custom','UTC',{startDate:'2026-02-02',endDate:'2026-02-01'}));
  assert.throws(()=>reportDates('custom','UTC',{startDate:'2099-01-01',endDate:'2099-01-02'}));
});
test('comparison ranges cover equal prior periods and clamp leap days',()=>{
  assert.deepEqual(comparisonDates('previous_period',{startDate:'2026-09-01',endDate:'2026-09-30'}),{startDate:'2026-08-02',endDate:'2026-08-31'});
  assert.deepEqual(comparisonDates('previous_year',{startDate:'2024-02-29',endDate:'2024-03-01'}),{startDate:'2023-02-28',endDate:'2023-03-01'});
  assert.throws(()=>comparisonDates('custom',{startDate:'2026-09-01',endDate:'2026-09-30'},{startDate:'2026-08-01',endDate:'2026-09-01'}));
});
test('GAQL is bounded to supported schemas and rejects injected IDs or enums',()=>{
  assert.throws(()=>buildReportQuery('campaign_performance',input.custom,{campaign:['1) OR 1=1']}));
  assert.throws(()=>buildReportQuery('campaign_performance',input.custom,{status:"ENABLED' OR 1=1"}));
  assert.throws(()=>buildReportQuery('campaign_performance',input.custom,{adGroup:['1']}));
  assert.throws(()=>validateFilters(getReport('conversion_actions'),{thresholds:[{metric:'cost',operator:'gte',value:1}]}));
  const query=buildReportQuery('pmax_search_terms',input.custom,{campaign:['11']});
  assert.match(query,/FROM campaign_search_term_view/);assert.doesNotMatch(query,/keyword|LIMIT/);
});
test('Shopping product queries omit unsupported interactions and derived CVR',()=>{
  const query=buildReportQuery('shopping_products',input.custom);
  assert.doesNotMatch(query,/metrics.interactions/);
  assert.ok(!metricKeys(getReport('shopping_products')).includes('cvr'));
});
test('all report metrics and segments exist in the checked official v25 resource references',()=>{
  const reference=JSON.parse(fs.readFileSync(new URL('./ads-reference.json',import.meta.url),'utf8'));
  for(const [id,definition] of Object.entries(ADS_REPORTS)){
    const known=new Set(reference[definition.resource].fields);
    const fields=[...definition.dimensions.map(d=>d.field),'segments.date',...definition.metrics.map(key=>'metrics.'+key),...(definition.diagnostics||[]).map(key=>'metrics.'+key)];
    for(const field of fields.filter(f=>f.startsWith('metrics.')||f.startsWith('segments.')||f.startsWith(definition.resource+'.'))) assert.ok(known.has(field),`${id}: ${field}`);
    for(const [key,field] of [['device','segments.device'],['network','segments.ad_network_type']]) if(definition.filters.includes(key)) assert.ok(known.has(field),`${id}: ${key}`);
  }
});
test('pagination loads beyond 250 rows and totals include every page',async()=>{
  const rows=Array.from({length:351},(_,i)=>raw(i+1,'2026-09-01',1,0.5));
  const {api,calls}=apiFor([], {respond:async(path,body)=>body.pageToken?{results:rows.slice(250)}:{results:rows.slice(0,250),nextPageToken:'next'}});
  const result=await api.run(input);
  assert.equal(result.rows.length,351);assert.equal(result.summary.cost,351);assert.equal(result.summary.conversions,175.5);
  assert.equal(result.complete,true);assert.equal(calls.filter(call=>call.pageToken==='next').length,1);
});
test('repeated page tokens fail instead of returning incomplete totals',async()=>{
  const {api}=apiFor([], {respond:async()=>({results:[raw(1,'2026-09-01',1,1)],nextPageToken:'same'})});
  await assert.rejects(api.run(input),/repeated page token/);
});
test('row limits fail before publishing partial totals',async()=>{
  const {api}=apiFor([raw(1,'2026-09-01',1,1),raw(2,'2026-09-01',1,1)],{maxRows:1});
  await assert.rejects(api.run(input),/no partial totals/);
});
test('metric conditions act on period totals and the trend uses the identical selected entities',async()=>{
  const {api}=apiFor([raw(1,'2026-09-01',10,1),raw(1,'2026-09-02',20,1),raw(2,'2026-09-01',5,1)]);
  const result=await api.run({...input,filters:{thresholds:[{metric:'cost',operator:'gte',value:25}]}});
  assert.equal(result.rows.length,1);assert.equal(result.summary.cost,30);
  assert.deepEqual(result.series.map(day=>day.cost),[10,20]);
});
test('text exclusion and case-insensitive name filters also scope summaries',async()=>{
  const {api}=apiFor([raw(1,'2026-09-01',10,1),raw(2,'2026-09-01',5,1)]);
  const result=await api.run({...input,filters:{campaignName:'CAMPAIGN 2'}});
  assert.equal(result.summary.cost,5);
});
test('comparison keeps the same current-period cohort rather than including unselected past entities',async()=>{
  const {api}=apiFor([], {respond:async(path,body)=>body.query.includes("'2026-08-30'")?{results:[raw(1,'2026-08-30',50,1),raw(2,'2026-08-30',100,10)]}:{results:[raw(1,'2026-09-01',20,1),raw(2,'2026-09-01',5,1)]}});
  const result=await api.run({...input,compareMode:'previous_period',filters:{thresholds:[{metric:'cost',operator:'gte',value:10}]}});
  assert.equal(result.summary.cost,20);assert.equal(result.previousSummary.cost,50);
  assert.equal(result.previousRows.length,1);
});
test('zero results still produce complete zero totals and a zero-filled trend',async()=>{
  const {api}=apiFor([]);const result=await api.run(input);
  assert.equal(result.rows.length,0);assert.equal(result.summary.cost,0);assert.equal(result.series.length,2);
});
test('unconditioned account comparisons retain campaigns active only in the previous period',async()=>{
  const {api}=apiFor([], {respond:async(path,body)=>body.query.includes("'2026-08-30'")?{results:[raw(1,'2026-08-30',50,1),raw(2,'2026-08-30',100,10)]}:{results:[raw(1,'2026-09-01',20,1)]}});
  const result=await api.run({...input,compareMode:'previous_period'});
  assert.equal(result.summary.cost,20);assert.equal(result.previousSummary.cost,150);
  assert.equal(result.previousRows.length,2);assert.equal(result.previousSeries[0].cost,150);
});
test('campaign names and keywords retain literal underscores',()=>{
  assert.equal(formatValue('Brand_US','text'),'Brand_US');
});
test('manager hierarchy discovery includes deep clients and preserves their login route',async()=>{
  const manager='9999999999';
  const api=createAdsApi({getConfig:async()=>({loginCustomerId:manager}),request:async(path,options)=>{
    if(path==='customers:listAccessibleCustomers') return {resourceNames:[`customers/${manager}`]};
    const query=JSON.parse(options.body).query;
    if(query.includes(' FROM customer_client ')){
      assert.doesNotMatch(query,/level <= 1/);
      return {results:[{customerClient:{id:customerId,descriptiveName:'Nested client',currencyCode:'INR',timeZone:'Asia/Kolkata',manager:false,level:3,status:'ENABLED'}}]};
    }
    return {results:[{customer:{...account,id:manager,manager:true}}]};
  }});
  const result=await api.listCustomers();const client=result.customers.find(item=>item.customerId===customerId);
  assert.equal(client.level,3);assert.equal(client.loginCustomerId,manager);
});
test('production access errors give the Cloud project action',async()=>{
  const api=createAdsApi({getConfig:async()=>({}),request:async()=>{throw new Error('CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION');}});
  await assert.rejects(api.run(input),/Cloud project.*production/);
});
test('the service worker error classifier preserves actionable reporting errors',()=>{
  const source=fs.readFileSync(new URL('../background.js',import.meta.url),'utf8');
  const classifier=source.slice(source.indexOf('function classifyError('),source.indexOf('const ROUTE_SOURCES'));
  const classify=vm.runInNewContext(classifier+';classifyError');
  const error=new Error('Permission denied');error.httpStatus=403;
  error.userMessage='The Cloud project needs production access. Request approval in Google Cloud Console.';
  assert.equal(classify(error,{source:'Google Ads'}).message,error.userMessage);
  assert.equal(typeof createAdsUI,'function');
});
test('CSV escapes quotes, newlines, and spreadsheet formulas',()=>{
  assert.equal(csvCell('a"b\nc'),'"a""b\nc"');assert.equal(csvCell('=1+1'),'"\'=1+1"');
});
test('share formatting only applies censorship to documented boundary values',()=>{
  assert.equal(formatValue(.0999,'share'),'<10%');assert.equal(formatValue(.9001,'share'),'>90%');
  assert.equal(formatValue(.95,'share'),'95.0%');
});
