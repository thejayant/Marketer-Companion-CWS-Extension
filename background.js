// background.js — MV3 module service worker
// Google auth via chrome.identity.getAuthToken(), GSC, GA4, CallRail

import * as CFG from "./config.js";

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

async function apiFetch(token, url, opt = {}){
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

function covers(siteUrl, pageUrl){
  try{
    if(siteUrl.startsWith("sc-domain:")){
      const domain = siteUrl.split(":")[1];
      const u = new URL(pageUrl);
      return u.hostname === domain || u.hostname.endsWith("."+domain);
    }
    return pageUrl.startsWith(siteUrl);
  }catch{ return false; }
}

// ---------- API wrappers ----------
async function listSites(){
  const token = await getToken();
  const res = await apiFetch(token, "https://www.googleapis.com/webmasters/v3/sites");
  const data = await res.json();
  return data?.siteEntry || [];
}
async function inspect(siteUrl, pageUrl){
  const token = await getToken();
  const payload = { inspectionUrl: pageUrl, siteUrl };
  const res = await apiFetch(token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method:"POST", body: JSON.stringify(payload)
  });
  return await res.json();
}

// ===== GA4 =====

// List GA4 properties across all accounts (displayName + numeric id)
// Google paginates both accounts and properties. Without following
// nextPageToken an agency past one page silently loses the tail with no error,
// which looks identical to "the property does not exist".
const GA_PAGE_GUARD = 25;
async function gaPagedList(token, buildUrl, collectionKey){
  const items = [];
  let pageToken = "";
  let pages = 0;
  do {
    const url = buildUrl();
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await apiFetch(token, url.toString());
    const json = await res.json();
    items.push(...(json?.[collectionKey] || []));
    pageToken = json?.nextPageToken || "";
  } while (pageToken && ++pages < GA_PAGE_GUARD);
  return items;
}
async function gaListProperties(){
  return withScopeRetry(async () => {
    const token = await getToken();
    const accounts = await gaPagedList(token, () => {
      const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accounts");
      url.searchParams.set("pageSize", "200");
      return url;
    }, "accounts");

    const list = [];
    // Accounts are fetched in parallel batches; sequential requests over a
    // large agency estate took long enough that the popup looked hung.
    const BATCH = 6;
    for (let index = 0; index < accounts.length; index += BATCH){
      const batch = accounts.slice(index, index + BATCH);
      const results = await Promise.all(batch.map(async account => {
        const properties = await gaPagedList(token, () => {
          const url = new URL("https://analyticsadmin.googleapis.com/v1beta/properties");
          url.searchParams.set("filter", "parent:" + account.name);
          url.searchParams.set("pageSize", "200");
          return url;
        }, "properties").catch(() => []);
        return properties.map(property => ({
          id: (property.name || "").split("/")[1],
          displayName: property.displayName,
          account: account.displayName
        }));
      }));
      results.forEach(rows => list.push(...rows));
    }
    list.sort((x,y)=> (x.account+x.displayName).localeCompare(y.account+y.displayName));
    return list;
  });
}

async function gaListKeyEvents(propertyId){
  return withScopeRetry(async () => {
    const token = await getToken();
    const items = [];
    let pageToken = "";

    do {
      const url = new URL(`https://analyticsadmin.googleapis.com/v1alpha/properties/${propertyId}/keyEvents`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await apiFetch(token, url.toString());
      const data = await res.json();
      items.push(...(data.keyEvents || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);

    return items
      .map(item => ({
        eventName: item.eventName || (item.name || "").split("/").pop() || "",
        custom: !!item.custom,
        countingMethod: item.countingMethod || "",
        createTime: item.createTime || ""
      }))
      .filter(item => item.eventName)
      .sort((a, b) => a.eventName.localeCompare(b.eventName));
  });
}

// Sync Active Tab to GA Proprty
// --- GA4 detection helpers ---

// List web data streams for a property
async function gaListWebStreams(propertyId){
  const token = await getToken();
  const url = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/webDataStreams`;
  const res = await apiFetch(token, url);
  return await res.json();
}

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
async function gaRunReport(propertyId, startDate, endDate, dimension, dimensions, metrics, inListFilter, rowLimit, orderByMetric){
  return withScopeRetry(async () => {
    const token = await getToken();
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const metricNames = Array.isArray(metrics) && metrics.length ? metrics : [
      "activeUsers",
      "sessions",
      "screenPageViews",
      "eventCount"
    ];
    const dimensionNames = Array.isArray(dimensions) && dimensions.length ? dimensions : [dimension || "date"];
    const body = {
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensionNames.map(name => ({ name })),
      metrics: metricNames.map(name => ({ name }))
    };
    if (inListFilter?.fieldName && Array.isArray(inListFilter.values) && inListFilter.values.length){
      body.dimensionFilter = {
        filter: {
          fieldName: inListFilter.fieldName,
          inListFilter: {
            values: inListFilter.values,
            caseSensitive: false
          }
        }
      };
    }
    if (Number.isFinite(Number(rowLimit)) && Number(rowLimit) > 0){
      body.limit = String(Math.floor(Number(rowLimit)));
    }
    if (orderByMetric){
      body.orderBys = [{
        metric: { metricName: orderByMetric },
        desc: true
      }];
    }
    const res = await apiFetch(token, url, { method: "POST", body: JSON.stringify(body) });
    return await res.json();
  });
}
// GA4 Ends

function normalizeGscDataState(value){
  return value === "all" ? "all" : "final";
}

async function searchAnalytics(siteUrl, pageUrl, startDate, endDate, pageOnly = true, dimensions = null, rowLimit = null, aggregationType = null, dataState = "final"){
  const token = await getToken();
  const body = { startDate, endDate, searchType: "web", dataState: normalizeGscDataState(dataState) };
  const hasDimensions = Array.isArray(dimensions) && dimensions.length > 0;

  if (hasDimensions){
    body.dimensions = dimensions;
  }

  if (pageOnly && pageUrl){
    body.dimensionFilterGroups = [{
      filters: [{ dimension: "page", operator: "equals", expression: pageUrl }]
    }];
  }

  if (aggregationType) {
    body.aggregationType = aggregationType;
  } else if (!pageOnly && !hasDimensions) {
    body.aggregationType = "byProperty";
  }

  if (Number.isFinite(Number(rowLimit)) && Number(rowLimit) > 0){
    body.rowLimit = Math.floor(Number(rowLimit));
  } else if (!hasDimensions){
    body.rowLimit = 1;
  }

  const url = "https://www.googleapis.com/webmasters/v3/sites/" + encodeURIComponent(siteUrl) + "/searchAnalytics/query";
  const res = await apiFetch(token, url, { method:"POST", body: JSON.stringify(body) });
  const data = await res.json();

  if (!hasDimensions && (!data.rows || data.rows.length === 0)) {
    const byDateBody = { ...body, dimensions: ["date"], rowLimit: 1000 };
    const res2 = await apiFetch(token, url, { method:"POST", body: JSON.stringify(byDateBody) });
    const d2 = await res2.json();
    if (Array.isArray(d2.rows) && d2.rows.length) {
      // Average position must be impression-weighted, the way Search Console
      // computes it. A plain mean over days lets a day with 4 impressions count
      // as much as a day with 40,000, and the number then fails to reconcile
      // with the Search Console UI.
      const sums = d2.rows.reduce((acc, r) => {
        const impressions = Number(r.impressions || 0);
        acc.clicks += Number(r.clicks || 0);
        acc.impressions += impressions;
        if (typeof r.position === "number" && impressions > 0){
          acc.weightedPosition += r.position * impressions;
          acc.positionImpressions += impressions;
        }
        return acc;
      }, { clicks:0, impressions:0, weightedPosition:0, positionImpressions:0 });
      const ctr = sums.impressions ? (sums.clicks / sums.impressions) : 0;
      const position = sums.positionImpressions
        ? (sums.weightedPosition / sums.positionImpressions)
        : 0;
      data.rows = [{ clicks: sums.clicks, impressions: sums.impressions, ctr, position }];
    }
  }
  return data;
}

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
}

// CallRail pages at 100 records by default. Agencies routinely exceed that on
// companies, so both list endpoints follow the page counter to the end.
const CALLRAIL_PAGE_GUARD = 25;
async function callrailPagedList(path, collectionKey, params = {}){
  const items = [];
  let page = 1;
  for (;;){
    const data = await callrailFetch(path, Object.assign({}, params, { page, per_page: 250 }));
    const batch = data?.[collectionKey] || [];
    items.push(...batch);
    const total = Number(data?.total_records ?? NaN);
    const done = !batch.length
      || (Number.isFinite(total) && items.length >= total)
      || batch.length < 250
      || page >= CALLRAIL_PAGE_GUARD;
    if (done) break;
    page += 1;
  }
  return items;
}

async function callrailListAccounts(){
  return { accounts: await callrailPagedList('/a.json', 'accounts', { fields: 'numeric_id' }) };
}

async function callrailListCompanies(accountId){
  return { companies: await callrailPagedList(`/a/${accountId}/companies.json`, 'companies') };
}

// ---------- CallRail calls + transcripts ----------
async function callrailListCalls({ accountId, companyId, start_date, end_date, source, device, lead_status, answered, limit=100 }){
  const params = {
    start_date,
    end_date,
    company_id: companyId,
    fields: 'id,customer_name,customer_phone_number,customer_city,customer_state,source,source_name,campaign,keywords,landing_page_url,referring_url,duration,formatted_duration,answered,first_call,lead_status,recording,recording_player,tracking_phone_number,start_time,device_type,note,tags',
    sort: 'start_time',
    order: 'desc',
    per_page: Math.min(250, Math.max(1, Number(limit) || 100)),
    page: 1
  };
  if (source) params.source_name = source;
  if (device && device !== 'all') params.device = device;
  if (lead_status) params.lead_status = lead_status;
  if (answered === 'true' || answered === 'false') params.answered = answered;

  const data = await callrailFetch(`/a/${accountId}/calls.json`, params);
  return {
    calls: data?.calls || [],
    total: Number(data?.total_records ?? (data?.calls || []).length)
  };
}

async function callrailCallDetail({ accountId, callId }){
  if (!accountId || !callId) throw new Error('CallRail: a call id is required.');
  const params = {
    fields: 'id,customer_name,customer_phone_number,customer_city,customer_state,source,source_name,campaign,keywords,landing_page_url,referring_url,duration,formatted_duration,answered,first_call,lead_status,recording,recording_player,tracking_phone_number,start_time,device_type,note,tags,transcription,call_summary,call_highlights'
  };
  const call = await callrailFetch(`/a/${accountId}/calls/${encodeURIComponent(callId)}.json`, params);

  // Transcription is a paid add-on. When it is not on the plan CallRail simply
  // omits the field rather than erroring, so surface that as a state instead of
  // rendering an empty panel the user cannot explain.
  let transcript = null;
  let transcriptState = 'unavailable';
  const raw = call?.transcription;
  if (raw && typeof raw === 'object' && Array.isArray(raw.lines)){
    transcript = raw.lines.map(line => ({
      role: line?.role || line?.speaker || '',
      text: line?.text || '',
      startTime: line?.start_time ?? null
    })).filter(line => line.text);
    transcriptState = transcript.length ? 'ready' : 'empty';
  } else if (typeof raw === 'string' && raw.trim()){
    transcript = [{ role:'', text: raw.trim(), startTime: null }];
    transcriptState = 'ready';
  }

  return {
    call,
    transcript,
    transcriptState,
    summary: call?.call_summary || null,
    highlights: Array.isArray(call?.call_highlights) ? call.call_highlights : []
  };
}

async function callrailCallSummary({ accountId, companyId, start_date, end_date, group_by, device, lead_status, first_time_callers, min_duration, max_duration, companyName, groupByLabel, include_voicemails=false }){
  const baseParams = {
    group_by,
    fields: 'total_calls,missed_calls,answered_calls,first_time_callers,average_duration,formatted_average_duration',
    start_date,
    end_date,
    company_id: companyId,
    device: device && device !== 'all' ? device : '',
    lead_status,
    first_time_callers,
    min_duration,
    max_duration,
    answer_status: 'all'
  };

  const base = await callrailFetch(`/a/${accountId}/calls/summary.json`, baseParams);

  const vmMap = new Map();
  if (include_voicemails === true){
    const vm = await callrailFetch(`/a/${accountId}/calls/summary.json`, {
      ...baseParams,
      fields: 'total_calls',
      answer_status: 'voicemail'
    });
    (vm?.grouped_results || []).forEach(r => vmMap.set(String(r.key), Number(r.total_calls || 0)));
  }

  const rows = (base?.grouped_results || []).map(r => {
    const total = Number(r.total_calls || 0);
    const first = Number(r.first_time_callers || 0);
    const voicemails = vmMap.get(String(r.key)) || 0;
    return {
      key: r.key,
      total_calls: total,
      answered_calls: Number(r.answered_calls || 0),
      missed_calls: Number(r.missed_calls || 0),
      voicemails,
      first_time_callers: first,
      returning_callers: Math.max(0, total - first),
      average_duration: r.average_duration,
      formatted_average_duration: r.formatted_average_duration
    };
  }).sort((a,b) => (b.total_calls||0) - (a.total_calls||0));

  return {
    meta: {
      start: start_date,
      end: end_date,
      groupBy: group_by,
      groupByLabel: groupByLabel || group_by,
      companyId: companyId || '',
      companyName: companyName || '',
      includesVoicemails: include_voicemails === true,
      total_results: base?.total_results || null
    },
    rows
  };
}

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
  listSites: "Search Console",
  inspect: "Search Console",
  perf: "Search Console",
  gaListProperties: "GA4",
  gaListKeyEvents: "GA4",
  gaReport: "GA4",
  gaDetectFromTab: "GA4",
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
