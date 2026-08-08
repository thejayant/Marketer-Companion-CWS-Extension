# Chrome Web Store submission — Marketer Companion 0.8.2

Build the package with `node build.js`. It validates first and refuses to package
if anything that causes a rejection is present. Upload `marketer-companion-0.8.2.zip`.

`build.js`, `SUBMISSION.md`, `dist/`, `CHANGELOG-*.txt`, `.claude/` and
`.playwright-cli/` are **not** in the package.

---

## Fixed in this pass

| Issue | Why it mattered |
|---|---|
| `update_url` removed from manifest | The store rejects any package containing it. Hard blocker. |
| Description shortened to 113 chars | Was 150; the limit is 132. Hard blocker. |
| Dev files excluded from the package | `.claude/`, `.playwright-cli/`, changelogs were sitting in the extension folder. |
| Build-time validation added | No `eval`, no `new Function`, no `debugger`, no inline `<script>`, no inline event handlers, no remote script tags, popup/panel stylesheets in sync. |

## Verified clean

- Manifest V3, valid version string, all four icons present and correctly sized.
- No remote code anywhere — the single most common review rejection.
- Every declared permission is actually used in the code.
- No inline scripts or handlers, so nothing fights the CSP.
- The packaged copy was loaded and driven through all eight panels: no console
  errors, no missing assets, no horizontal overflow.

---

## Before you submit — things only you can do

### 1. The extension ID and OAuth (do this first)

The manifest keeps its `key`, which pins the ID to
`lpodioiagjlpncibpgiopfbkpfeffjki`. Your OAuth client's redirect URI is
registered for exactly that ID.

Confirm the store item's ID matches. If it does not, sign-in breaks the moment
you publish, and you will need to update the redirect URI in Google Cloud
Console to `https://<published-id>.chromiumapp.org/`.

### 2. Google OAuth verification

`webmasters.readonly` and `analytics.readonly` are **sensitive scopes**. Your
OAuth consent screen needs Google's verification before the app can be used by
anyone outside your test users — this is separate from the store review and it
is the longest pole. Start it now if you have not.

### 3. Host the privacy policy

`privacy.html` ships inside the package, but the store requires a **publicly
reachable URL** in the dashboard. Put it somewhere permanent and paste the link.

### 4. Listing assets

- Icon 128×128 (already in the package)
- At least one screenshot, 1280×800 or 640×400
- Optional small promo tile 440×280
- Category, language, detailed description

---

## Dashboard answers (ready to paste)

**Single purpose**

> Marketer Companion reports on websites the user already owns. It shows their
> Google Search Console, Google Analytics 4 and CallRail data in one blended
> report, and audits the page they are currently viewing.

**Permission justifications**

- **identity** — Signs the user in to their own Google account so the extension
  can read that account's Search Console and Analytics data. Tokens are issued
  by Google; the extension never handles a password.
- **storage** — Stores the chosen Search Console property, GA4 property,
  CallRail account, saved client workspaces, and a short-lived cache of API
  responses so re-opening a report does not re-query the APIs.
- **activeTab** — Reads the current tab's URL so the extension can pre-fill the
  page to inspect and match it to the right Search Console property. Only on a
  user action.
- **scripting** — On user action, runs a one-off script in the active tab to
  read that page's own title, headings, meta tags, links and structured data
  for the on-page and schema audits. Nothing is injected persistently, and page
  content is analysed in the browser.
- **sidePanel** — Opens the same interface in Chrome's side panel so a report
  stays visible while the user browses.

**Host permission justifications**

- `searchconsole.googleapis.com`, `www.googleapis.com` — Search Console
  performance and URL inspection, plus the userinfo endpoint that identifies
  the signed-in account.
- `analyticsadmin.googleapis.com`, `analyticsdata.googleapis.com` — listing the
  user's GA4 properties and running their reports.
- `oauth2.googleapis.com` — OAuth token exchange, refresh and revocation.
- `api.callrail.com` — call records for the user's own CallRail account, using
  an API key they enter themselves.

**Remote code**

> No. All scripts are in the package. A Google Fonts stylesheet is loaded for
> typography only; it contains no executable code.

**Data usage** — declare that the extension handles website content and
authentication information, is not sold to third parties, is not used for
purposes unrelated to the single purpose, and is not used to determine
creditworthiness.

---

## Optional, not blocking

- **Self-host the font.** `popup.html` and `panel.html` load Plus Jakarta Sans
  from `fonts.googleapis.com`, so every popup open sends the user's IP to
  Google and the UI falls back to a system font offline. Bundling the woff2
  files (Plus Jakarta Sans is OFL, so redistribution is permitted with the
  licence file) removes both problems and lets you drop the two font entries
  from the CSP.
- **Structured Data duplicate buttons.** "Schema Validator" and "Rich Results"
  appear both in the panel header and inside the rendered result card.
- **The privacy policy never uses the word "collect".** Reviewers scan for an
  explicit statement of what is and is not collected; consider adding one
  plainly worded line.
