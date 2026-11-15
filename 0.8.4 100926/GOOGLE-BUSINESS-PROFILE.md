# Google Business Profile workspace

## Connect

1. Load/reload this folder's `dist/` unpacked extension in `chrome://extensions`.
2. Open Settings and reconnect Google to grant `business.manage`. The scope is
   present in both the Chrome and alternate-account OAuth configurations.
3. Enable Account Management, Business Information and Business Profile
   Performance APIs in the existing approved OAuth Cloud project. Reviews,
   posts and media also require Google My Business API access. Verification
   and action-link diagnostics use their respective APIs.
4. Open Business Profile, reload accounts/locations and select locations.
   Discovery traverses accessible organization/user groups, paginates accounts
   and locations, deduplicates locations and retains usable account routes.
5. Choose a report timezone explicitly. It defaults to the browser's named
   IANA timezone and is labeled as a report timezone, not Google metadata.
6. Save a named client, or map the selected locations to an existing client.
   Mappings are scoped to the Google identity that saved them.

An API key alone does not authorize Business Profile data. Existing Google
sign-in is shared with Ads, GSC, GA4 and Merchant Center. Missing permission,
disabled APIs, account access and quota failures appear as actionable messages.

## Reports

| Section | Included |
| --- | --- |
| Overview | Impressions, website/call clicks, direction requests, daily trend, comparisons and evidence-based decline flags |
| Performance | All supported platform/device impression metrics, optional applicable bookings/menu interactions, daily/weekly/monthly/weekday tables |
| Keywords | Month-by-month search terms, exact or below-threshold counts, paging, brand rules, contains/excludes and monthly/year comparisons |
| Reviews | All paginated review records, rating/reply/comment/text/date filters, unanswered age, distributions, period counts and separate current all-time rating metadata |
| Locations | Sortable portfolio performance and location drill-down |
| Content | Recent posts and media as cards with a thumbnail where one is returned, then the full inventory table, content/status/date filters and individual resource details |

The panel opens on a sticky context bar carrying the account, the current run
summary and a rail across the seven reports. Setup is three labelled steps that
collapse once a report runs and reopen from Edit run. Coverage is stated above
the numbers, complete or partial. KPI tiles carry a sparkline, a direction
caret and the period change; the trend chart has a value axis, gridlines, a
dashed previous-period series and a hover readout of both periods. Report
arrival, the trend line and the inspector animate once, and
prefers-reduced-motion removes all of it rather than substituting anything.

Locations are chosen from a searchable checkbox list with a chip summary of the
current selection; searching or filtering never clears it. Shared filters cover
account/group, location name/store code, category, address region, labels and
open status. Performance thresholds apply to the selected
location cohort, including summary/trend and comparison. Table search affects
rows only. Columns are selectable; every report field remains available.

## Management

Location/review inspectors support:

- Review reply drafts, with a specific review and exact location in the preview.
- Standard update posts and an optional Learn more URL.
- Website, primary phone and description edits; validate-only runs before the
  actual patch, followed by a read-back. Title/category/hours bulk edits are
  not exposed.
- Photo additions from a public HTTPS URL in Additional, Exterior or Interior
  categories. The source image must satisfy Google's media requirements.

Every action requires a preview, authorization checkbox and explicit submit.
Changing the draft invalidates its preview. Submission locks the draft and
prevents duplicate clicks. Writes are not automatically retried on 429/503;
if confirmation fails, refresh before making another attempt. Account identity
is checked at dispatch and between profile validation and mutation. A successful
API response does not guarantee that content is immediately public; moderation
and processing can still apply.

No real Business Profile was modified during development.

## Definitions and integrity

- Call clicks are button clicks, not answered calls or sales. Impressions across
  platforms/devices/dates are not globally deduplicated people.
- Device/platform breakdowns apply to impressions, not invented action segments.
- Daily totals require full requested-day coverage for each metric. Missing
  values render as unavailable; no zero imputation is used. Grouped tables sum
  available daily values, so inspect gaps before using grouped partial data.
- Previous portfolio results require the same location cohort. A failed
  comparison is labeled and cannot produce a percentage for the full portfolio.
- Privacy-threshold keyword values remain `<N`. They are never substituted into
  exact totals. Keyword integers and comparison arithmetic preserve precision.
- Review period filters operate on currently retrievable records and the chosen
  created/updated date. Replies/deletions can change later; there is no immutable
  historical rating warehouse. Portfolio all-time ratings are count-weighted
  averages of API location averages, not exact unrounded historical scores.
- Audit percentages are equal-weight extension checklists, not a Google score.
  Category applicability is a visible heuristic and needs operator review.
- User-defined brand rules are classifications, not Google's old direct/discovery
  query categories. Q&A and legacy photo/post insights are not queried.

## Performance and storage

The UI requests only the active report, with two location workers, per-service
request pacing and bounded retries for reads. A portfolio run shows a progress
bar with the location being fetched, the completed count and any failures, next
to Cancel. Cancel stops further scheduling and discards late responses;
already-issued requests may finish. No permanent background reporting job is
advertised. The most recent report is kept in `chrome.storage.session`, so
reopening the popup restores it with an explicit "run again for current data"
notice instead of refetching the portfolio.

Limits are explicit: 100 selected locations, 24 keyword months, 20,000 records
per location report and bounded discovery/pagination. Exceeding a row/page
limit rejects that location's analytics rather than returning partial totals.
Location failures show partial portfolio coverage.

Business Profile content remains in memory. The last run is held in
`chrome.storage.session`, which is scoped to the signed-in Google identity,
never written to disk and discarded when the browser session ends; runs over
roughly 4 MB are not stored. It is not persisted to existing report caches.
Only user preferences, report timezone and explicit client location mappings
are saved persistently. Sign-out and account switching clear content, remove
the stored run and invalidate pending runs. No external AI service receives reviews.

Optional AI drafting and Pub/Sub push notifications still require separately
configured services. Persistent history and durable bulk CSV/PDF exports are
not enabled: these need a separate GBP content-retention/export design under
[Google's GBP API policies](https://developers.google.com/my-business/content/policies).

## Verification

```text
node --test tests/ads-reporting.test.mjs tests/gbp-reporting.test.mjs \n  tests/net.test.mjs tests/services.test.mjs tests/worker.test.mjs
node build.js
node tests/ads-preview-server.mjs
```

For synthetic full UI testing, open
`http://127.0.0.1:8765/?full=1&surface=popup` or `?full=1` for the sidepanel.
The production UI and API adapter run against synthetic accounts, locations,
reviews, metrics and write responses. These fixtures are excluded from the ZIP.

Live OAuth grants, project approval, category-specific eligibility and actual
GBP responses remain unverified until the extension is reconnected to an
authorized production account. Start with reads; writes affect real public
profiles and should use specifically authorized content.

Development checks passed: 45 automated tests (22 GBP and 23 Ads); all seven
GBP report views rendered in the full popup preview. Synthetic browser checks
covered publishing previews/submission, client mapping, table pagination and
column selection, existing Ads rendering and clearing GBP content on sign-out.
The 320/420 px sidepanel layouts had no document overflow or JavaScript page
exceptions. These checks do not establish live API entitlement or live writes.

## References

- [Daily metrics](https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric)
- [Performance endpoint](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries)
- [Monthly keyword counts](https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list)
- [Location discovery](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list)
- [Reviews](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list)
- [Profile patch and validateOnly](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch)
- [Media creation](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.media/create)
- [Deprecations](https://developers.google.com/my-business/content/sunset-dates)
- [Usage limits](https://developers.google.com/my-business/content/limits)
