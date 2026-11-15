// Full popup.js initialization/navigation smoke test with Chrome API stubs.
import {api,account,customerId,setPreset} from './ads-fixture.js';
import {gbpApi,gbpWrites} from './gbp-fixture.js';
// chrome.storage.session survives a reload in the real extension while the browser
// session lasts, so back it with sessionStorage here to exercise restore paths.
const persist=()=>{try{window.sessionStorage.setItem('preview:session',JSON.stringify(stores.session));}catch{}};
const stores={local:{},session:(()=>{try{return JSON.parse(window.sessionStorage.getItem('preview:session')||'{}');}catch{return {};}})()};
const store=name=>({get:async(keys,callback)=>{const value=!keys?{...stores[name]}:typeof keys==='string'?{[keys]:stores[name][keys]}:Array.isArray(keys)?Object.fromEntries(keys.map(key=>[key,stores[name][key]])):{...keys,...stores[name]};callback?.(value);return value;},set:async(values,callback)=>{Object.assign(stores[name],values);if(name==='session')persist();callback?.();},remove:async(keys,callback)=>{for(const key of [].concat(keys))delete stores[name][key];if(name==='session')persist();callback?.();}});
window.chrome={runtime:{id:'preview',getManifest:()=>({version:'0.8.4',version_name:'0.8.4 - reporting preview'}),getURL:path=>'/'+path,sendMessage:async msg=>{
  if(msg.type==='gbpDiscover')return {ok:true,data:await gbpApi.discover()};
  if(msg.type==='gbpRunLocation')return {ok:true,data:await gbpApi.run(msg)};
  if(msg.type==='gbpWrite')return {ok:true,data:await gbpApi.write(msg)};
  if(msg.type==='googleAdsListCustomers')return {ok:true,data:{customers:[{customerId,descriptiveName:account.descriptiveName,currencyCode:account.currencyCode,timeZone:account.timeZone,manager:false}],warning:''}};
  if(msg.type==='googleAdsGetOptions')return {ok:true,data:await api.options(msg)};
  if(msg.type==='googleAdsRunPreset'){setPreset(msg.preset);const data=await api.run(msg);window.preview.last=data;return {ok:true,data};}
  if(msg.type==='googleAdsGetConfig'||msg.type==='googleAdsSetConfig')return {ok:true,data:{loginCustomerId:''}};
  if(msg.type==='getAccount')return {ok:true,account:{email:'preview@example.com',provider:'chrome'}};
  if(msg.type==='authListAccounts')return {ok:true,data:{accounts:[],activeEmail:'preview@example.com'}};
  if(msg.type==='consumeAuthEvent')return {ok:true,data:null};
  return {ok:true,data:[],accounts:[]};
}},storage:{local:store('local'),session:store('session'),onChanged:{addListener:()=>{}}},tabs:{query:async()=>[{id:1,windowId:1,url:'https://example.com'}],create:async()=>{}},sidePanel:{open:async()=>{}},scripting:{executeScript:async()=>[]}};
window.preview={last:null,gbpWrites};
await import('../popup.js');
