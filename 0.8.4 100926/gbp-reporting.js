import { reportDates, comparisonDates, validateDate } from './ads-reporting.js';

export const GBP_REPORTS = [
  ['overview','Overview'], ['performance','Performance'], ['keywords','Search keywords'],
  ['reviews','Reviews'], ['locations','Locations'], ['content','Content inventory']
];
export const GBP_METRICS = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH:['desktopSearch','Search · desktop'],
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH:['mobileSearch','Search · mobile'],
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS:['desktopMaps','Maps · desktop'],
  BUSINESS_IMPRESSIONS_MOBILE_MAPS:['mobileMaps','Maps · mobile'],
  WEBSITE_CLICKS:['website','Website clicks'], CALL_CLICKS:['calls','Call clicks'],
  BUSINESS_DIRECTION_REQUESTS:['directions','Direction requests'],
  BUSINESS_BOOKINGS:['bookings','Bookings'], BUSINESS_FOOD_MENU_CLICKS:['menu','Menu interactions']
};
export const GBP_LABELS = Object.fromEntries(Object.values(GBP_METRICS).concat([
  ['impressions','Impressions'],['search','Search impressions'],['maps','Maps impressions'],
  ['desktop','Desktop impressions'],['mobile','Mobile impressions']
]));
export const CORE_METRICS = Object.keys(GBP_METRICS).filter(key=>!['BUSINESS_BOOKINGS','BUSINESS_FOOD_MENU_CLICKS'].includes(key));
export const PROFILE_MASK = 'name,title,storeCode,categories,storefrontAddress,phoneNumbers,websiteUri,regularHours,specialHours,serviceArea,labels,openInfo,metadata,profile,serviceItems';
export function resource(value,kind='locations') {
  const text=String(value||'');
  if(!new RegExp(`^${kind}/[0-9]+$`).test(text)) throw new Error(`Select a valid ${kind==='locations'?'location':'account'}.`);
  return text;
}
export function timezone(value) {
  const zone=String(value||'');
  try { new Intl.DateTimeFormat('en',{timeZone:zone}).format(); } catch { throw new Error('Enter a valid IANA report timezone, such as Asia/Kolkata.'); }
  return zone;
}
export function dates(input,now=new Date()) {
  const zone=timezone(input.timeZone);
  const current=reportDates(input.range||'30',zone,{startDate:input.startDate,endDate:input.endDate},now);
  const previous=comparisonDates(input.comparison||'none',current,{startDate:input.compareStart,endDate:input.compareEnd});
  return {current,previous,timeZone:zone};
}
export function months(start,end) {
  if(!/^\d{4}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}$/.test(end||'')) throw new Error('Choose a start and end month.');
  validateDate(`${start}-01`); validateDate(`${end}-01`);
  if(start>end) throw new Error('Start month must precede end month.');
  const result=[];
  let date=new Date(`${start}-01T00:00:00Z`);
  while(date.toISOString().slice(0,7)<=end) {
    result.push(date.toISOString().slice(0,7)); if(result.length>24) throw new Error('Choose no more than 24 months.');
    date.setUTCMonth(date.getUTCMonth()+1);
  }
  return result;
}
export function previousMonths(list,mode) {
  if(mode==='none') return [];
  if(!['previous','year'].includes(mode)) throw new Error('Choose a supported keyword comparison.');
  const shift=mode==='year'?12:list.length;
  return list.map(month=>{ const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()-shift);return d.toISOString().slice(0,7); });
}
export function count(value) {
  const text=String(value??'0');
  if(!/^\d+$/.test(text)) throw new Error('Google returned an invalid count.');
  const integer=BigInt(text);
  if(integer>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('A count exceeds safe chart precision. Narrow this report.');
  return Number(integer);
}
export function keywordValue(value={}) {
  const type=value.value!=null?'exact':value.threshold!=null?'threshold':'missing';
  const raw=type==='exact'?value.value:value.threshold;
  if(type!=='missing'&&!/^\d+$/.test(String(raw))) throw new Error('Google returned an invalid keyword count.');
  return {type,value:type==='missing'?null:String(raw)};
}
export function normalizeDaily(data) {
  const byDate=new Map(); const available=new Set();
  for(const group of data.multiDailyMetricTimeSeries||[]) for(const series of group.dailyMetricTimeSeries||[]) {
    const key=GBP_METRICS[series.dailyMetric]?.[0]; if(!key) continue;
    // Sub-entity series are distinct breakdowns: do not double count them.
    if(series.dailySubEntityType&&Object.keys(series.dailySubEntityType).length) continue;
    available.add(key);
    for(const point of series.timeSeries?.datedValues||[]) {
      const d=point.date; if(!d?.year||!d.month||!d.day) continue;
      const date=`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;validateDate(date);
      const row=byDate.get(date)||{date}; row[key]=count(point.value); byDate.set(date,row);
    }
  }
  const rows=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  for(const row of rows) derive(row);
  return {rows,available:[...available]};
}
export function derive(row) {
  for(const [key,parts] of Object.entries({search:['desktopSearch','mobileSearch'],maps:['desktopMaps','mobileMaps'],desktop:['desktopSearch','desktopMaps'],mobile:['mobileSearch','mobileMaps'],impressions:['desktopSearch','mobileSearch','desktopMaps','mobileMaps']})) {
    row[key]=parts.every(part=>row[part]!=null)?parts.reduce((sum,part)=>sum+row[part],0):null;
  }
  return row;
}
export function totals(rows) {
  const result={};
  for(const key of Object.keys(GBP_LABELS)) {
    const values=rows.map(row=>row[key]).filter(value=>value!=null);
    result[key]=values.length?values.reduce((sum,value)=>sum+value,0):null;
    if(result[key]!=null&&!Number.isSafeInteger(result[key])) throw new Error('A total exceeds safe precision. Narrow this report.');
  }
  return result;
}
export function periodTotals(series) {
  const result=totals(series?.rows||[]);
  if(!series?.range)return result;
  const expected=Math.round((new Date(series.range.endDate)-new Date(series.range.startDate))/86400000)+1;
  for(const key of Object.keys(result))if((series.rows||[]).filter(row=>row[key]!=null).length!==expected)result[key]=null;
  return result;
}
export function combineDaily(locations,period='current') {
  const map=new Map();
  const valid=locations.filter(item=>item[period]?.rows);
  for(const item of valid) for(const row of item[period].rows) {
    if(!map.has(row.date)) map.set(row.date,[]); map.get(row.date).push(row);
  }
  return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>({date,...Object.fromEntries(Object.keys(GBP_LABELS).map(key=>[key,rows.length===valid.length&&rows.every(row=>row[key]!=null)?rows.reduce((sum,row)=>sum+row[key],0):null]))}));
}
export function change(current,previous) {
  if(current==null||previous==null) return 'Unavailable';
  if(previous===0) return current===0?'No change':'New · no baseline';
  const delta=(current-previous)/previous*100;
  return `${delta>0?'+':''}${delta.toFixed(1)}%`;
}
export function format(value) { return value==null?'—':typeof value==='number'?value.toLocaleString(undefined,{maximumFractionDigits:2}):value; }
export function stars(review) {return {ONE:1,TWO:2,THREE:3,FOUR:4,FIVE:5}[review.starRating]||null;}
export function filterReviews(reviews,filter={},range=null,zone='UTC') {
  const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone(zone),year:'numeric',month:'2-digit',day:'2-digit'});
  return reviews.filter(row=>{
    if(filter.rating&&stars(row)!==Number(filter.rating))return false;
    if(filter.reply==='unreplied'&&row.reviewReply?.comment)return false;
    if(filter.reply==='replied'&&!row.reviewReply?.comment)return false;
    if(filter.comment==='with'&&!row.comment)return false;
    if(filter.comment==='without'&&row.comment)return false;
    if(filter.text&&!String(row.comment||'').toLowerCase().includes(filter.text.toLowerCase()))return false;
    if(range) {
      const instant=new Date(row[filter.dateField==='updated'?'updateTime':'createTime']); if(!Number.isFinite(instant.getTime()))return false;
      const parts=Object.fromEntries(dateFormatter.formatToParts(instant).map(part=>[part.type,part.value]));
      const date=`${parts.year}-${parts.month}-${parts.day}`;if(date<range.startDate||date>range.endDate)return false;
    }
    return true;
  });
}
export function reviewSummary(rows) {
  const rated=rows.map(stars).filter(Boolean),replied=rows.filter(row=>row.reviewReply?.comment).length;
  return {count:rows.length,rating:rated.length?rated.reduce((a,b)=>a+b,0)/rated.length:null,replied,unreplied:rows.length-replied,distribution:[1,2,3,4,5].map(star=>({star,count:rated.filter(value=>value===star).length}))};
}
export function auditProfile(location) {
  const category=location.categories?.primaryCategory?.displayName||'';
  const hasCategory=!!location.categories?.primaryCategory;
  const serviceOnly=location.serviceArea?.businessType==='CUSTOMER_LOCATION_ONLY';
  const checks=[
    ['title','Business name',true,!!location.title],['category','Primary category',true,hasCategory],
    ['website','Website',true,!!location.websiteUri],['phone','Phone',true,!!location.phoneNumbers?.primaryPhone],
    ['address','Storefront address',!serviceOnly,!!location.storefrontAddress?.addressLines?.length],
    ['serviceArea','Service area',serviceOnly,!!location.serviceArea?.places?.placeInfos?.length],
    // Hours/description can legitimately be absent for specific categories.
    ['hours','Regular hours',!/(lodging|hotel|atm|cemetery|natural|landmark)/i.test(category),!!location.regularHours?.periods?.length],
    ['description','Business description',!/(hotel|lodging|motel|inn|resort)/i.test(category),!!location.profile?.description]
  ].map(([key,label,applicable,present])=>({key,label,applicable,present}));
  const applicable=checks.filter(check=>check.applicable),missing=applicable.filter(check=>!check.present);
  return {checks,missing,score:Math.round((applicable.length-missing.length)/Math.max(1,applicable.length)*100),note:'Extension checklist, equal weights; verify category applicability. This is not a Google ranking score.'};
}
export function attention(items) {
  const findings=[];
  for(const item of items) {
    const location=item.location;
    if(item.audit?.missing.length) findings.push({location:location.title,kind:'Profile',text:`${item.audit.missing.length} checklist fields missing: ${item.audit.missing.map(check=>check.label).join(', ')}`});
    if(item.reviews) {
      const pending=item.reviews.rows.filter(row=>stars(row)<=2&&!row.reviewReply?.comment);
      if(pending.length)findings.push({location:location.title,kind:'Reviews',text:`${pending.length} currently unanswered reviews rated 1–2 stars.`});
    }
    if(item.current&&item.previous) {
      const a=periodTotals(item.current),b=periodTotals(item.previous);
      if(b.impressions>=100&&a.impressions!=null&&a.impressions<b.impressions*.7)findings.push({location:location.title,kind:'Performance',text:`Impressions changed ${change(a.impressions,b.impressions)}. Check dates and coverage before investigating causes.`});
    }
  }
  return findings;
}
