// Local UI fixture. Uses the production UI/API modules with synthetic responses.
// This file is excluded from the extension package.
import { createAdsApi } from '../ads-api.js';
import { getReport, shiftDate } from '../ads-reporting.js';
export const customerId='1234567890';
export const account={id:customerId,descriptiveName:'Acme Studio',currencyCode:'USD',timeZone:'America/New_York',status:'ENABLED',manager:false};
let preset='account_overview';
const campaigns=Array.from({length:32},(_,i)=>({campaign:{id:String(1001+i),name:`${i%2?'Search':'Brand'} · Campaign ${i+1}`,status:'ENABLED',advertisingChannelType:'SEARCH'}}));
export const api=createAdsApi({getConfig:async()=>({}),request:async(path,options)=>{
  const body=JSON.parse(options.body || '{}'); const query=body.query || '';
  if(query.endsWith(' FROM customer')) return {results:[{customer:account}]};
  if(!query.includes('segments.date BETWEEN')) {
    if(query.includes(' FROM campaign ')) return {results:campaigns};
    if(query.includes(' FROM ad_group ')) return {results:campaigns.map((row,i)=>({campaign:row.campaign,adGroup:{id:String(2001+i),name:`Ad group ${i+1}`,status:'ENABLED'}}))};
    if(query.includes(' FROM conversion_action ')) return {results:[{conversionAction:{id:'3001',name:'Purchase',status:'ENABLED',category:'PURCHASE'}},{conversionAction:{id:'3002',name:'Lead form',status:'ENABLED',category:'LEAD'}}]};
    return {results:[{geoTargetConstant:{id:'2840',name:'United States'}},{geoTargetConstant:{id:'2356',name:'India'}}]};
  }
  if(query.includes('metrics.search_impression_share')) return {results:campaigns.map(row=>({campaign:row.campaign,metrics:{searchImpressionShare:.65,searchBudgetLostImpressionShare:.2,searchRankLostImpressionShare:.15,searchTopImpressionShare:.4,searchAbsoluteTopImpressionShare:.12}}))};
  const dates=query.match(/BETWEEN '([^']+)' AND '([^']+)'/);
  const definition=getReport(preset); const rows=[];
  for(let date=dates[1],day=0;date<=dates[2];date=shiftDate(date,1),day++) {
    for(let i=0;i<32;i++) {
      const row={campaign:{...campaigns[i].campaign,advertisingChannelType:definition.channels?.[0] || 'SEARCH'},adGroup:{id:String(2001+i),name:`Ad group ${i+1}`,status:'ENABLED'},segments:{date},metrics:{}};
      for(const d of definition.dimensions) {
        const parts=d.key.split('.'); let object=row;
        for(const part of parts.slice(0,-1)) object=object[part] ||= {};
        if(object[parts.at(-1)]!==undefined) continue;
        object[parts.at(-1)]=d.type==='id'?String(5001+i):d.type==='number'?i%24:d.type==='moneyMicros'?50000000:d.type==='url'?`https://example.com/products/${i+1}`:`${d.label} ${i+1}`;
      }
      row.segments.date=date;
      if(definition.filters.includes('country')) row.geographicView.countryCriterionId='2840';
      const values={impressions:500+day*10,clicks:20+i,interactions:20+i,costMicros:(5+i+day%7)*1e6,conversions:(i+day)%4===0?1.5:0,conversionsValue:(i+day)%4===0?150:0,allConversions:(i+day)%4===0?2:0,allConversionsValue:(i+day)%4===0?160:0};
      for(const field of definition.metrics){const key=field.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());row.metrics[key]=values[key]||0;}
      const ids=query.match(/campaign.id IN \(([^)]+)\)/);
      if(ids&&!ids[1].split(', ').includes(row.campaign.id)) continue;
      rows.push(row);
    }
  }
  const offset=Number(body.pageToken||0);
  return {results:rows.slice(offset,offset+250),...(offset+250<rows.length?{nextPageToken:String(offset+250)}:{})};
}});

export function setPreset(value){preset=value;}
