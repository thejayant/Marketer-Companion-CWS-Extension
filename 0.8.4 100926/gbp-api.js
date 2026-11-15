import {resource,dates,months,previousMonths,keywordValue,normalizeDaily,auditProfile,PROFILE_MASK,CORE_METRICS,GBP_METRICS} from './gbp-reporting.js';
import {createScheduler} from './net.js';

export const GBP_HOSTS={accounts:'mybusinessaccountmanagement.googleapis.com',info:'mybusinessbusinessinformation.googleapis.com',performance:'businessprofileperformance.googleapis.com',legacy:'mybusiness.googleapis.com',verification:'mybusinessverifications.googleapis.com',actions:'mybusinessplaceactions.googleapis.com'};
export function createGbpApi({request,maxRows=20000,pace=250,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>new Date(),assertContext=async()=>{}}) {
  // Pacing, bounded backoff and Retry-After live in the shared scheduler, so
  // Business Profile, Ads and the Google/CallRail calls in the service worker
  // all behave the same way under a 429.
  const scheduler=createScheduler({pace,sleep});
  async function call(service,path,params={},options={}) {
    if(!GBP_HOSTS[service]||!/^v[14]\//.test(path))throw new Error('Unsupported Business Profile request.');
    const url=new URL(`https://${GBP_HOSTS[service]}/${path}`);
    for(const [key,value] of Object.entries(params))for(const part of [].concat(value??[]))url.searchParams.append(key,String(part));
    const isWrite=!!options.method&&options.method!=='GET';
    try {
      return await scheduler.run(service,async()=>{
        if(options.context)await assertContext(options.context);
        const {context,...fetchOptions}=options;
        return await request(url.href,fetchOptions);
      },{retry:!isWrite});
    }
      catch(error) {
        const raw=String(error.detail||error.message||error);
        if(isWrite){error.userMessage=`Business Profile could not confirm the change. Refresh before retrying to avoid duplicate actions. ${raw.slice(0,180)}`;throw error;}
        error.userMessage=/failed to fetch|networkerror|load failed|network request failed/i.test(raw)
            ?`The request to ${GBP_HOSTS[service]} never reached Google. Reload the extension at chrome://extensions so the host permission applies, confirm the API is enabled for your Cloud project, and check that nothing on the network blocks that host. Long runs can also be cut short if the extension's service worker stops; running the report again resumes from a fresh worker.`:
          /scope|permission.*changed/i.test(raw)?'Business Profile needs the business.manage permission. Open Settings and reconnect Google.':
          /SERVICE_DISABLED|has not been used|not enabled/i.test(raw)?`Enable ${GBP_HOSTS[service]} in the Cloud project that owns your Google OAuth client.`:
          error.httpStatus===429?'Business Profile quota is unavailable or exhausted. Check approval and quotas in your Cloud project, then retry.':
          error.httpStatus===403?'Business Profile access denied. Check Cloud project approval, Google account access, and location eligibility.':
          `Business Profile: ${raw.slice(0,220)}`;
        throw error;
      }
  }
  async function pages(service,path,params,key) {
    let token='';const seen=new Set(),rows=[];let metadata={};
    do {
      const data=await call(service,path,{...params,...(token?{pageToken:token}:{})});
      rows.push(...(data[key]||[]));metadata=data;
      if(rows.length>maxRows)throw new Error('This location exceeds the report row limit. No incomplete analytics were returned.');
      token=data.nextPageToken||'';
      if(token&&seen.has(token))throw new Error('Google returned a repeated page token. No incomplete analytics were returned.');
      if(token)seen.add(token);
      if(seen.size>500)throw new Error('Too many pages. No incomplete analytics were returned.');
    }while(token);
    return {rows,metadata};
  }
  async function discover() {
    const accounts=new Map(),locations=new Map(),warnings=[];
    const root=await pages('accounts','v1/accounts',{pageSize:20},'accounts');
    const pending=[...root.rows];const visited=new Set();
    while(pending.length) {
      const account=pending.shift();resource(account.name,'accounts');if(visited.has(account.name))continue;
      visited.add(account.name);accounts.set(account.name,account);
      if(visited.size>500)throw new Error('Account discovery exceeds 500 groups. Select a smaller Google account portfolio.');
      if(['ORGANIZATION','USER_GROUP'].includes(account.type)) {
        try{pending.push(...(await pages('accounts','v1/accounts',{parentAccount:account.name,pageSize:20},'accounts')).rows);}
        catch(error){warnings.push(`${account.accountName||account.name}: ${error.userMessage||error.message}`);}
      }
      try {
        const list=await pages('info',`v1/${account.name}/locations`,{pageSize:100,readMask:PROFILE_MASK},'locations');
        for(const location of list.rows) {
          resource(location.name);const old=locations.get(location.name);
          if(old){old.accountNames.push(account.name);if(account.type==='LOCATION_GROUP'||account.type==='PERSONAL')old.accountName=account.name;}
          else locations.set(location.name,{...location,accountName:account.name,accountNames:[account.name]});
        }
      }catch(error){warnings.push(`${account.accountName||account.name}: ${error.userMessage||error.message}`);}
    }
    return {accounts:[...accounts.values()],locations:[...locations.values()],warnings,fetchedAt:now().toISOString()};
  }
  function route(input) {
    const location=resource(input.locationName),account=resource(input.accountName,'accounts');
    return {location,parent:`${account}/${location}`};
  }
  async function daily(location,range,optional=[]) {
    const fields=[...CORE_METRICS,...optional];
    if(optional.some(metric=>!Object.hasOwn(GBP_METRICS,metric)))throw new Error('Unsupported optional metric.');
    const params={dailyMetrics:[...new Set(fields)]};
    for(const [key,value] of [['start_date',range.startDate],['end_date',range.endDate]]) {
      const [year,month,day]=value.split('-').map(Number);
      Object.assign(params,{[`dailyRange.${key}.year`]:year,[`dailyRange.${key}.month`]:month,[`dailyRange.${key}.day`]:day});
    }
    const data=await call('performance',`v1/${location}:fetchMultiDailyMetricsTimeSeries`,params);
    return {...normalizeDaily(data),range};
  }
  async function keywords(location,list) {
    const rows=[];
    for(const month of list) {
      const [year,m]=month.split('-').map(Number);
      const data=await pages('performance',`v1/${location}/searchkeywords/impressions/monthly`,{pageSize:100,'monthlyRange.start_month.year':year,'monthlyRange.start_month.month':m,'monthlyRange.end_month.year':year,'monthlyRange.end_month.month':m},'searchKeywordsCounts');
      rows.push(...data.rows.map(row=>({month,keyword:row.searchKeyword,...keywordValue(row.insightsValue)})));
      if(rows.length>maxRows)throw new Error('Keyword report exceeds the row limit. Select fewer months.');
    }
    return rows;
  }
  async function reviews(parent) {
    const data=await pages('legacy',`v4/${parent}/reviews`,{pageSize:50,orderBy:'updateTime desc'},'reviews');
    return {rows:data.rows,averageRating:data.metadata.averageRating??null,totalReviewCount:data.metadata.totalReviewCount??null};
  }
  async function audit(location) {
    const profile=await call('info',`v1/${location}`,{readMask:PROFILE_MASK});
    const result={...auditProfile(profile),profile,capabilities:[]};
    for(const [key,service,path,params] of [
      ['googleChanges','info',`v1/${location}:getGoogleUpdated`,{readMask:PROFILE_MASK}],
      ['attributes','info',`v1/${location}/attributes`,{}],
      ['verification','verification',`v1/${location}/VoiceOfMerchantState`,{}],
      ['actionLinks','actions',`v1/${location}/placeActionLinks`,{}]
    ]) {
      try {result[key]=await call(service,path,params);result.capabilities.push({key,ok:true});}
      catch(error){result.capabilities.push({key,ok:false,error:error.userMessage||error.message});}
    }
    return result;
  }
  async function content(parent) {
    const result={capabilities:[]};
    for(const [key,path,array] of [['posts',`v4/${parent}/localPosts`,'localPosts'],['media',`v4/${parent}/media`,'mediaItems']]) {
      try{result[key]=(await pages('legacy',path,{pageSize:100},array)).rows;result.capabilities.push({key,ok:true});}
      catch(error){result.capabilities.push({key,ok:false,error:error.userMessage||error.message});}
    }
    return result;
  }
  async function run(input) {
    const {location,parent}=route(input),report=input.report;
    const result={locationName:location,report,fetchedAt:now().toISOString(),warnings:[]};
    if(['overview','performance','locations'].includes(report)) {
      const ranges=dates(input,now());result.ranges=ranges;
      result.current=await daily(location,ranges.current,input.optionalMetrics||[]);
      if(ranges.previous)try{result.previous=await daily(location,ranges.previous,input.optionalMetrics||[]);}catch(error){result.warnings.push(`Comparison: ${error.userMessage||error.message}`);}
    }else if(report==='keywords') {
      const list=months(input.monthStart,input.monthEnd),prior=previousMonths(list,input.monthComparison||'none');
      result.months=list;result.priorMonths=prior;result.keywords=await keywords(location,list);
      if(prior.length)try{result.previousKeywords=await keywords(location,prior);}catch(error){result.warnings.push(`Comparison: ${error.userMessage||error.message}`);}
    }else if(report==='reviews') {result.ranges=dates(input,now());result.reviews=await reviews(parent);}
    else if(report==='audit')result.audit=await audit(location);
    else if(report==='content')result.content=await content(parent);
    else throw new Error('Choose a supported Business Profile report.');
    return result;
  }
  function text(value,max,label) {const result=String(value||'').trim();if(!result||result.length>max)throw new Error(`${label} must contain 1–${max} characters.`);return result;}
  function safeUrl(value) {const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Use a valid public HTTP or HTTPS URL.');return url.href;}
  async function write(input) {
    const {location,parent}=route(input);if(input.confirmed!==true)throw new Error('Preview and explicitly submit the proposed change.');
    await assertContext(input.authScope);
    const writeOptions=(method,payload)=>({method,body:JSON.stringify(payload),context:input.authScope});
    if(input.action==='reply') {
      const id=String(input.reviewId||'');if(!/^[A-Za-z0-9_-]+$/.test(id))throw new Error('Invalid review ID.');
      const comment=text(input.comment,4096,'Reply');
      return await call('legacy',`v4/${parent}/reviews/${id}/reply`,{},writeOptions('PUT',{comment}));
    }
    if(input.action==='post') {
      const summary=text(input.summary,1500,'Post'),languageCode=text(input.languageCode||'en',10,'Language');
      if(!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(languageCode))throw new Error('Invalid language code.');
      const payload={languageCode,summary,topicType:'STANDARD'};
      if(input.url)payload.callToAction={actionType:'LEARN_MORE',url:safeUrl(input.url)};
      const value=await call('legacy',`v4/${parent}/localPosts`,{},writeOptions('POST',payload));
      return value;
    }
    if(input.action==='profile') {
      if(!['websiteUri','phoneNumbers.primaryPhone','profile.description'].includes(input.field))throw new Error('Unsupported profile field.');
      const value=input.field==='websiteUri'?safeUrl(input.value):text(input.value,input.field==='profile.description'?750:40,'Profile value');
      const payload={name:location};
      if(input.field==='websiteUri')payload.websiteUri=value;
      else if(input.field==='profile.description')payload.profile={description:value};
      else {if(!/^\+?[\d\s().-]+$/.test(value))throw new Error('Enter a valid phone number.');payload.phoneNumbers={primaryPhone:value};}
      const params={updateMask:input.field};
      await call('info',`v1/${location}`,{...params,validateOnly:true},writeOptions('PATCH',payload));
      await call('info',`v1/${location}`,params,writeOptions('PATCH',payload));
      return await call('info',`v1/${location}`,{readMask:PROFILE_MASK},{context:input.authScope});
    }
    if(input.action==='media') {
      if(!['ADDITIONAL','EXTERIOR','INTERIOR'].includes(input.category))throw new Error('Choose a supported photo category.');
      const sourceUrl=safeUrl(input.sourceUrl);if(!sourceUrl.startsWith('https:'))throw new Error('Use a publicly accessible HTTPS image URL.');
      return await call('legacy',`v4/${parent}/media`,{},writeOptions('POST',{mediaFormat:'PHOTO',sourceUrl,locationAssociation:{category:input.category}}));
    }
    throw new Error('Unsupported Business Profile action.');
  }
  return {discover,run,write,pages};
}
