// background.js — MV3 module service worker
// Google auth via chrome.identity.getAuthToken(), GSC, GA4, CallRail

import * as CFG from "./config.js";
import { createAdsApi, adsId } from "./ads-api.js";
import { createGbpApi } from "./gbp-api.js";
import { createScheduler } from "./net.js";
import { createCallrailApi } from "./callrail-api.js";
import { createGscApi, normalizeGscDataState, covers } from "./gsc-api.js";
import { createGaApi } from "./ga-api.js";

const gbpApi = createGbpApi({ assertContext:async scope=>{
  if (!scope || scope !== await getGoogleCacheScope()) throw new Error('Google account changed. Reopen the draft before submitting.');
}, request: async (url, options={}) => {
  return await withScopeRetry(async () => {
    const response = await apiFetch(null, url, {cache:'no-store',...options});
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : {};
  });
} });

// A long Business Profile run (reviews and media paginate, keywords fetch one
// month at a time) can outlive the service worker's idle timeout, which aborts
// in-flight fetches as "Failed to fetch". While the panel holds this port open
// the worker stays alive; the port closes when the run ends or the popup does.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "keepalive") return;
  const tick = setInterval(() => { try { port.postMessage({ alive: Date.now() }); } catch (_) {} }, 20000);
  port.onDisconnect.addListener(() => clearInterval(tick));
});

const CLIENT_ID = CFG.CLIENT_ID; // kept for diagnostics / manifest parity
const SCOPES = CFG.SCOPES; // kept for diagnostics / manifest parity

const storage = chrome.storage.local;
const sensitiveSession = chrome.storage.session;

async function getFromStore(key){ return (await storage.get(key))[key]; }
async function setInStore(obj){ return await storage.set(obj); }
async function delInStore(key){ return await storage.remove(key); }
async function getCallrailApiKey(){
  const sessionValue = (await sensitiveSession.get("callrailApiKey")).callrailApiKey;
  if (sessionValue) return sessionValue;

  // One-time migration from versions that persisted the credential locally.
  const legacyValue = await getFromStore("callrailApiKey");
  if (legacyValue){
    await sensitiveSession.set({ callrailApiKey: legacyValue });
    await delInStore("callrailApiKey");
    return legacyValue;
  }
  return "";
}

const CACHE_INDEX_KEY = "__api_cache_index__";
const CACHE_PREFIX = "api_cache:";
const CACHE_VERSION = "v1";
const CACHE_KIND_LIST = "list";
const CACHE_KIND_REPORT = "report";
const CACHE_POLICY_MANUAL = "manual";
const CACHE_POLICY_TTL_1H = "ttl_1h";
const REPORT_CACHE_TTL_MS = 60 * 60 * 1000;
const REPORT_CACHE_LIMIT = 50;
const GOOGLE_CACHE_SCOPE_KEY = "__google_cache_scope__";
const CALLRAIL_CACHE_SCOPE_KEY = "__callrail_cache_scope__";

async function sha256(str){
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str || "")));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
function stableSerialize(value){
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object"){
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function cacheNamespace(service, scope, kind){
  return `${CACHE_VERSION}:service:${service}:scope:${scope}:kind:${kind}`;
}
function cacheStorageKey(namespace, digest){
  return `${CACHE_PREFIX}${namespace}:${digest}`;
}
function cacheTtlMs(policy){
  return policy === CACHE_POLICY_TTL_1H ? REPORT_CACHE_TTL_MS : 0;
}
function cacheLimit(kind){
  return kind === CACHE_KIND_REPORT ? REPORT_CACHE_LIMIT : Infinity;
}
async function getCacheIndex(){
  const raw = await getFromStore(CACHE_INDEX_KEY);
  return raw && typeof raw === "object" ? raw : {};
}
async function setCacheIndex(index){
  await setInStore({ [CACHE_INDEX_KEY]: index });
}
async function buildCacheHandle(service, scope, kind, params){
  const namespace = cacheNamespace(service, scope, kind);
  const digest = await sha256(stableSerialize(params || {}));
  return {
    namespace,
    key: cacheStorageKey(namespace, digest)
  };
}
async function pruneNamespace(index, namespace, { ttlMs=0, limit=Infinity } = {}){
  const current = Array.isArray(index[namespace]) ? index[namespace] : [];
  if (!current.length) return false;
  const now = Date.now();
  const keep = [];
  const removeKeys = [];
  const seen = new Set();
  current
    .sort((a, b) => Number(b?.fetchedAt || 0) - Number(a?.fetchedAt || 0))
    .forEach(item => {
      const key = item?.key;
      if (!key || seen.has(key)){
        if (key) removeKeys.push(key);
        return;
      }
      seen.add(key);
      const fetchedAt = Number(item?.fetchedAt || 0);
      const expired = ttlMs > 0 && (!fetchedAt || (now - fetchedAt) > ttlMs);
      if (expired){
        removeKeys.push(key);
        return;
      }
      keep.push({ key, fetchedAt });
    });

  if (Number.isFinite(limit) && keep.length > limit){
    keep.slice(limit).forEach(item => removeKeys.push(item.key));
    keep.length = limit;
  }

  if (removeKeys.length) await storage.remove(removeKeys);
  if (keep.length) index[namespace] = keep;
  else delete index[namespace];
  return removeKeys.length > 0 || keep.length !== current.length;
}
async function upsertCacheIndex(namespace, key, fetchedAt, { ttlMs=0, limit=Infinity } = {}){
  const index = await getCacheIndex();
  const list = Array.isArray(index[namespace]) ? index[namespace].filter(item => item?.key !== key) : [];
  list.unshift({ key, fetchedAt });
  index[namespace] = list;
  await pruneNamespace(index, namespace, { ttlMs, limit });
  await setCacheIndex(index);
}
async function prepareNamespace(namespace, { ttlMs=0, limit=Infinity } = {}){
  const index = await getCacheIndex();
  const changed = await pruneNamespace(index, namespace, { ttlMs, limit });
  if (changed) await setCacheIndex(index);
}
async function clearCacheNamespaces(predicate){
  const index = await getCacheIndex();
  const removeKeys = [];
  let changed = false;
  for (const [namespace, entries] of Object.entries(index)){
    if (!predicate(namespace)) continue;
    changed = true;
    (entries || []).forEach(item => {
      if (item?.key) removeKeys.push(item.key);
    });
    delete index[namespace];
  }
  if (removeKeys.length) await storage.remove(removeKeys);
  if (changed) await setCacheIndex(index);
}
async function clearGoogleCaches(){
  await clearCacheNamespaces(namespace => namespace.includes(":service:gsc-") || namespace.includes(":service:ga-"));
  await delInStore(GOOGLE_CACHE_SCOPE_KEY);
}
async function clearCallrailCaches(){
  await clearCacheNamespaces(namespace => namespace.includes(":service:callrail-"));
  await delInStore(CALLRAIL_CACHE_SCOPE_KEY);
}
async function getGoogleCacheScope(){
  const profile = await getFromStore("accountProfile");
  if (profile?.email) return `google:${String(profile.email).toLowerCase()}`;
  return `google-ext:${chrome.runtime?.id || "unknown"}`;
}
async function ensureGoogleCacheScope(){
  const scope = await getGoogleCacheScope();
  const prev = await getFromStore(GOOGLE_CACHE_SCOPE_KEY);
  if (prev && prev !== scope) await clearGoogleCaches();
  if (prev !== scope) await setInStore({ [GOOGLE_CACHE_SCOPE_KEY]: scope });
  return scope;
}
async function getCallrailCacheScope(){
  const apiKey = await getCallrailApiKey();
  if (!apiKey) return "callrail:none";
  return `callrail:${await sha256(String(apiKey))}`;
}
async function ensureCallrailCacheScope(){
  const scope = await getCallrailCacheScope();
  const prev = await getFromStore(CALLRAIL_CACHE_SCOPE_KEY);
  if (prev && prev !== scope) await clearCallrailCaches();
  if (prev !== scope) await setInStore({ [CALLRAIL_CACHE_SCOPE_KEY]: scope });
  return scope;
}
async function cachedResource({ service, scope, kind, policy, params, forceRefresh=false, fetcher }){
  const ttlMs = cacheTtlMs(policy);
  const limit = cacheLimit(kind);
  const handle = await buildCacheHandle(service, scope, kind, params);
  await prepareNamespace(handle.namespace, { ttlMs, limit });

  const existing = await getFromStore(handle.key);
  const fetchedAt = Number(existing?.fetchedAt || 0);
  const valid = !!existing && existing.scope === scope && existing.kind === kind && (
    policy === CACHE_POLICY_MANUAL || (fetchedAt && (Date.now() - fetchedAt) <= ttlMs)
  );

  if (!forceRefresh && valid){
    return {
      data: existing.value,
      cache: { source: "cache", fetchedAt }
    };
  }

  try{
    const value = await fetcher();
    const nextFetchedAt = Date.now();
    await setInStore({
      [handle.key]: {
        value,
        fetchedAt: nextFetchedAt,
        scope,
        kind
      }
    });
    await upsertCacheIndex(handle.namespace, handle.key, nextFetchedAt, { ttlMs, limit });
    return {
      data: value,
      cache: { source: "network", fetchedAt: nextFetchedAt }
    };
  }catch(err){
    if (existing && typeof existing === "object" && "value" in existing){
      return {
        data: existing.value,
        cache: {
          source: "cache",
          fetchedAt,
          stale: true
        }
      };
    }
    throw err;
  }
}

function b64UrlEncodeUtf8(str){
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");
}
function buildPseudoIdToken(payload){
  return `x.${b64UrlEncodeUtf8(JSON.stringify(payload || {}))}.x`;
}
function normalizeTokenResult(result){
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.token === "string") return result.token;
  return "";
}
async function clearCachedGoogleAuth(){
  try { await chrome.identity.clearAllCachedAuthTokens(); } catch(_) {}
  // Remove credentials left by earlier versions. chrome.identity owns tokens now.
  await delInStore("token");
  await delInStore("accountProfile");
}

// ---------- hybrid Google auth ----------
// The Chrome profile account is the default provider. Web OAuth with PKCE is
// used only after the user explicitly chooses an alternate account in Settings.
const WEB_CLIENT_ID = CFG.WEB_CLIENT_ID || "";
const WEB_CLIENT_SECRET = CFG.CLIENT_SECRET || "";
// A Google "Web application" OAuth client is a confidential client: its token
// endpoint rejects an authorisation-code exchange that carries no client_secret,
// PKCE or not. So the flow shape follows the secret:
//   secret set    -> authorisation code + PKCE, and a refresh token we can renew
//                    from silently and indefinitely.
//   secret blank  -> implicit flow. No token endpoint is involved, so no secret
//                    is needed and none has to ship inside the package. Access
//                    tokens last an hour and are renewed silently with
//                    prompt=none, which succeeds while the browser still holds a
//                    Google session for that account.
// Both land in exactly the same account record, so nothing downstream cares.
function webAuthUsesCodeFlow(){ return !!WEB_CLIENT_SECRET; }
// The implicit endpoint issues access tokens only. OpenID's implicit variant
// would require response_type=id_token and a nonce, and we do not use the id
// token for anything - the email comes from the userinfo endpoint either way.
const WEB_IMPLICIT_SCOPES = String(SCOPES || "").split(/\s+/).filter(s => s && s !== "openid").join(" ");
const ACCOUNTS_KEY = "googleAccounts";
const ACTIVE_EMAIL_KEY = "activeGoogleEmail";
const AUTH_PROVIDER_KEY = "googleAuthProvider";
const CHROME_PROFILE_KEY = "chromeGoogleProfile";
const AUTH_PROVIDER_CHROME = "chrome";
const AUTH_PROVIDER_WEB = "web";

function multiAccountEnabled(){
  return !!WEB_CLIENT_ID;
}
function normalizeGoogleEmail(value){
  return String(value || "").trim().toLowerCase();
}
function accountProfileFromRecord(account){
  if (!account?.email) return null;
  return {
    email: normalizeGoogleEmail(account.email),
    name: account.name || "",
    picture: account.picture || ""
  };
}
function randomVerifier(){
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(bytes, b => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"[b % 66]).join("");
}
async function pkceChallenge(verifier){
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  new Uint8Array(digest).forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getAccountsMap(){
  const raw = await getFromStore(ACCOUNTS_KEY);
  return (raw && typeof raw === "object") ? raw : {};
}
async function setAccountsMap(map){
  await setInStore({ [ACCOUNTS_KEY]: map });
}
async function getActiveEmail(){
  return normalizeGoogleEmail(await getFromStore(ACTIVE_EMAIL_KEY));
}
function findAccountEntry(map, email){
  const wanted = normalizeGoogleEmail(email);
  if (!wanted) return null;
  if (map[wanted]) return { key:wanted, account:map[wanted] };
  const match = Object.entries(map).find(([key, account]) =>
    normalizeGoogleEmail(key) === wanted || normalizeGoogleEmail(account?.email) === wanted
  );
  return match ? { key:match[0], account:match[1] } : null;
}
async function getGoogleAuthProvider(){
  const stored = await getFromStore(AUTH_PROVIDER_KEY);
  if (stored === AUTH_PROVIDER_CHROME || stored === AUTH_PROVIDER_WEB) return stored;

  // Migration: versions before the explicit provider flag used the presence of
  // an active account-map entry to mean Web OAuth. Preserve that choice.
  const active = await getActiveEmail();
  const map = await getAccountsMap();
  if (active && findAccountEntry(map, active)) return AUTH_PROVIDER_WEB;
  return AUTH_PROVIDER_CHROME;
}
async function setChromeGoogleAccount(profile){
  const normalized = accountProfileFromRecord(profile);
  if (!normalized) throw new Error("The Chrome account did not return an email address.");
  await setInStore({
    [AUTH_PROVIDER_KEY]: AUTH_PROVIDER_CHROME,
    [CHROME_PROFILE_KEY]: normalized,
    accountProfile: normalized
  });
  await ensureGoogleCacheScope();
  return normalized;
}
async function syncActiveGoogleAccountProfile(){
  const provider = await getGoogleAuthProvider();
  if (provider !== AUTH_PROVIDER_WEB){
    return await getFromStore(CHROME_PROFILE_KEY) || await getFromStore("accountProfile") || null;
  }
  const map = await getAccountsMap();
  const accounts = Object.values(map).filter(account => account?.email);
  let active = await getActiveEmail();
  let entry = findAccountEntry(map, active);

  // If the worker completed the account write but was interrupted before an
  // older version wrote the active/profile mirrors, recover the newest account.
  if (!entry && accounts.length){
    const newest = accounts.slice().sort((a, b) =>
      Number(b.connected_at || 0) - Number(a.connected_at || 0)
    )[0];
    entry = findAccountEntry(map, newest.email);
  }

  if (!entry){
    return await getFromStore("accountProfile") || null;
  }

  const profile = accountProfileFromRecord(entry.account);
  active = profile.email;
  const storedProfile = await getFromStore("accountProfile");
  const profileChanged = normalizeGoogleEmail(storedProfile?.email) !== active
    || String(storedProfile?.name || "") !== profile.name
    || String(storedProfile?.picture || "") !== profile.picture;
  if (profileChanged || await getActiveEmail() !== active){
    await setInStore({ [AUTH_PROVIDER_KEY]: AUTH_PROVIDER_WEB, [ACTIVE_EMAIL_KEY]: active, accountProfile: profile });
  }
  return profile;
}
async function listGoogleAccounts(){
  const provider = await getGoogleAuthProvider();
  if (provider === AUTH_PROVIDER_WEB) await syncActiveGoogleAccountProfile();
  const map = await getAccountsMap();
  const active = await getActiveEmail();
  let chromeAccount = await getFromStore(CHROME_PROFILE_KEY) || null;
  if (!chromeAccount && provider === AUTH_PROVIDER_CHROME){
    chromeAccount = await getFromStore("accountProfile") || null;
    if (chromeAccount?.email) await setInStore({ [CHROME_PROFILE_KEY]: accountProfileFromRecord(chromeAccount) });
  }
  return {
    active: provider === AUTH_PROVIDER_WEB ? active : normalizeGoogleEmail(chromeAccount?.email),
    provider,
    multiAccount: multiAccountEnabled(),
    webAvailable: multiAccountEnabled(),
    chromeAccount: chromeAccount ? accountProfileFromRecord(chromeAccount) : null,
    accounts: Object.values(map)
      .map(account => ({
        email: normalizeGoogleEmail(account.email),
        name: account.name || "",
        picture: account.picture || "",
        active: provider === AUTH_PROVIDER_WEB && normalizeGoogleEmail(account.email) === active
      }))
      .sort((a, b) => a.email.localeCompare(b.email))
  };
}
async function setActiveGoogleAccount(email){
  const map = await getAccountsMap();
  const entry = findAccountEntry(map, email);
  const account = entry?.account;
  if (!account) throw new Error("That Google account is not connected.");
  const profile = accountProfileFromRecord(account);
  // Keep the three pieces of signed-in state in one storage transaction so a
  // completed OAuth flow cannot leave the UI without its active profile.
  await setInStore({ [AUTH_PROVIDER_KEY]: AUTH_PROVIDER_WEB, [ACTIVE_EMAIL_KEY]: profile.email, accountProfile: profile });
  // Cache scope is keyed on the signed-in email, so switching accounts swaps
  // the cache namespace rather than clearing it. Data for each account is kept.
  await ensureGoogleCacheScope();
  return profile;
}
// Implicit-flow accounts have no refresh token, so revoke whatever we do hold.
// Revoking an access token also drops the grant for that client.
async function revokeGoogleAccountToken(account){
  const token = account?.refresh_token || account?.access_token;
  if (!token) return;
  try{
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString()
    });
  }catch(_){ /* revocation is best-effort */ }
}
async function removeGoogleAccount(email){
  const map = await getAccountsMap();
  const entry = findAccountEntry(map, email);
  const account = entry?.account;
  await revokeGoogleAccountToken(account);
  if (entry) delete map[entry.key];
  await setAccountsMap(map);
  const active = await getActiveEmail();
  const provider = await getGoogleAuthProvider();
  if (provider === AUTH_PROVIDER_WEB && active === normalizeGoogleEmail(email)){
    const remaining = Object.keys(map);
    if (remaining.length){
      await setActiveGoogleAccount(remaining[0]);
    }else{
      await delInStore(ACTIVE_EMAIL_KEY);
      const chromeProfile = await getFromStore(CHROME_PROFILE_KEY);
      if (chromeProfile) await setChromeGoogleAccount(chromeProfile);
      else {
        await setInStore({ [AUTH_PROVIDER_KEY]: AUTH_PROVIDER_CHROME });
        await delInStore("accountProfile");
      }
    }
  }
  return await listGoogleAccounts();
}
async function postTokenEndpoint(params, fallbackMessage){
  const body = Object.assign({ client_id: WEB_CLIENT_ID }, params);
  if (WEB_CLIENT_SECRET) body.client_secret = WEB_CLIENT_SECRET;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString()
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error_description || data?.error || fallbackMessage);
  return data;
}
async function exchangeAuthCode(code, verifier, redirectUri){
  return await postTokenEndpoint({
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier
  }, "Token exchange failed.");
}

// chrome.identity.launchWebAuthFlow does not reset the MV3 idle timer, so a
// person who takes their time on the account chooser can have the worker torn
// down mid-flow and lose the pending exchange. Ping an extension API while a
// flow is open; that does reset it.
let authKeepAliveTimer = null;
let authKeepAliveDepth = 0;
function startAuthKeepAlive(){
  authKeepAliveDepth += 1;
  if (authKeepAliveTimer) return;
  authKeepAliveTimer = setInterval(() => {
    try { chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError); } catch(_) {}
  }, 20000);
}
function stopAuthKeepAlive(){
  authKeepAliveDepth = Math.max(0, authKeepAliveDepth - 1);
  if (authKeepAliveDepth === 0 && authKeepAliveTimer){
    clearInterval(authKeepAliveTimer);
    authKeepAliveTimer = null;
  }
}
function buildGoogleAuthUrl(params){
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}
// The code flow answers in the query string, the implicit flow in the fragment.
// Read both so the caller does not have to know which one ran.
function readRedirectParams(redirect){
  const url = new URL(redirect);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  return (name) => fragment.get(name) || url.searchParams.get(name) || "";
}
async function requestWebAuthTokens({ interactive = true, loginHint = "" } = {}){
  const redirectUri = chrome.identity.getRedirectURL();
  const codeFlow = webAuthUsesCodeFlow();
  const state = randomVerifier().slice(0, 32);
  const verifier = codeFlow ? randomVerifier() : "";

  const params = {
    redirect_uri: redirectUri,
    client_id: WEB_CLIENT_ID,
    state,
    response_type: codeFlow ? "code" : "token",
    scope: codeFlow ? SCOPES : WEB_IMPLICIT_SCOPES,
    include_granted_scopes: "true",
    login_hint: loginHint,
    // Interactive sign-in is the entire point of this provider, so always offer
    // the chooser. Silent renewal must never be allowed to show UI.
    prompt: interactive ? (codeFlow ? "select_account consent" : "select_account") : "none"
  };
  if (codeFlow){
    params.code_challenge = await pkceChallenge(verifier);
    params.code_challenge_method = "S256";
    params.access_type = "offline";
  }

  let redirect;
  try{
    startAuthKeepAlive();
    redirect = await chrome.identity.launchWebAuthFlow({ url: buildGoogleAuthUrl(params), interactive });
  }catch(err){
    if (!interactive) throw new Error("Silent renewal failed.");
    const message = String(err?.message || err || "");
    if (/user did not approve|cancell?ed|closed/i.test(message)) throw new Error("Sign-in was cancelled.");
    throw new Error(message || "Google sign-in failed.");
  }finally{
    stopAuthKeepAlive();
  }
  if (!redirect) throw new Error(interactive ? "Sign-in was cancelled." : "Silent renewal failed.");

  const got = readRedirectParams(redirect);
  const error = got("error");
  if (error) throw new Error(error === "access_denied" ? "Access was denied for that account." : error);
  if (got("state") !== state) throw new Error("Google returned a mismatched sign-in state.");

  if (!codeFlow){
    const accessToken = got("access_token");
    if (!accessToken) throw new Error("Google did not return an access token.");
    return { access_token: accessToken, expires_in: Number(got("expires_in") || 3600), refresh_token: "" };
  }
  const code = got("code");
  if (!code) throw new Error("Google did not return an authorisation code.");
  return await exchangeAuthCode(code, verifier, redirectUri);
}
async function refreshAccountToken(account){
  const accountEmail = normalizeGoogleEmail(account?.email);
  let data;
  if (account?.refresh_token && webAuthUsesCodeFlow()){
    data = await postTokenEndpoint({
      refresh_token: account.refresh_token,
      grant_type: "refresh_token"
    }, "Could not refresh Google session.");
  }else{
    // Implicit-flow accounts hold no refresh token. Renew by replaying the
    // authorisation request with prompt=none, which returns without UI while
    // the browser still has a session for that account.
    if (!accountEmail) throw new Error("Session expired. Please reconnect this Google account.");
    try{
      data = await requestWebAuthTokens({ interactive: false, loginHint: accountEmail });
    }catch(_){
      throw new Error(`The Google session for ${accountEmail} expired. Open Settings and choose that account again.`);
    }
  }
  const map = await getAccountsMap();
  const entry = findAccountEntry(map, account.email);
  const email = normalizeGoogleEmail(account.email);
  const updated = Object.assign({}, entry?.account || account, {
    email,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600) - 120
  });
  if (data.refresh_token) updated.refresh_token = data.refresh_token;
  if (entry && entry.key !== email) delete map[entry.key];
  map[email] = updated;
  await setAccountsMap(map);
  return updated.access_token;
}
async function signInGoogleAccount(){
  const tokens = await requestWebAuthTokens({ interactive: true });
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  if (!profileRes.ok) throw new Error("Could not read the Google profile for that account.");
  const profile = await profileRes.json();
  if (!profile?.email) throw new Error("That Google account did not return an email address.");

  const map = await getAccountsMap();
  const email = normalizeGoogleEmail(profile.email);
  const existingEntry = findAccountEntry(map, email);
  const existing = existingEntry?.account || {};
  if (existingEntry && existingEntry.key !== email) delete map[existingEntry.key];
  map[email] = {
    email,
    name: profile.name || "",
    picture: profile.picture || "",
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || existing.refresh_token || "",
    expires_at: Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 3600) - 120,
    connected_at: Date.now()
  };
  const activeProfile = accountProfileFromRecord(map[email]);
  // Persist the connected account, active selection, and UI profile atomically.
  await setInStore({
    [ACCOUNTS_KEY]: map,
    [AUTH_PROVIDER_KEY]: AUTH_PROVIDER_WEB,
    [ACTIVE_EMAIL_KEY]: email,
    accountProfile: activeProfile
  });
  await ensureGoogleCacheScope();
  return activeProfile;
}
async function getMultiAccountToken(){
  const profile = await syncActiveGoogleAccountProfile();
  const email = normalizeGoogleEmail(profile?.email);
  if (!email) throw new Error("No Google account connected. Open Settings and choose an account.");
  const map = await getAccountsMap();
  const account = findAccountEntry(map, email)?.account;
  if (!account) throw new Error("No Google account connected. Open Settings and choose an account.");
  const now = Math.floor(Date.now() / 1000);
  if (account.access_token && Number(account.expires_at || 0) > now){
    return account.access_token;
  }
  return await refreshAccountToken(account);
}
async function clearAllGoogleAccounts(){
  const map = await getAccountsMap();
  for (const email of Object.keys(map)){
    await revokeGoogleAccountToken(map[email]);
  }
  await delInStore(ACCOUNTS_KEY);
  await delInStore(ACTIVE_EMAIL_KEY);
}

// Clicking "Use another account" in the action popup opens the Google chooser,
// which closes the popup and destroys the page waiting on sendResponse. Record
// the outcome so whichever surface opens next can report it instead of silently
// showing the old account.
const LAST_AUTH_EVENT_KEY = "lastGoogleAuthEvent";
async function recordAuthEvent(event){
  try { await setInStore({ [LAST_AUTH_EVENT_KEY]: Object.assign({ at: Date.now() }, event) }); } catch(_) {}
}
async function runAccountChoice(kind){
  const provider = kind === "web" ? AUTH_PROVIDER_WEB : AUTH_PROVIDER_CHROME;
  try{
    const profile = provider === AUTH_PROVIDER_WEB
      ? await connectWebGoogleAccount()
      : await connectChromeGoogleAccount();
    await recordAuthEvent({ ok: true, provider, email: profile?.email || "" });
    return {
      ok: true,
      data: profile?.email ? buildPseudoIdToken({ email: profile.email }) : null,
      account: profile ? { ...profile, provider } : null,
      provider,
      webAvailable: multiAccountEnabled()
    };
  }catch(e){
    await recordAuthEvent({ ok: false, provider, error: String(e?.message || e || "Google sign-in failed.") });
    throw e;
  }
}

async function connectChromeGoogleAccount(){
  // Default flow: use the account owned by the current Chrome profile. Chrome
  // manages token caching and expiry for this provider.
  return await setChromeGoogleAccount(await fetchGoogleAccountProfile(true));
}
async function connectWebGoogleAccount(){
  if (!multiAccountEnabled()) throw new Error("Alternate Google account sign-in is not configured.");
  return await signInGoogleAccount();
}
async function getAccessToken(interactive = false){
  let result;
  try{
    result = await chrome.identity.getAuthToken({ interactive });
  }catch(err){
    const msg = String(err?.message || err || "");
    throw new Error(msg || "Google auth failed.");
  }

  const accessToken = normalizeTokenResult(result);
  if (!accessToken) throw new Error("Google auth failed: no access token returned.");
  return accessToken;
}
async function fetchGoogleAccountProfile(interactive = false){
  let accessToken = await getAccessToken(interactive);
  let res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (res.status === 401){
    try { await chrome.identity.removeCachedAuthToken({ token: accessToken }); } catch(_) {}
    accessToken = await getAccessToken(interactive);
    res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }

  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  await setInStore({ accountProfile: data });
  return data;
}
async function getToken(){
  const provider = await getGoogleAuthProvider();
  if (provider === AUTH_PROVIDER_WEB){
    if (!multiAccountEnabled()) throw new Error("Alternate Google account sign-in is not configured.");
    return { access_token: await getMultiAccountToken() };
  }
  try{
    const accessToken = await getAccessToken(false);
    return { access_token: accessToken };
  }catch(_){
    throw new Error("Google account is not connected. Open Settings and click Connect Google.");
  }
}

// ---------- HTTP helpers ----------
function retryAfterSeconds(response){
  const value = response?.headers?.get?.("Retry-After");
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, Math.ceil(numeric));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : 0;
}

function httpResponseError(response, detail, message = ""){
  const error = new Error(message || detail || `HTTP ${response?.status || 0}`);
  error.name = "ApiHttpError";
  error.httpStatus = Number(response?.status || 0);
  error.retryAfterSeconds = retryAfterSeconds(response);
  error.detail = String(detail || message || "");
  return error;
}

// Search Console, Analytics and CallRail had no retry at all: a single 429 went
// straight to the user as a failed report. They now share the scheduler used by
// Ads and Business Profile. Retrying is opt-in per call site (`retry: true`) and
// is only ever set on reads - Ads, Merchant and Business Profile pass through
// untouched, because those modules run their own scheduler and a write must
// never be replayed.
const apiScheduler = createScheduler();
function laneFor(url){
  try { return new URL(url).host; } catch(_) { return 'api'; }
}

async function apiFetch(token, url, opt = {}){
  const { retry = false, ...init } = opt;
  return await apiScheduler.run(laneFor(url), () => apiFetchOnce(token, url, init), { retry });
}

async function apiFetchOnce(token, url, opt = {}){
  let accessToken = token?.access_token || (await getToken()).access_token;

  const o = Object.assign({ headers: {} }, opt);
  o.headers["Authorization"] = `Bearer ${accessToken}`;
  if(opt.body && !o.headers["Content-Type"]) o.headers["Content-Type"] = "application/json";

  let r = await fetch(url, o);

  if(r.status === 401){
    if (await getGoogleAuthProvider() === AUTH_PROVIDER_WEB){
      const email = await getActiveEmail();
      const map = await getAccountsMap();
      accessToken = await refreshAccountToken(findAccountEntry(map, email)?.account || { email });
    }else{
      try { await chrome.identity.removeCachedAuthToken({ token: accessToken }); } catch(_) {}
      accessToken = await getAccessToken(false);
    }
    o.headers["Authorization"] = `Bearer ${accessToken}`;
    r = await fetch(url, o);
  }

  if(!r.ok){
    const txt = await r.text();
    throw httpResponseError(r, txt);
  }
  return r;
}

// ---------- Google Ads API + Merchant API ----------
// These integrations call Google's REST APIs directly. Google OAuth is shared
// with GSC/GA4. Since 9 Sep 2026 Ads API access belongs to the Cloud project
// that owns the OAuth client; developer-token headers are no longer required.
const ADS_API_VERSION = "v25";
const ADS_CONFIG_KEY = "googleAdsApiConfig";

async function getGoogleAdsConfig(){
  const session = (await sensitiveSession.get(ADS_CONFIG_KEY))[ADS_CONFIG_KEY] || {};
  return {
    loginCustomerId:String(session.loginCustomerId || "").replace(/\D/g, "")
  };
}
async function setGoogleAdsConfig(value){
  const next = {
    loginCustomerId:adsId(value?.loginCustomerId, 'Manager customer ID', true)
  };
  if (next.loginCustomerId) await sensitiveSession.set({ [ADS_CONFIG_KEY]:next });
  else await sensitiveSession.remove(ADS_CONFIG_KEY);
  return { loginCustomerId:next.loginCustomerId };
}
function cleanNumericId(value, label){
  const id = String(value || "").replace(/\D/g, "");
  if (!id) throw new Error(`${label} is required.`);
  return id;
}
function cleanIsoDate(value, label){
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label} is invalid.`);
  return date;
}
async function googleAdsFetch(path, options={}, loginCustomerId=''){
  const headers = Object.assign({}, options.headers || {});
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  return await withScopeRetry(async () => {
    const response = await apiFetch(null, `https://googleads.googleapis.com/${ADS_API_VERSION}/${path}`, Object.assign({}, options, { headers }));
    return await response.json();
  });
}
const adsApi = createAdsApi({ request:googleAdsFetch, getConfig:getGoogleAdsConfig });
// Ads and Merchant were the two services calling Google on every run with no
// cache behind them, so re-opening the same report re-spent quota. They now use
// the same per-scope, per-parameter cache as Search Console and Analytics:
// account lists until the user reloads them, reports for an hour.
async function googleAdsListCustomers({ forceRefresh=false } = {}){
  const scope = await ensureGoogleCacheScope();
  return await cachedResource({
    service: "ads-customers",
    scope,
    kind: CACHE_KIND_LIST,
    policy: CACHE_POLICY_MANUAL,
    params: { route: "googleAdsListCustomers" },
    forceRefresh,
    fetcher: () => adsApi.listCustomers()
  });
}
async function googleAdsRunPreset(input){
  const scope = await ensureGoogleCacheScope();
  const { forceRefresh=false, ...request } = input || {};
  try {
    return await cachedResource({
      service: "ads-report",
      scope,
      kind: CACHE_KIND_REPORT,
      policy: CACHE_POLICY_TTL_1H,
      params: request,
      forceRefresh,
      fetcher: () => adsApi.run(request)
    });
  }
  catch(error){ if (!error.httpStatus) error.userMessage = error.message; throw error; }
}

async function merchantFetch(path, options={}){
  return await withScopeRetry(async () => {
    const response = await apiFetch(null, `https://merchantapi.googleapis.com/${path}`, options);
    return await response.json();
  });
}
async function merchantListAccounts({ forceRefresh=false } = {}){
  const scope = await ensureGoogleCacheScope();
  return await cachedResource({
    service: "merchant-accounts",
    scope,
    kind: CACHE_KIND_LIST,
    policy: CACHE_POLICY_MANUAL,
    params: { route: "merchantListAccounts" },
    forceRefresh,
    fetcher: async () => {
      const data = await merchantFetch("accounts/v1/accounts?pageSize=500");
      return { accounts:data.accounts || [], nextPageToken:data.nextPageToken || "" };
    }
  });
}
function merchantPresetQuery(preset, { startDate, endDate, countryCode, categoryId, marketingMethod }){
  const start = cleanIsoDate(startDate, "Start date");
  const end = cleanIsoDate(endDate, "End date");
  const country = String(countryCode || "US").trim().toUpperCase();
  const needsCountry = ["price_competitiveness", "best_sellers", "competitive_visibility"].includes(preset);
  if (needsCountry && !/^[A-Z]{2}$/.test(country)) throw new Error("Report country must be a two-letter code.");
  const category = ["best_sellers", "competitive_visibility"].includes(preset)
    ? cleanNumericId(categoryId || "166", "Google product category ID") : "166";
  const weeklyDateValue = new Date(`${end}T00:00:00Z`);
  weeklyDateValue.setUTCDate(weeklyDateValue.getUTCDate() - ((weeklyDateValue.getUTCDay() + 6) % 7));
  const weeklyDate = weeklyDateValue.toISOString().slice(0, 10);
  const method = ["ADS","ORGANIC"].includes(marketingMethod) ? marketingMethod : "";
  const methodFilter = method ? ` AND marketing_method = '${method}'` : "";
  const performanceFields = method === "ADS"
    ? "offer_id, title, brand, marketing_method, customer_country_code, impressions, clicks, click_through_rate"
    : "offer_id, title, brand, marketing_method, customer_country_code, impressions, clicks, click_through_rate, conversions, conversion_rate, conversion_value";
  const queries = {
    product_performance:`SELECT ${performanceFields} FROM product_performance_view WHERE date BETWEEN '${start}' AND '${end}'${methodFilter} ORDER BY clicks DESC LIMIT 250`,
    product_status:`SELECT offer_id, id, title, brand, availability, price, feed_label, language_code, click_potential, item_issues FROM product_view LIMIT 250`,
    price_competitiveness:`SELECT id, offer_id, title, brand, price, report_country_code, benchmark_price FROM price_competitiveness_product_view WHERE report_country_code = '${country}' LIMIT 250`,
    price_insights:`SELECT id, offer_id, title, brand, price, suggested_price, effectiveness, predicted_impressions_change_fraction, predicted_clicks_change_fraction, predicted_conversions_change_fraction FROM price_insights_product_view LIMIT 250`,
    best_sellers:`SELECT report_date, report_granularity, report_country_code, report_category_id, rank, previous_rank, relative_demand, relative_demand_change, title, brand, inventory_status, brand_inventory_status FROM best_sellers_product_cluster_view WHERE report_date = '${weeklyDate}' AND report_granularity = 'WEEKLY' AND report_country_code = '${country}' AND report_category_id = ${category} ORDER BY rank LIMIT 250`,
    competitive_visibility:`SELECT report_country_code, report_category_id, traffic_source, domain, is_your_domain, rank, ads_organic_ratio, page_overlap_rate, higher_position_rate, relative_visibility FROM competitive_visibility_competitor_view WHERE date BETWEEN '${start}' AND '${end}' AND report_country_code = '${country}' AND report_category_id = ${category} AND traffic_source = '${method || "ADS"}' ORDER BY rank LIMIT 250`
  };
  if (!queries[preset]) throw new Error("Unknown Merchant Center report preset.");
  return queries[preset];
}
async function merchantRunPreset(payload){
  const accountId = cleanNumericId(payload.accountId, "Merchant Center account ID");
  const query = merchantPresetQuery(payload.preset, payload);
  const scope = await ensureGoogleCacheScope();
  return await cachedResource({
    service: "merchant-report",
    scope,
    kind: CACHE_KIND_REPORT,
    policy: CACHE_POLICY_TTL_1H,
    params: { accountId, query },
    forceRefresh: !!payload.forceRefresh,
    fetcher: async () => {
      const data = await merchantFetch(`reports/v1/accounts/${accountId}/reports:search`, {
        method:"POST",
        body:JSON.stringify({ query, pageSize:250 })
      });
      return { rows:data.results || [], nextPageToken:data.nextPageToken || "" };
    }
  });
}

async function withScopeRetry(run) {
  try {
    return await run();
  } catch (e) {
    const txt = String(e && e.message || e);
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(txt)) {
      await clearCachedGoogleAuth();
      throw new Error("Google permissions changed. Open Settings and reconnect Google.");
    }
    throw e;
  }
}

// Search Console lives in gsc-api.js; this file supplies the token, the
// scheduler and the error shaping through gscRequest.
const gscApi = createGscApi({ request: gscRequest });
const listSites = () => gscApi.listSites();
const inspect = (siteUrl, pageUrl) => gscApi.inspect(siteUrl, pageUrl);
const searchAnalytics = (...args) => gscApi.searchAnalytics(...args);

async function gscRequest(url, options = {}){
  const token = await getToken();
  const res = await apiFetch(token, url, options);
  return await res.json();
}


// ===== GA4 =====

// List GA4 properties across all accounts (displayName + numeric id)
// Google paginates both accounts and properties. Without following
// nextPageToken an agency past one page silently loses the tail with no error,
// which looks identical to "the property does not exist".
// GA4 lives in ga-api.js; this file supplies the token, the scheduler, the
// scope retry and the error shaping through gaRequest.
const gaApi = createGaApi({ request: gaRequest });
const gaListProperties = () => withScopeRetry(() => gaApi.listProperties());
const gaListKeyEvents = propertyId => withScopeRetry(() => gaApi.listKeyEvents(propertyId));
const gaListWebStreams = propertyId => gaApi.listWebStreams(propertyId);
const gaRunReport = (...args) => withScopeRetry(() => gaApi.runReport(...args));

async function gaRequest(url, options = {}){
  const token = await getToken();
  const res = await apiFetch(token, url, options);
  return await res.json();
}

// Sync Active Tab to GA Proprty
// --- GA4 detection helpers ---

// List web data streams for a property

// Inject into the active tab and collect GA4 Measurement IDs (G-XXXX…)
// Inject into ALL frames and collect GA4 Measurement IDs (G-XXXX…)
async function sniffGaMeasurementIdsFromTab(tabId, tries = 3, delayMs = 1200){
  const collectOnce = async () => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: () => {
        const ids = new Set();
        const gtms = new Set();
        const push = v => { if (typeof v === 'string' && /^G-[A-Z0-9]{6,}/.test(v)) ids.add(v.trim()); };

        // 0) If gtag is present now, read known IDs from the queue/state
        try{
          // queued calls: gtag('config','G-XXXX')
          const dl = (window && window.dataLayer) || [];
          if (Array.isArray(dl)) {
            dl.forEach(ev=>{
              if (!ev || typeof ev !== 'object') return;
              // common shapes
              if (ev.measurement_id) push(ev.measurement_id);
              if (ev.send_to){
                if (Array.isArray(ev.send_to)) ev.send_to.forEach(push);
                else push(ev.send_to);
              }
              if (ev.config){
                if (Array.isArray(ev.config)) ev.config.forEach(push);
                else if (typeof ev.config === 'string') push(ev.config);
              }
            });
          }
        }catch(_){}

        // 1) Inline script contents
        document.querySelectorAll('script').forEach(s=>{
          try{
            const t = s.textContent || '';
            (t.match(/G-[A-Z0-9]{6,12}/g) || []).forEach(push);
            const src = s.getAttribute('src') || '';
            // gtag.js?id=G-XXXX, gtm.js?id=GTM-XXXX
            const m = src.match(/[?&]id=(G-[A-Z0-9]{6,12})/i);
            if (m) push(m[1]);
            const gtm = src.match(/[?&]id=(GTM-[A-Z0-9]{4,12})/i);
            if (gtm) gtms.add(gtm[1]);
          }catch(_){}
        });

        // 2) Meta / data attributes
        document.querySelectorAll('[data-measurement-id],meta[content^="G-"]').forEach(el=>{
          const v = el.getAttribute('data-measurement-id') || el.getAttribute('content') || '';
          push(v);
        });

        // 3) Noscript GTM iframe
        document.querySelectorAll('iframe[src*="googletagmanager.com/ns.html?id="]').forEach(f=>{
          const src = f.getAttribute('src') || '';
          const m = src.match(/[?&]id=(GTM-[A-Z0-9]{4,12})/i);
          if (m) gtms.add(m[1]);
        });

        return { ids: Array.from(ids), gtms: Array.from(gtms) };
      }
    });

    const set = new Set();
    (results || []).forEach(r => (r?.result?.ids || []).forEach(v => set.add(v)));
    return set;
  };

  let set = await collectOnce();
  while (set.size === 0 && tries-- > 0){
    await new Promise(r => setTimeout(r, delayMs));
    (await collectOnce()).forEach(v => set.add(v));
  }
  return set;
}

// Main: detect property for the active tab
const GA_STREAM_DETECT_CONCURRENCY = 6;
async function gaDetectPropertyFromActiveTab(){
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (!tab || !/^https?:/i.test(tab.url)) throw new Error("No http(s) active tab.");
  const tabHost = new URL(tab.url).host.toLowerCase();

  const gIds = await sniffGaMeasurementIdsFromTab(tab.id, 2, 1200);

  const props = (await gaListPropertiesCached()).data;
  let hostFallback = null;
  let firstStreamError = null;
  let successfulProperties = 0;

  for (let offset = 0; offset < props.length; offset += GA_STREAM_DETECT_CONCURRENCY){
    const batch = props.slice(offset, offset + GA_STREAM_DETECT_CONCURRENCY);
    const streamsByProperty = await Promise.all(batch.map(async p => {
      try{
        return { property:p, data:(await gaListWebStreamsCached(p.id)).data, error:null };
      }catch(error){
        return { property:p, data:null, error };
      }
    }));

    for (const result of streamsByProperty){
      if (result.error){
        firstStreamError ||= result.error;
        continue;
      }
      successfulProperties += 1;
      const p = result.property;
      for (const stream of (result.data?.webDataStreams || [])){
        const mId = stream.measurementId;
        const streamName = stream.name || '';
        const streamId = streamName.split('/').pop();
        const uri = (stream.defaultUri || '').toLowerCase();
        const uriHost = (()=>{ try{ return new URL(uri).host.toLowerCase(); }catch{ return ''; } })();

        if (mId && gIds.has(mId)){
          return {
            propertyId: p.id, propertyName: p.displayName,
            measurementId: mId, streamId, defaultUri: uri,
            tabUrl: tab.url, via: "measurementId"
          };
        }

        if (!hostFallback && uriHost && uriHost === tabHost){
          hostFallback = {
            propertyId: p.id, propertyName: p.displayName,
            measurementId: mId || null, streamId, defaultUri: uri,
            tabUrl: tab.url, via: "hostMatch"
          };
        }
      }
    }

    // With no measurement ID on the page, a hostname match is the strongest
    // available signal, so avoid requesting every remaining property.
    if (gIds.size === 0 && hostFallback) return hostFallback;
  }

  if (!successfulProperties && firstStreamError) throw firstStreamError;

  return hostFallback || {
    propertyId: null, propertyName: null, measurementId: null,
    tabUrl: tab.url, via: "none", foundGIds: Array.from(gIds)
  };
}

// End Sync Active tab to GA Property

// Run a simple GA4 report
// GA4 Ends

async function probe(url){
  try{
    const r = await fetch(url, { method:"GET", redirect:"follow" });
    return { status: r.status, finalUrl: r.url || url };
  }catch(e){
    return { error: String(e) };
  }
}

// ---------- CallRail ----------
async function callrailFetch(path, params = {}){
  const apiKey = await getCallrailApiKey();
  if (!apiKey) throw new Error('CallRail API key is not set. Open the CallRail tab and save a key.');

  const url = new URL(`https://api.callrail.com/v3${path}`);
  for (const [k,v] of Object.entries(params || {})){
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  // Reads only, so the scheduler may retry a rate limit instead of handing the
  // user a failed report.
  return await apiScheduler.run('api.callrail.com', async () => {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Token token=${apiKey}`,
        'Accept': 'application/json'
      }
    });

    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }

    if (!res.ok){
      const msg = (data && (data.message || data.error)) ? (data.message || data.error) : (typeof data === 'string' ? data : `HTTP ${res.status}`);
      if (res.status === 401) throw httpResponseError(res, txt, 'CallRail: Unauthorized. Check your API key.');
      if (res.status === 429) throw httpResponseError(res, txt, 'CallRail: Rate limited.');
      throw httpResponseError(res, txt, `CallRail: ${msg}`);
    }
    return data;
  }, { retry: true });
}

// Pagination, field lists and response shaping live in callrail-api.js, which
// runs under node --test. This file keeps what needs the browser: the API key,
// the scheduler and the HTTP error shaping, all behind callrailFetch.
const callrailApi = createCallrailApi({ request: (path, params) => callrailFetch(path, params) });
const callrailListAccounts = () => callrailApi.listAccounts();
const callrailListCompanies = accountId => callrailApi.listCompanies(accountId);
const callrailListCalls = payload => callrailApi.listCalls(payload);
const callrailCallDetail = payload => callrailApi.callDetail(payload);
const callrailCallSummary = payload => callrailApi.callSummary(payload);

async function listSitesCached({ forceRefresh=false } = {}){
  const scope = await ensureGoogleCacheScope();
  return await cachedResource({
    service: "gsc-sites",
    scope,
    kind: CACHE_KIND_LIST,
    policy: CACHE_POLICY_MANUAL,
    params: { route: "listSites" },
    forceRefresh,
    fetcher: () => listSites()
  });
}

async function gaListPropertiesCached({ forceRefresh=false } = {}){
  const scope = await ensureGoogleCacheScope();
  const response = await cachedResource({
    service: "ga-properties",
    scope,
    kind: CACHE_KIND_LIST,
    policy: CACHE_POLICY_MANUAL,
    params: { route: "gaListProperties" },
    forceRefresh,
    fetcher: () => gaListProperties()
  });
  if (forceRefresh && response.cache?.source === "network"){
    await clearCacheNamespaces(namespace => namespace.includes(":service:ga-streams:"));
  }
  return response;
}

async function gaListWebStreamsCached(propertyId, { forceRefresh=false } = {}){
  const scope = await ensureGoogleCacheScope();
  return await cachedResource({
    service: "ga-streams",
    scope,
    kind: CACHE_KIND_LIST,
    policy: CACHE_POLICY_MANUAL,
    params: { propertyId },
    forceRefresh,
    fetcher: () => gaListWebStreams(propertyId)
  });
}

async function gaListKeyEventsCached(propertyId, { forceRefresh=false } = {}){
  const scope = await ensureGoogleCacheScope();
  return await cachedResource({
    service: "ga-key-events",
    scope,
    kind: CACHE_KIND_LIST,
    policy: CACHE_POLICY_MANUAL,
    params: { propertyId },
    forceRefresh,
    fetcher: () => gaListKeyEvents(propertyId)
  });
}

async function gaRunReportCached(payload, { forceRefresh=false } = {}){
  const scope = await ensureGoogleCacheScope();
  const params = {
    propertyId: payload.propertyId || "",
    startDate: payload.startDate || "",
    endDate: payload.endDate || "",
    dimension: payload.dimension || "",
    dimensions: Array.isArray(payload.dimensions) ? payload.dimensions : [],
    metrics: Array.isArray(payload.metrics) ? payload.metrics : [],
    inListFilter: payload.inListFilter || null,
    rowLimit: Number.isFinite(Number(payload.rowLimit)) ? Number(payload.rowLimit) : null,
    orderByMetric: payload.orderByMetric || ""
  };
  return await cachedResource({
    service: "ga-report",
    scope,
    kind: CACHE_KIND_REPORT,
    policy: CACHE_POLICY_TTL_1H,
    params,
    forceRefresh,
    fetcher: () => gaRunReport(
      payload.propertyId,
      payload.startDate,
      payload.endDate,
      payload.dimension,
      payload.dimensions,
      payload.metrics,
      payload.inListFilter,
      payload.rowLimit,
      payload.orderByMetric
    )
  });
}

async function searchAnalyticsCached(payload, { forceRefresh=false } = {}){
  const scope = await ensureGoogleCacheScope();
  const params = {
    siteUrl: payload.siteUrl || "",
    url: payload.url || null,
    startDate: payload.startDate || "",
    endDate: payload.endDate || "",
    pageOnly: !!payload.pageOnly,
    dimensions: Array.isArray(payload.dimensions) ? payload.dimensions.join(",") : "",
    rowLimit: Number.isFinite(Number(payload.rowLimit)) ? Math.floor(Number(payload.rowLimit)) : "",
    aggregationType: payload.aggregationType || "",
    dataState: normalizeGscDataState(payload.dataState)
  };
  return await cachedResource({
    service: "gsc-perf",
    scope,
    kind: CACHE_KIND_REPORT,
    policy: CACHE_POLICY_TTL_1H,
    params,
    forceRefresh,
    fetcher: () => searchAnalytics(
      payload.siteUrl,
      payload.url,
      payload.startDate,
      payload.endDate,
      !!payload.pageOnly,
      payload.dimensions,
      payload.rowLimit,
      payload.aggregationType,
      payload.dataState
    )
  });
}

async function callrailListAccountsCached({ forceRefresh=false } = {}){
  const scope = await ensureCallrailCacheScope();
  return await cachedResource({
    service: "callrail-accounts",
    scope,
    kind: CACHE_KIND_LIST,
    policy: CACHE_POLICY_MANUAL,
    params: { route: "callrailListAccounts" },
    forceRefresh,
    fetcher: () => callrailListAccounts()
  });
}

async function callrailListCompaniesCached(accountId, { forceRefresh=false } = {}){
  const scope = await ensureCallrailCacheScope();
  return await cachedResource({
    service: "callrail-companies",
    scope,
    kind: CACHE_KIND_LIST,
    policy: CACHE_POLICY_MANUAL,
    params: { accountId: String(accountId || "") },
    forceRefresh,
    fetcher: () => callrailListCompanies(accountId)
  });
}

async function callrailCallSummaryCached(payload, { forceRefresh=false } = {}){
  const scope = await ensureCallrailCacheScope();
  const params = {
    accountId: String(payload.accountId || ""),
    companyId: String(payload.companyId || ""),
    start_date: payload.start_date || "",
    end_date: payload.end_date || "",
    group_by: payload.group_by || "",
    device: payload.device || "",
    lead_status: payload.lead_status || "",
    first_time_callers: payload.first_time_callers ?? "",
    min_duration: payload.min_duration ?? "",
    max_duration: payload.max_duration ?? "",
    include_voicemails: payload.include_voicemails === true
  };
  return await cachedResource({
    service: "callrail-summary",
    scope,
    kind: CACHE_KIND_REPORT,
    policy: CACHE_POLICY_TTL_1H,
    params,
    forceRefresh,
    fetcher: () => callrailCallSummary(payload)
  });
}


async function callrailListCallsCached(payload, { forceRefresh=false } = {}){
  const scope = await ensureCallrailCacheScope();
  const params = {
    accountId: String(payload.accountId || ""),
    companyId: String(payload.companyId || ""),
    start_date: payload.start_date || "",
    end_date: payload.end_date || "",
    source: payload.source || "",
    device: payload.device || "",
    lead_status: payload.lead_status || "",
    answered: payload.answered ?? "",
    limit: Number(payload.limit) || 100
  };
  return await cachedResource({
    service: "callrail-calls",
    scope,
    kind: CACHE_KIND_REPORT,
    policy: CACHE_POLICY_TTL_1H,
    params,
    forceRefresh,
    fetcher: () => callrailListCalls(payload)
  });
}

async function callrailCallDetailCached(payload, { forceRefresh=false } = {}){
  const scope = await ensureCallrailCacheScope();
  return await cachedResource({
    service: "callrail-call",
    scope,
    kind: CACHE_KIND_REPORT,
    policy: CACHE_POLICY_TTL_1H,
    params: { accountId: String(payload.accountId || ""), callId: String(payload.callId || "") },
    forceRefresh,
    fetcher: () => callrailCallDetail(payload)
  });
}

// ---------- error taxonomy ----------
// Google returns a JSON blob on failure. Dumping it into the UI makes a quota
// error look identical to a typo, so failures are classified into a short
// message plus a machine-readable code the UI can act on.
function classifyError(err, context = {}){
  const raw = String(err?.message || err || "");
  let parsed = null;
  try {
    const start = raw.indexOf("{");
    if (start >= 0) parsed = JSON.parse(raw.slice(start));
  } catch(_) { parsed = null; }
  const apiError = parsed?.error || parsed;
  const status = String(apiError?.status || "");
  const httpCode = Number(err?.httpStatus || apiError?.code || 0);
  const detail = String(apiError?.message || err?.detail || raw);
  const retrySeconds = Math.max(0, Number(err?.retryAfterSeconds || 0));
  const label = context.source ? `${context.source}: ` : "";

  const wrap = (code, message, retryable=false) => ({
    code, message, retryable, retryAfterSeconds: retrySeconds, detail: detail.slice(0, 400)
  });
  if (err?.userMessage) return wrap('ads_report', err.userMessage);

  const retryMessage = retrySeconds
    ? `Try again in ${retrySeconds < 60 ? `${retrySeconds} seconds` : `${Math.ceil(retrySeconds / 60)} minutes`}.`
    : "Try again in a few minutes.";

  if (/Google account is not connected|No Google account connected/i.test(raw)){
    return wrap("auth_required", "Not connected to Google. Open Settings and choose an account.");
  }
  if (/Session expired|reconnect this Google account|Google permissions changed|invalid_grant/i.test(raw)){
    return wrap("auth_expired", "Your Google session expired. Reconnect the account in Settings.");
  }
  if (/CallRail API key is not set/i.test(raw)){
    return wrap("auth_required", "CallRail is not connected. Add the API key in Settings.");
  }
  if (/CallRail: Unauthorized/i.test(raw)){
    return wrap("auth_required", "CallRail rejected the API key. Re-enter it in Settings.");
  }
  if (httpCode === 401 || status === "UNAUTHENTICATED"){
    return wrap("auth_expired", `${label}sign-in expired. Reconnect the account in Settings.`);
  }
  if (status === "PERMISSION_DENIED" || httpCode === 403){
    if (/quota|rate|limit/i.test(detail)){
      return wrap("quota", `${label}API quota reached. ${retryMessage}`, true);
    }
    return wrap("forbidden", `${label}this account does not have access to that property.`);
  }
  if (httpCode === 429 || status === "RESOURCE_EXHAUSTED" || /Rate limited/i.test(raw)){
    return wrap("quota", `${label}rate limit reached. ${retryMessage}`, true);
  }
  if (httpCode === 404 || status === "NOT_FOUND"){
    return wrap("not_found", `${label}that property or resource is not accessible or no longer exists.`);
  }
  if (status === "INVALID_ARGUMENT" || httpCode === 400){
    return wrap("bad_request", `${label}that request was rejected. Try a shorter date range or a different dimension.`);
  }
  if (httpCode >= 500 || /INTERNAL|UNAVAILABLE/i.test(status)){
    return wrap("server", `${label}the service is temporarily unavailable. Try again shortly.`, true);
  }
  if (/Failed to fetch|NetworkError|network/i.test(raw)){
    return wrap("offline", "No network connection. Check your connection and retry.", true);
  }
  if (raw.startsWith("CallRail:")){
    return wrap("callrail", raw.replace(/^CallRail:\s*/, "CallRail: "), /rate limit/i.test(raw));
  }
  return wrap("unknown", detail.length > 160 ? `${label}request failed.` : (detail || "Request failed."));
}

const ROUTE_SOURCES = {
  gbpDiscover: "Business Profile",
  gbpRunLocation: "Business Profile",
  gbpWrite: "Business Profile",
  listSites: "Search Console",
  inspect: "Search Console",
  perf: "Search Console",
  gaListProperties: "GA4",
  gaListKeyEvents: "GA4",
  gaReport: "GA4",
  gaDetectFromTab: "GA4",
  googleAdsListCustomers: "Google Ads",
  googleAdsRunPreset: "Google Ads",
  googleAdsGetOptions: "Google Ads",
  merchantListAccounts: "Merchant Center",
  merchantRunPreset: "Merchant Center",
  callrailListAccounts: "CallRail",
  callrailListCompanies: "CallRail",
  callrailCallSummary: "CallRail",
  callrailListCalls: "CallRail",
  callrailCallDetail: "CallRail"
};

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try{
      if (msg.type === "ping") return sendResponse({ ok:true, data:"pong" });
      if (msg.type === "gbpDiscover") return sendResponse({ ok:true, data:await gbpApi.discover() });
      if (msg.type === "gbpRunLocation") return sendResponse({ ok:true, data:await gbpApi.run(msg) });
      if (msg.type === "gbpWrite") {
        if (!msg.expectedEmail || msg.expectedEmail.toLowerCase() !== String(await getActiveEmail()).toLowerCase()) throw new Error('Google account changed. Reopen the draft before submitting.');
        return sendResponse({ ok:true, data:await gbpApi.write({...msg,authScope:await getGoogleCacheScope()}) });
      }

      if(msg.type === "listSites"){
        const result = await listSitesCached({ forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data:result.data, cache: result.cache });
      }
      if(msg.type === "inspect"){
        const { siteUrl, url } = msg;
        if(!covers(siteUrl, url)) return sendResponse({ ok:false, error:"Selected property does not cover this URL." });
        const d = await inspect(siteUrl, url); return sendResponse({ ok:true, data:d });
      }
      if(msg.type === "perf"){
        const { siteUrl, url, startDate, endDate, pageOnly, dimensions, rowLimit, aggregationType, dataState } = msg;
        if(pageOnly && (!url || !covers(siteUrl, url))) return sendResponse({ ok:false, error:"Performance: selected property must cover the page URL." });
        const result = await searchAnalyticsCached({
          siteUrl,
          url,
          startDate,
          endDate,
          pageOnly: !!pageOnly,
          dimensions,
          rowLimit,
          aggregationType,
          dataState
        }, { forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data:result.data, cache: result.cache });
      }
      if(msg.type === "probe"){
        const d = await probe(msg.url); return sendResponse({ ok:true, data:d });
      }
      if(msg.type === "logout"){
        await clearAllGoogleAccounts();
        await clearCachedGoogleAuth();
        await clearGoogleCaches();
        await delInStore(AUTH_PROVIDER_KEY);
        await delInStore(CHROME_PROFILE_KEY);
        await delInStore(LAST_AUTH_EVENT_KEY);
        return sendResponse({ ok:true });
      }
      if(msg.type === "authListAccounts"){
        return sendResponse({ ok:true, data: await listGoogleAccounts() });
      }
      if(msg.type === "authSelectAccount"){
        if (!multiAccountEnabled()) return sendResponse({ ok:false, error:"Multi-account sign-in is not configured." });
        await setActiveGoogleAccount(msg.email);
        return sendResponse({ ok:true, data: await listGoogleAccounts() });
      }
      if(msg.type === "authRemoveAccount"){
        if (!multiAccountEnabled()) return sendResponse({ ok:false, error:"Multi-account sign-in is not configured." });
        return sendResponse({ ok:true, data: await removeGoogleAccount(msg.email) });
      }
      if(msg.type === "connectGoogle" || msg.type === "useChromeGoogleAccount"){
        return sendResponse(await runAccountChoice("chrome"));
      }
      if(msg.type === "switchGoogleAccount"){
        return sendResponse(await runAccountChoice("web"));
      }
      if(msg.type === "consumeAuthEvent"){
        const event = await getFromStore(LAST_AUTH_EVENT_KEY) || null;
        if (event) await delInStore(LAST_AUTH_EVENT_KEY);
        return sendResponse({ ok:true, data: event });
      }
      if(msg.type === "getAccount"){
        // Account discovery must never trigger silent authentication. A profile
        // is stored only after the user explicitly chooses an account.
        const provider = await getGoogleAuthProvider();
        let profile = provider === AUTH_PROVIDER_WEB
          ? await syncActiveGoogleAccountProfile()
          : await getFromStore(CHROME_PROFILE_KEY) || await getFromStore("accountProfile");
        if (provider === AUTH_PROVIDER_CHROME && profile?.email && !(await getFromStore(CHROME_PROFILE_KEY))){
          profile = accountProfileFromRecord(profile);
          await setInStore({ [CHROME_PROFILE_KEY]: profile });
        }
        return sendResponse({ ok:true, data: profile?.email ? buildPseudoIdToken({ email: profile.email }) : null, account: profile ? { ...profile, provider } : null, provider, webAvailable:multiAccountEnabled() });
      }
      if (msg.type === "gaDetectFromTab"){
        const data = await gaDetectPropertyFromActiveTab();
        return sendResponse({ ok:true, data });
      }
      if (msg.type === "gaListProperties"){
        const result = await gaListPropertiesCached({ forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === "gaListKeyEvents"){
        const { propertyId } = msg;
        const result = await gaListKeyEventsCached(propertyId, { forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === "gaReport"){
        const { propertyId, startDate, endDate, dimension, dimensions, metrics, inListFilter, rowLimit, orderByMetric } = msg;
        const result = await gaRunReportCached({ propertyId, startDate, endDate, dimension, dimensions, metrics, inListFilter, rowLimit, orderByMetric }, { forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }

      // Direct Google Ads API and Merchant API integrations.
      if (msg.type === "googleAdsGetConfig"){
        const config = await getGoogleAdsConfig();
        return sendResponse({ ok:true, data:{ loginCustomerId:config.loginCustomerId } });
      }
      if (msg.type === "googleAdsSetConfig"){
        return sendResponse({ ok:true, data:await setGoogleAdsConfig(msg) });
      }
      if (msg.type === "googleAdsListCustomers"){
        const result = await googleAdsListCustomers({ forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === "googleAdsRunPreset"){
        const result = await googleAdsRunPreset(msg);
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === "googleAdsGetOptions"){
        return sendResponse({ ok:true, data:await adsApi.options(msg) });
      }
      if (msg.type === "merchantListAccounts"){
        const result = await merchantListAccounts({ forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === "merchantRunPreset"){
        const result = await merchantRunPreset(msg);
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }

      // CallRail
      if (msg.type === 'callrailListAccounts'){
        const result = await callrailListAccountsCached({ forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === 'callrailListCompanies'){
        const result = await callrailListCompaniesCached(msg.accountId, { forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === 'callrailCallSummary'){
        const result = await callrailCallSummaryCached(msg, { forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === 'callrailListCalls'){
        const result = await callrailListCallsCached(msg, { forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === 'callrailCallDetail'){
        const result = await callrailCallDetailCached(msg, { forceRefresh: !!msg.forceRefresh });
        return sendResponse({ ok:true, data: result.data, cache: result.cache });
      }
      if (msg.type === "callrailInvalidateCache"){
        await clearCallrailCaches();
        return sendResponse({ ok:true });
      }

      return sendResponse({ ok:false, error:"Unknown message" });
    }catch(e){
      const info = classifyError(e, { source: ROUTE_SOURCES[msg?.type] || "" });
      console.error("[SCC] router error", msg?.type, info.code, e);
      sendResponse({ ok:false, error: info.message, code: info.code, retryable: info.retryable, retryAfterSeconds: info.retryAfterSeconds, detail: info.detail });
    }
  })();
  return true;
});

// Clicking the toolbar icon opens the popup; the side panel is opened from the
// popup's own button so it stays a user gesture.
chrome.runtime.onInstalled.addListener(() => {
  try { chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }); } catch(_) {}
});

console.log("[SCC] Service worker started");

// Clean up OAuth credentials persisted by earlier versions. Chrome Identity
// remains the sole token store; the account profile is kept for signed-in UI.
delInStore("token").catch(() => {});
