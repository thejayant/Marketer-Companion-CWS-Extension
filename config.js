// config.js — fill in your OAuth details
export const CLIENT_ID = "1099294114553-snrorkmr7gge9fn2jvd09e0i6etdov1s.apps.googleusercontent.com";
// Optional, and only used by the alternate-account (WEB_CLIENT_ID) flow below.
// It selects which OAuth flow that provider runs:
//
//   blank (default)  Implicit flow. No token endpoint call, so no secret has to
//                    ship inside the package. Access tokens last one hour and
//                    renew silently in the background via prompt=none, which
//                    works while Chrome still holds a session for that account.
//                    If the session is gone the user just picks the account
//                    again in Settings.
//   set              Authorisation code + PKCE, which also returns a refresh
//                    token, so sessions survive indefinitely without any
//                    re-prompt. A Google "Web application" client is a
//                    confidential client and its token endpoint rejects a code
//                    exchange with no client_secret, PKCE or not - which is why
//                    the code flow cannot run without this value. The trade-off
//                    is that the secret is extractable from the shipped CRX.
//
// The Google OAuth client must allow chrome.identity.getRedirectURL()
// for the installed extension ID, or sign-in will fail with redirect_uri_mismatch.
export const CLIENT_SECRET = ""; // e.g. "GOCSPX-xxxxx_your_secret_xxxxx"

export const SCOPES = [
  "openid",
  "email", 
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly"
].join(" ");

// --- Multi-account sign-in (Google Cloud Console setup required) ---
// chrome.identity.getAuthToken() is permanently bound to the Chrome profile's
// signed-in account and cannot present an account chooser. To let one browser
// profile use several Google accounts, create a **Web application** OAuth client
// and paste its ID below.
//
// In Google Cloud Console → Credentials → Create credentials → OAuth client ID:
//   Application type:            Web application
//   Authorised redirect URI:     https://lpodioiagjlpncibpgiopfbkpfeffjki.chromiumapp.org/
//
// Get <EXTENSION_ID> from chrome://extensions with Developer mode on. No client
// secret is used or needed - the flow below uses PKCE.
//
// Leave this blank to keep the existing single-account behaviour unchanged.
export const WEB_CLIENT_ID = "1099294114553-oll9hso7lf8eu7nvposue2018bl158ui.apps.googleusercontent.com";
