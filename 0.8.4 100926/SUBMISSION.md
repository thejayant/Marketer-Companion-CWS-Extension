# Chrome Web Store submission — Marketer Companion 0.8.5

Build with `node build.js`, upload `marketer-companion-0.8.5.zip`.
Listing copy to paste lives in `STORE-LISTING-0.8.5.txt`.

The package contains only the 26 files the extension loads. `build.js`, the
changelogs, this file, `tests/`, `dist/`, `.claude/` and `.playwright-cli/` are
excluded and validated as excluded on every build.

| | |
|---|---|
| Version | `0.8.5` |
| Version name | `0.8.5 - 151126` |
| Extension ID | `lpodioiagjlpncibpgiopfbkpfeffjki` (pinned by `key` in the manifest) |
| Minimum Chrome | 116 |
| Package | 26 files, ~302 KB |

---

## Rejection of 14 Nov 2026 — keyword spam ("Yellow Argon")

The summary was a run of product names, which the policy reads as keyword
stuffing rather than a description:

> GSC, GA4, Google Ads, Business Profile, Merchant Center and CallRail reports,
> plus on-page SEO and structured-data audits.

Replaced, in `manifest.json` and in the listing's Summary field, with a sentence
that says what the extension does:

> See how the sites and business listings you own are performing, and audit the
> SEO and structured data of the page you are on.

**Do not appeal.** The finding is correct on its face: six product names and two
acronyms in one comma-separated line, with no sentence around them. An appeal
spends review time and the listing would come back the same way. Fix, resubmit,
and it clears.

**Both fields have to change.** The manifest's `description` and the dashboard's
Summary are separate inputs that must match; changing only one leaves the
rejected text live.

The detailed description was checked and left alone: across 581 words each
integration is named two or three times, always inside a sentence that says what
it does, which is what the policy asks for. Keep it that way — name integrations
in context, never as a list, and never in the item name or the first line.

If a resubmission is rejected on the name as well, the fallback is to drop the
suffix and ship as plain "Marketer Companion", moving "SEO & marketing toolkit"
into the first sentence of the description.

---

## Blockers — none of these can be done from the code

### 1. Host the privacy policy
The dashboard requires a **publicly reachable https URL**. `privacy.html` ships
inside the package but that does not satisfy the field. Publish it somewhere
permanent and paste the link. Re-publishing the extension must not change it.

### 2. Google OAuth verification
The extension requests six scopes beyond `openid`/`email`. Several are sensitive
or restricted and need Google's OAuth verification on the consent screen before
anyone outside your test users can sign in. **This is a separate review from the
Chrome Web Store's, and it is the long pole — start it first.**

| Scope | Used for |
|---|---|
| `webmasters.readonly` | Search Console performance and URL inspection |
| `analytics.readonly` | GA4 property list and reports |
| `adwords` | Google Ads reporting |
| `content` | Merchant Center reporting |
| `business.manage` | Business Profile reads, and the review reply / post / photo / profile edits the user explicitly submits |

`business.manage` is the one reviewers question hardest, because it grants write
access. Answer plainly: the panel is read-first, every write is previewed,
requires an authorisation tick and an explicit submit, and no write is ever
retried automatically. That is true of the shipped code — see
`gbp-api.js` `write()` and the inspector in `gbp-ui.js`.

### 3. Confirm the extension ID matches the store item
The manifest keeps `key`, pinning the ID to `lpodioiagjlpncibpgiopfbkpfeffjki`,
and your OAuth client's redirect URI is registered for exactly that ID. If the
store item has a different ID, sign-in breaks the moment you publish; you would
need to update the redirect URI to `https://<published-id>.chromiumapp.org/`.

### 4. Screenshots
At least one, 1280×800 or 640×400. The shot list and captions are in
`STORE-LISTING-0.8.5.txt`. Use a demo account: no real client names, no personal
email in the footer.

### 5. Reviewer access
A reviewer cannot exercise this extension without a Google account that owns
Search Console, GA4, Ads, Merchant or Business Profile data. Fill the dashboard's
testing-instructions field with the text under **Reviewer notes** below, and have
either a demo account or a screen recording ready if they ask.

---

## Dashboard answers — ready to paste

### Single purpose

> Marketer Companion reports on web properties and business listings the user
> already owns. It reads their own Google Search Console, Analytics 4, Google
> Ads, Business Profile, Merchant Center and CallRail data through those
> services' official APIs, presents it as one set of reports, and audits the
> on-page SEO and structured data of the page the user is currently viewing.

### Permission justifications

- **identity** — Signs the user in to their own Google account so the extension
  can read that account's data. Tokens are issued by Google through Chrome's
  identity service; the extension never sees a password.
- **storage** — Keeps the user's own settings: chosen Search Console property,
  GA4 property, Ads and Merchant account, Business Profile locations, saved
  client workspaces, report timezone, and a short-lived cache of API responses
  so reopening a report does not re-query the APIs. The most recent Business
  Profile report is held in session storage, which is memory-only and discarded
  when the browser session ends.
- **activeTab** — Reads the current tab's URL so the extension can pre-fill the
  page to inspect and match it to the right Search Console property. Only on a
  user action.
- **scripting** — On a user action, runs a one-off script in the active tab to
  read that page's own title, headings, meta tags, links, images and structured
  data for the on-page and schema audits, and to detect GA4 measurement IDs.
  Nothing is injected persistently and the page content is analysed in the
  browser.
- **sidePanel** — Opens the same interface in Chrome's side panel so a report
  stays visible while the user browses.

### Host permission justifications

- `oauth2.googleapis.com` — OAuth token exchange, refresh and revocation.
- `searchconsole.googleapis.com`, `www.googleapis.com` — Search Console
  performance and URL inspection, plus the userinfo endpoint that identifies the
  signed-in account.
- `analyticsadmin.googleapis.com`, `analyticsdata.googleapis.com` — listing the
  user's GA4 properties and running their reports.
- `googleads.googleapis.com` — Google Ads reporting for accounts the signed-in
  user can already access.
- `merchantapi.googleapis.com` — Merchant Center product and competitiveness
  reports for the user's own Merchant accounts.
- `mybusinessaccountmanagement.googleapis.com`,
  `mybusinessbusinessinformation.googleapis.com` — discovering the user's
  Business Profile accounts, groups and locations, and reading location fields.
- `businessprofileperformance.googleapis.com` — daily performance metrics and
  monthly search keyword impressions for those locations.
- `mybusiness.googleapis.com` — reviews, local posts and media for those
  locations, including the replies and posts the user explicitly submits.
- `mybusinessverifications.googleapis.com`,
  `mybusinessplaceactions.googleapis.com` — verification status and action-link
  diagnostics shown in the location inspector.
- `api.callrail.com` — call records, sources and transcripts for the user's own
  CallRail account, using an API key they enter themselves.

### Remote code

> No. Every script is in the package. The only external request that is not a
> data API is a Google Fonts stylesheet for typography, which contains no
> executable code. The extension's CSP is `script-src 'self'; object-src 'self'`
> and the build refuses to package an inline script, an inline event handler, a
> remote script tag, `eval`, `new Function` or a `debugger` statement.

### Data usage — what to declare

Declare **yes** for:

- **Personally identifiable information** — the signed-in Google account's email
  address, stored locally to label the session and scope saved client mappings.
  Reviewer display names appear in Business Profile review records.
- **Authentication information** — Google OAuth tokens, and the CallRail API key
  the user enters (held for the browser session only).
- **Website content** — the active tab's title, headings, meta tags, links,
  images and structured data, read only on a user action for the audits.
- **Personal communications** — CallRail call records and transcripts, and
  Business Profile customer reviews, are displayed in their panels.

Declare **no** for health, financial and payment information, location, and web
browsing history. Google Ads and Merchant cost and revenue figures are the
user's own business performance metrics, not consumer financial information, and
the extension never reads browsing history.

Tick all three certifications truthfully:

- Not sold to third parties — there is no third party; there is no server.
- Not used or transferred for any purpose unrelated to the single purpose.
- Not used or transferred to determine creditworthiness or for lending.

### Reviewer notes (testing instructions field)

> This extension reports on data the signed-in user already owns, so most panels
> need a Google account with Search Console, Analytics, Ads, Merchant Center or
> Business Profile access.
>
> Two panels need no sign-in and exercise the extension end to end:
>
> 1. Open any public website.
> 2. Click the extension icon, then "On-page" in the left rail. The audit of the
>    current page renders immediately — title, meta description, headings, links
>    and images.
> 3. Click "Structured data" for the JSON-LD, Microdata and RDFa on that page.
>
> For the Google panels, click Settings → Connect Google and sign in with an
> account that owns a Search Console property. The Performance and GA4 panels
> will then populate. No data is sent anywhere except to Google's own APIs;
> there is no developer server.
>
> Business Profile write actions (review replies, posts, photos, profile edits)
> each require a preview, an authorisation checkbox and an explicit submit, and
> are never performed automatically.

---

## Verified in this build

- Manifest V3, valid version string, no `update_url`, all four icons present.
- Name 44/75 characters, short name 11/12, description 122/132.
- No remote code: no `eval`, `new Function`, `debugger`, inline `<script>`,
  inline handler or remote script tag anywhere in the nine shipped scripts and
  three shipped pages. Enforced by `build.js`, which exits non-zero on any of
  them.
- `popup.html` and `panel.html` stylesheets verified identical; `panel.html` is
  generated from `popup.html` at build time so they cannot drift.
- Every declared permission is used by shipped code.
- Archive entry names verified to use forward slashes and to match the ship list
  exactly. `Compress-Archive` under Windows PowerShell wrote `icons\icon16.png`,
  which is invalid in a ZIP and makes the manifest's icons unresolvable to the
  store; the build now writes entries itself and fails if any name regresses.
- `privacy.html` states plainly that no data is collected and that there is no
  developer server.
- 74 automated tests pass (`node --test tests/ads-reporting.test.mjs
  tests/gbp-reporting.test.mjs tests/net.test.mjs tests/services.test.mjs
  tests/worker.test.mjs`): pagination past the first page, repeated page
  tokens, partial location failures, quota retries, cross-account isolation,
  threshold keywords, safe 64-bit counts, date edges, zero baselines, rating
  calculations, write confirmation and HTML/CSV escaping.
- All six Business Profile reports, the Ads panel and the shared shell render in
  the synthetic preview with no console errors and no horizontal overflow at
  320 px, 420 px and 800 px.

## Known, not blocking

- **The Google Fonts stylesheet is still remote.** Every popup open sends the
  user's IP to Google and the UI falls back to a system font offline. Plus
  Jakarta Sans is OFL, so bundling the woff2 files is permitted and would let
  you drop both font entries from the CSP. Worth doing before a privacy-focused
  reviewer asks.
- **Live API verification is incomplete.** Ads, Merchant and Business Profile
  have been exercised against synthetic fixtures and, for Business Profile,
  partially against a live account. Confirm each panel against a real account
  with the relevant APIs enabled before publishing, and expect Business Profile
  reviews and keywords to need the Google My Business API enabled separately
  from the Business Information and Performance APIs.
