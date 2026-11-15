import {createGbpApi} from '../gbp-api.js';
import {CORE_METRICS} from '../gbp-reporting.js';
export const gbpLocations=Array.from({length:6},(_,i)=>({name:`locations/${8001+i}`,title:['Acme · Downtown','Acme · Riverside','Acme · Northgate','Acme · Harbour','Acme · West End','Acme · Hillview'][i],storeCode:`STORE-${i+1}`,categories:{primaryCategory:{name:'categories/gcid:coffee_shop',displayName:'Coffee shop'}},websiteUri:'https://example.com/location/'+(i+1),phoneNumbers:{primaryPhone:'+1 555 010 000'+i},storefrontAddress:{addressLines:[`${100+i} Market Street`],locality:'San Francisco',administrativeArea:'CA',regionCode:'US'},regularHours:{periods:[{openDay:'MONDAY',openTime:{hours:9},closeDay:'MONDAY',closeTime:{hours:18}}]},profile:i===2?{}:{description:'Coffee and neighborhood gatherings.'},labels:[i<3?'City':'Suburbs'],openInfo:{status:'OPEN'},metadata:{mapsUri:'https://maps.google.com/'},accountName:'accounts/100',accountNames:['accounts/100']}));
export const gbpCalls=[],gbpWrites=[];
export async function gbpFixtureRequest(href,options={}) {
  const url=new URL(href),path=url.pathname,body=options.body?JSON.parse(options.body):null;gbpCalls.push({href,options});
  const location=gbpLocations.find(row=>path.includes(row.name))||gbpLocations[0];
  if(options.method&&options.method!=='GET') {
    gbpWrites.push({href,body,method:options.method});
    if(path.endsWith('/reply'))return {comment:body.comment,updateTime:new Date().toISOString()};
    if(path.endsWith('/localPosts'))return {...body,name:`accounts/100/${location.name}/localPosts/new1`,state:'PROCESSING'};
    if(url.searchParams.get('validateOnly')==='true')return {};
    Object.assign(location,body);return location;
  }
  if(url.hostname.includes('accountmanagement'))return {accounts:[{name:'accounts/100',accountName:'Acme Location Group',type:'LOCATION_GROUP'}]};
  if(path==='/v1/accounts/100/locations')return {locations:gbpLocations};
  if(path.endsWith(':fetchMultiDailyMetricsTimeSeries')) {
    const get=key=>`${url.searchParams.get('dailyRange.'+key+'.year')}-${String(url.searchParams.get('dailyRange.'+key+'.month')).padStart(2,'0')}-${String(url.searchParams.get('dailyRange.'+key+'.day')).padStart(2,'0')}`;
    const start=get('start_date'),end=get('end_date'),dates=[];let d=new Date(start+'T00:00:00Z');
    while(d.toISOString().slice(0,10)<=end){dates.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}
    const multiplier=gbpLocations.indexOf(location)+1;
    return {multiDailyMetricTimeSeries:[{dailyMetricTimeSeries:url.searchParams.getAll('dailyMetrics').map((metric,index)=>({dailyMetric:metric,timeSeries:{datedValues:dates.map((iso,i)=>{const [year,month,day]=iso.split('-').map(Number);return {date:{year,month,day},value:String((metric.includes('IMPRESSIONS')?40:3)*multiplier+(i%7)*2+index)};})}}))}]};
  }
  if(path.endsWith('/searchkeywords/impressions/monthly')) {
    const tokens=url.searchParams.get('pageToken');
    return {searchKeywordsCounts:tokens?[{searchKeyword:'nearby espresso',insightsValue:{threshold:'15'}}]:[{searchKeyword:'acme coffee',insightsValue:{value:'230'}},{searchKeyword:'coffee near me',insightsValue:{value:'810'}}],...(!tokens?{nextPageToken:'keyword-next'}:{})};
  }
  if(path.endsWith('/reviews')) {
    const page=url.searchParams.get('pageToken')?1:0;
    return {averageRating:4.6,totalReviewCount:56,reviews:Array.from({length:page?6:50},(_,i)=>{const n=i+page*50;const date=new Date();date.setUTCDate(date.getUTCDate()-n-1);return {reviewId:`review_${n}`,reviewer:{displayName:`Customer ${n+1}`},starRating:['ONE','TWO','THREE','FOUR','FIVE'][n%5],comment:n%7?'Good coffee and friendly service. '+n:'',createTime:date.toISOString(),updateTime:date.toISOString(),...(n%3?{reviewReply:{comment:'Thank you for visiting.',updateTime:date.toISOString()}}:{})};}),...(!page?{nextPageToken:'reviews-next'}:{})};
  }
  if(path.endsWith(':getGoogleUpdated'))return {location:{...location,websiteUri:'https://example.com/updated'},diffMask:'websiteUri',pendingMask:''};
  if(path.endsWith('/attributes'))return {name:location.name+'/attributes',attributes:[{name:'attributes/has_takeout',valueType:'BOOL',values:[true]}]};
  if(path.endsWith('/VoiceOfMerchantState'))return {hasVoiceOfMerchant:true,hasBusinessAuthority:true};
  if(path.endsWith('/placeActionLinks'))return {placeActionLinks:[]};
  if(path.endsWith('/localPosts'))return {localPosts:[{name:`accounts/100/${location.name}/localPosts/123`,summary:'Fall coffee menu is here.',topicType:'STANDARD',state:'LIVE',createTime:new Date().toISOString(),searchUrl:'https://example.com/post'}]};
  if(path.endsWith('/media'))return {mediaItems:[{name:'photo1',mediaFormat:'PHOTO',locationAssociation:{category:'INTERIOR'},description:'Our neighborhood cafe.',createTime:new Date().toISOString(),googleUrl:'https://example.com/photo'}]};
  if(/^\/v1\/locations\/\d+$/.test(path))return location;
  throw new Error('Unhandled fixture endpoint: '+href);
}
export const gbpApi=createGbpApi({request:gbpFixtureRequest,pace:0,sleep:async()=>{}});
