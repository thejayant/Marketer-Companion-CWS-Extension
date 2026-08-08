# Marketer Companion — SEO & Marketing Toolkit

A Chrome extension that blends Google Search Console, Google Analytics 4 and
CallRail into one report, and audits the page you're on.

Designed & built by Jayant.

---

## What it does

| Panel | Source | Notes |
|---|---|---|
| **Blended report** | GSC + GA4 + CallRail | One segment across all three sources, with period-over-period comparison and a daily trend |
| **Performance** | Search Console | Clicks, impressions, CTR, position by query / page / country / device |
| **GA4** | Analytics Data API | 30 dimensions, 18 metrics, key events, CSV export |
| **CallRail** | CallRail API | Call volume, sources, individual records and transcripts |
| **Indexing** | Search Console | URL inspection: coverage, canonical, last crawl, robots |
| **On-page** | Active tab | Title, meta, headings, links, images — no API needed |
| **Structured data** | Active tab | JSON-LD / Microdata / RDFa as readable cards |

### Segments

The blended report describes one slice of traffic at a time, and every source
agrees on which slice that is. Each segment defines itself twice — once for the
GA4 channel group, once for the CallRail call source — so sessions, key events
and calls always describe the same audience.

`Organic search` (default) · `Paid search` · `All paid` · `All organic` ·
`Social` · `Direct` · `Referral` · `All traffic`

Organic search means organic *search*. "Facebook Organic" is organic social and
is deliberately excluded, because counting it against Search Console clicks
would be meaningless.

---

## Build

```bash
node build.js
```

Validates first and refuses to package on anything that causes a Chrome Web
Store rejection: `update_url` in the manifest, an over-length description or
name, an invalid version, `eval`, `new Function`, `debugger`, inline
`<script>`, inline event handlers, remote script tags, or `popup.html` and
`panel.html` drifting apart.

It then copies only the 13 files the extension actually loads into `dist/` and
zips them, so local tooling, changelogs and this README never ship.

## Load it locally

1. `node build.js`
2. `chrome://extensions` → enable Developer mode
3. **Load unpacked** → select `dist/`

---

## Layout

```
manifest.json      MV3 manifest
background.js      Service worker: OAuth, GSC, GA4, CallRail, caching
popup.js           All UI logic, shared by both surfaces
popup.html         Action popup
panel.html         Side panel — identical markup apart from data-mode
config.js          OAuth client IDs
privacy.html       Privacy policy
build.js           Validating packager
```

`popup.html` and `panel.html` must keep identical stylesheets; the build fails
if they drift.

---

## Configuration

`config.js` holds the OAuth client IDs. `CLIENT_SECRET` is intentionally empty:

- **blank** — the alternate-account flow uses the implicit flow with silent
  `prompt=none` renewal, so no secret ships inside the package.
- **set** — it switches to authorisation code + PKCE with refresh tokens. Only
  do this if the secret is not distributed, since anything in the package is
  extractable.

The OAuth client must allow `chrome.identity.getRedirectURL()` for the
installed extension ID, or sign-in fails with `redirect_uri_mismatch`.

---

## Privacy

There is no developer server. Data travels between the browser and Google's and
CallRail's own APIs. Google tokens are handled by Chrome's identity service or
stored locally; the CallRail API key is kept only for the current browser
session. No analytics, advertising, error reporting or profiling.

Full policy in `privacy.html`.

---

## Documentation

- `SUBMISSION.md` — Chrome Web Store checklist and dashboard answers
- `STORE-LISTING-0.8.2.txt` — store listing copy
- `CHANGELOG-0.8.2.txt` — current release notes

---

## Licence

No licence is granted. All rights reserved. The source is published for
transparency; it is not offered for reuse or redistribution.
