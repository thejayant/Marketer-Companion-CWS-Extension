# Google Business Profile panel — implementation plan

Prepared 2026-10-02 for Marketer Companion 0.8.4. The reporting workspace and previewed management actions are implemented; see `GOOGLE-BUSINESS-PROFILE.md` for delivered capabilities, setup and limits. Optional provider-backed AI, Pub/Sub notifications and durable export/history remain separate integration decisions.

Confirmed by the user: GBP access belongs to the same Cloud project as the existing Google OAuth connection, and the primary use is multiple client locations. Reuse shared OAuth, request the additional scope, and prioritize portfolio workflows and explicit client mappings.

## 1. Product goal

Add a dedicated Google Business Profile sidebar entry that helps an operator answer:

1. How are my locations performing, and what changed?
2. Which searches bring visibility?
3. Which reviews need attention?
4. Which profile details need correction?
5. Which locations should I investigate first?

Support a single location and a portfolio. Use existing client context to save explicit GBP location mappings; never assume that matching website domains prove a location belongs to a client.

## 2. Verified extension integration points

- `popup.html` is the source for both extension surfaces. `build.js` generates `panel.html`; do not maintain separate markup.
- `popup.js` owns navigation, client selection, connection state, empty states, and account switching. Register GBP in all of these paths.
- `background.js` already owns Google OAuth, token refresh, service error handling, and API requests. Keep GBP requests there.
- Both `manifest.json` and `config.js` currently omit `business.manage`. Both require updates, and existing sessions must obtain the new grant.
- The manifest needs exact GBP API host permissions. Reuse current connection only if the OAuth client's Cloud project has GBP access; otherwise design a separate GBP OAuth connection without replacing Ads/GSC/GA4 credentials.
- Add the new modules to `build.js` shipping and validation lists. Update extension description, privacy details, and integration documentation.

## 3. API capability map

| Capability | API / resource | Plan |
| --- | --- | --- |
| Accounts and groups | Account Management: `accounts.list` | Paginate accounts and accessible organization/user-group children; deduplicate locations while retaining their account routes |
| Locations and profile fields | Business Information: account locations, locations, attributes | Explicit read masks; title, store code, categories, phone, website, hours, service area, supported attributes |
| Daily performance | Performance: `locations.fetchMultiDailyMetricsTimeSeries` | Fetch multiple supported metrics per location per period |
| Search keywords | Performance: monthly keyword impressions | Whole-month controls; all pages; preserve exact counts versus below-threshold values |
| Reviews | Google My Business v4: location reviews | Verified locations only; full pagination for complete analytics |
| Google-suggested changes | Business Information: `locations.getGoogleUpdated` | Display available field differences; never automatically revert changes |
| Posts and media | Google My Business location posts/media resources | Inventory and management only where runtime capability checks succeed; no legacy insights metrics |
| Verification | Verifications API | Read available status in diagnostics; owner-directed verification workflow is a later feature |
| Place action links | Place Actions API | Optional inventory of booking/order/action links where supported |
| Notifications | Notifications API + Cloud Pub/Sub | Later server-backed option, not a browser-only real-time promise |

The first connection screen should report each capability separately: ready, missing scope, API disabled/project not approved, quota unavailable, location not eligible, or access denied. One missing capability must not block unrelated reports.

OAuth uses `https://www.googleapis.com/auth/business.manage`; an API key alone cannot authorize private business data. This scope permits management even if our initial UI exposes only reads, so consent copy must explain the requested access.

## 4. Workspace and visual design

**Visual thesis:** a calm, precise local-business workspace using the extension's dark surfaces and emerald accent, with strong typographic hierarchy and restrained chrome.

**Content plan:** business context and date controls, compact KPI summary, one dominant trend, actionable detail below, then drill-down tables/review inspector.

**Interaction thesis:** quick report transitions, expandable explanations, and a review/profile inspector that preserves the user's table position. Respect reduced motion; use no decorative animation or blocking introduction.

Recommended sections:

| Section | Reports and interactions |
| --- | --- |
| Overview | Visibility, website clicks, call clicks, direction requests; selected-period changes; daily trends; location coverage and freshness |
| Performance | Search versus Maps impressions, desktop versus mobile impressions, daily/weekly/monthly aggregation, weekday patterns, supported bookings/menu interactions |
| Search keywords | Monthly impressions, keyword search, contains/excludes, optional user-defined brand classification, previous-month/year comparisons and emerging terms |
| Reviews | Current average rating/count, reviews created during the period, rating distribution, reply coverage, unanswered reviews and an individual review inspector |
| Profile audit | Category-appropriate completeness checks, website/contact/hours/attributes, service area, available Google changes, verification/access diagnostics |
| Locations | Portfolio table, sortable absolute and percentage changes, missing-data coverage, category/region/label filters, drill-down into a location |
| Content | Capability-gated posts, offers/events, media inventory and place-action links; status/date/type filters |

Wireframe:

```text
Google Business Profile                       Refresh
Account / group       Locations (3 selected)
Report                Date range / Compare
Filters                                            v
Coverage: 3/3 locations · fetched at ...

Impressions     Website clicks    Call clicks    Directions
value / change  value / change    value / change value / change

Daily trend                         Metric selector
[current and previous series with accessible data table]

Needs attention
Unanswered reviews / missing hours / observed declines

Search / columns / export options
Sortable report table → location or review inspector
```

At 320–420 px, controls stack and inspectors open inline or full width. At the existing 800 px popup, use paired controls and a wider trend/table. Tables may scroll horizontally inside their own container; the document must not overflow. Keep filters collapsed initially, show applied-filter counts, preserve focus, and use labeled loading/empty/error states.

## 5. Filters and date controls

- Shared: account/group, selected locations, location name/store code, labels, category, region, open status, date range and comparison.
- Dates: yesterday, last 7/30/90 completed days, this month, last month, YTD and custom. Flag incomplete periods and missing recent data rather than guessing a universal reporting delay.
- Comparisons: previous period, previous year and custom earlier period. Show exact dates and use the same location cohort; display unavailable previous data explicitly.
- Keywords: monthly range, contains/excludes, exact/below-threshold values, optional brand/nonbrand rules. Explain that these rules are user classifications, not Google-provided search categories.
- Reviews: 1–5 stars, replied/unreplied, with/without comment, created date, updated date, text search, location and age of unanswered reviews.
- Profile/content: applicable missing fields, supported change flags, post type/status/event dates, media category.
- Thresholds: metric-specific numerical filters with units and clear semantics; hide unsupported filters.

The Business Information location resource does not provide an Ads-style account timezone. Store a user-confirmed IANA timezone per location or a clearly labeled report timezone. Preserve the API's calendar dates; do not silently shift daily metrics using the browser timezone. For mixed-zone portfolios, show the date convention explicitly. Convert review timestamps for display without changing their stored UTC instants.

## 6. Metric definitions and data integrity

- Impressions are the sum of four platform/device metrics and must be labeled accordingly. They are not globally deduplicated people across devices, platforms, days, or locations.
- Call clicks measure clicks on the call button, not answered calls or phone leads. Website clicks and direction requests are actions, not sales.
- Device/platform breakdown is available for impressions; do not invent device-specific call or website-click breakdowns.
- If displaying action-to-impression ratios, identify them as derived ratios, not conversion rates or a customer funnel.
- Show bookings/menu interactions only where applicable and returned. Exclude deprecated food orders and discontinued messaging/call-history features from primary reporting.
- Search keyword data is monthly, with exact values or privacy thresholds. Render a threshold as `<N`; never replace it with N or treat it as zero. Request individual months when building monthly trends; the range endpoint aggregates across requested months.
- Review API all-time average/count stays separate from selected-period rating/count calculated from retrieved review records. Historical period analysis is based on currently retrievable reviews, not immutable historical snapshots.
- Do not average location averages without valid count weighting; label any portfolio weighted rating and distinguish it from exact fetched-review averages.
- Fetch every page required for complete analytics. Row display pagination is independent of API pagination. Partial data must carry a visible coverage warning and never appear as a complete portfolio total.
- Preserve 64-bit count values safely, and explicitly validate missing versus returned-zero values using the API response contract.
- Trends retain unavailable points as gaps. Percentage changes with a zero previous denominator show an explicit new/no-baseline state.
- Any audit completeness percentage must expose applicable checks and weights, and say it is an extension diagnostic rather than a Google ranking score.

## 7. Actionable insights

Start with transparent rules: unanswered low-rating reviews, applicable profile fields missing, available Google changes, large metric declines over comparable complete periods, and locations with incomplete access/data.

Every insight shows its evidence, dates, affected location, calculation, and next action. Apply sample-size guards and day-of-week comparisons to avoid noisy alerts. A trend change is not proof of its cause.

Later, optional AI can draft review replies or summarize themes when an AI provider is deliberately connected. External processing of review text requires explicit data-flow disclosure. No unconfigured provider, fabricated explanations, automatic posting, or invented customer details.

## 8. Technical modules and request lifecycle

- `gbp-api.js`: host allowlist, resource validation, discovery, capability checks, endpoint adapters, pagination and quota-aware scheduling.
- `gbp-reporting.js`: explicit report schemas, normalization, definitions, totals, comparisons, filters and transparent insight rules.
- `gbp-ui.js`: controls, results, charts, tables, inspectors, state and accessibility.
- `gbp-reporting.css`: scoped styles sharing existing extension tokens.
- `background.js`: authenticated message handlers such as `gbpListAccounts`, `gbpListLocations`, `gbpGetCapabilities`, `gbpRunReport`, `gbpGetProfile` and `gbpListReviews`.
- `popup.js`: mount, navigation, client mapping and sign-in/sign-out/account-switch reset.

Deduplicate identical in-flight reads and load only the active report. Use a small worker pool with per-API rate pacing, bounded exponential backoff and Retry-After support. Concurrency limits alone are not rate limits. Read actual project quotas instead of hardcoding assumptions from published defaults.

For large portfolios, report per-location progress, allow cancellation, and return bounded chunks rather than one huge runtime message. Use run IDs so stale results cannot overwrite a changed selection. Keep durable job control minimal; account for MV3 service-worker suspension and the popup closing. Do not advertise unattended background processing unless implemented and tested.

Keep a normalized resource identity with account routes, location ID, source API, requested range, fetch time and completeness. Do not repurpose an Ads/GA4 cached response as GBP data.

## 9. Storage, exports and management boundaries

Google's GBP content policy has specific temporary storage limits and restrictions on stored aggregation. Default to transient report calculations and limited raw response caching; do not persist normalized aggregate snapshots, historical review warehouses, or content indexes. Enforce expiration no longer than 30 calendar days, purge on disconnect/account changes, and document the chosen shorter cache lifetime. User preferences and client-to-location mappings are separate from cached API content.

CSV/PDF-style report export is a proposed capability, with scope and retention to be checked against GBP terms before release. Do not blindly copy the Ads exporter or promise unrestricted durable bulk review exports. If permitted, include source, date convention, exact/below-threshold distinctions, coverage and formulas; export complete filtered results, not only a visible page.

Management is a separate later phase: review replies, post publishing, selected profile edits and media additions. Show the exact business, proposed content and field changes before each explicit submission. Validate category-specific rules and permissions, then read back the result. Support update masks and `validateOnly` where the endpoint offers it. Never automatically revert Google's changes or initiate verification without an owner-directed action.

Real-time review notifications require a properly secured Pub/Sub receiver/backend; an extension alone cannot reliably receive pushes while closed. Keep this as an optional architecture decision.

## 10. Delivery phases and acceptance criteria

### Phase 1 — connection and location foundation

Add navigation/icon, correct scopes/hosts, capability diagnostics, paginated discovery, client mappings and account reset handling. Acceptance: the approved project discovers the authorized test location, and missing capability errors are actionable.

### Phase 2 — complete reporting workspace

Implement Overview, Performance, Keywords, Reviews and Locations with date comparisons, contextual filters, complete pagination, explicit columns and accessible charts. Acceptance: selected real-account results reconcile with API responses; monthly keywords and daily metrics never share an incorrect grain.

### Phase 3 — audit and evidence-based insights

Implement category-aware profile checks, Google field differences, review triage and capability-gated content inventory. Acceptance: each finding identifies its supporting field or metric and never labels an unsupported field as a defect.

### Phase 4 — approved actions and optional integrations

Add previewed review replies, posts and limited profile edits; finalize export policy; optionally integrate AI and server-backed notifications. Acceptance: no write occurs without an explicit submission, duplicate submissions are prevented, and failures preserve drafts.

### Release gate

- Automated fixtures: pagination past first page, repeated tokens, partial location failures, quota retries, cross-account isolation, threshold keywords, safe counts, date edges, zero baselines, rating calculations and HTML/CSV escaping where applicable.
- Browser QA: 320/420 px sidepanel and 800 px popup, keyboard navigation, reduced motion, long business names, many locations/reviews and inspector focus.
- Regression QA: existing Ads/GSC/GA4/Merchant/CallRail connections and account switching.
- Live read-only QA: user-owned verified location; no GBP sandbox is available. Management tests require specifically approved actions on an authorized location.
- Build: regenerate panel, validate CSP/permissions, exclude fixtures, package ZIP and update setup/privacy documentation.

## 11. Decisions needed before live integration

1. Confirmed: GBP approval is attached to the current OAuth project. No separate GBP OAuth project is planned.
2. Which API capabilities are enabled and have usable quotas?
3. Which Google account and verified location are authorized for live QA?
4. Confirmed: multiple client locations are the main use; prioritize portfolio discovery, coverage and drill-down. Single-location views remain supported.

These decisions affect connection wiring and live validation, not the report/UI design work.

## Official references checked

- [Setup and OAuth](https://developers.google.com/my-business/content/basic-setup)
- [Accounts and groups](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list)
- [Location fields](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations)
- [Daily performance endpoint](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries)
- [Daily metric definitions](https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric)
- [Monthly keywords and thresholds](https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list)
- [Reviews](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list)
- [Google-updated fields](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/getGoogleUpdated)
- [Posts](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts)
- [Media](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.media)
- [Deprecations](https://developers.google.com/my-business/content/sunset-dates)
- [Usage limits](https://developers.google.com/my-business/content/limits)
- [GBP API policies](https://developers.google.com/my-business/content/policies)
