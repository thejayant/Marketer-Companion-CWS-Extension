# Google Ads reporting workspace

Implemented in `0.8.4 100926`. Source: `popup.html`; the build generates
`panel.html` and packages the same reporting modules for both surfaces.

## Reports

19 report views: account overview, campaign performance and efficiency,
ad groups, ads, keywords, Search search terms, Performance Max search terms,
ad assets, campaign conversions, conversion actions, devices, networks,
physical-location countries, day/hour, landing pages, Performance Max asset
groups, Performance Max channels, and Shopping/Performance Max products.

Columns are defined explicitly in `ads-reporting.js`. All supported metrics
remain available in the column picker and CSV; there is no ten-column cap.
Tables render 25/50/100 rows per page to keep the extension responsive.

## Filters and comparisons

- Multiple campaigns and ad groups; name search; campaign/ad group status;
  campaign type; device/network; keyword match/text; search-term inclusion
  and exclusion; country; conversion actions; product ID/brand/type/label 0.
- Up to five metric conditions. Currency amounts use account currency;
  CTR and conversion rate conditions use percentage input (10 means 10%).
- Yesterday, 7/30/90 days, this month, last month, year to date, custom dates.
  Dates and schedules use the account timezone. Month/YTD presets include
  today and show an incomplete-data notice.
- Previous period, previous year, or a custom earlier period. Without metric
  conditions, previous-only activity remains in comparison totals. With
  metric conditions, the current-period selected entities define the cohort;
  conditions are not reapplied to the previous period.
- Unsupported controls are hidden. Incompatible metric conditions are removed
  when changing reports. Changing a selection marks the existing result stale.

## Completeness and metric semantics

- Reporting follows every `nextPageToken`, without `LIMIT 250`.
- A 100,000 daily-row / 100-page guard fails explicitly before returning
  partial totals. Narrow the date range or select campaigns to reduce volume.
- Period rows are aggregated from complete daily data. Totals and daily
  trends use the same selected rows; browser table search/paging does not
  change KPI totals. CSV exports all matching table rows, with all columns.
- CTR = clicks / impressions; CPC = spend / clicks; CPA = spend / conversions;
  ROAS = conversion value / spend. CVR uses interactions, not a sum or average
  of daily rates. Zero denominators are shown as unavailable.
- Shopping product reporting does not expose interactions, so it omits CVR.
  Conversion-action reporting omits incompatible spend/click/CPA columns.
- Search-term privacy thresholds, product-report coverage, and overlapping
  asset attribution remain Google reporting limitations. Asset totals are
  explicitly labeled as asset-row totals rather than account totals.
- Search impression-share diagnostics are queried for the complete period;
  daily shares are not averaged. Budgets and ad/keyword diagnostics describe
  their current state, even for historical date ranges.
- Manager discovery includes all hierarchy levels and preserves the manager
  login route for each client. Managers are disabled in the report selector.

## Verification

Run `node --test tests/ads-reporting.test.mjs`, then `node build.js`.
The tests cover pagination beyond 250 rows, complete totals, weighted rates,
date/timezone boundaries, comparison cohorts, malformed inputs, nested MCC
discovery, CSV escaping, and report-field compatibility.

`tests/ads-reference.json` contains field names checked against Google's
official v25 resource references on 2026-10-02. These static checks cannot
prove every account-specific query combination or production entitlement.

For a browser preview, run `node tests/ads-preview-server.mjs` and open
`http://127.0.0.1:8765/`. Add `?surface=popup` for the popup; add `&full=1`
to exercise the actual popup initialization/navigation with Chrome stubs.
All preview accounts and results are synthetic. Tests and preview files are
excluded from `dist/` and the ZIP.

After loading `dist/` as an unpacked extension, reconnect Google if needed,
reload accounts, select a client, and run each report against the real account.
Check API access in the Cloud project that owns the OAuth client. Live Google
Ads requests have not been verified in the local synthetic preview.

## Google references

- [Reporting fields v25](https://developers.google.com/google-ads/api/fields/v25/overview)
- [Pagination](https://developers.google.com/google-ads/api/docs/reporting/paging)
- [Account hierarchy](https://developers.google.com/google-ads/api/docs/account-management/get-account-hierarchy)
- [Conversion reporting](https://developers.google.com/google-ads/api/docs/conversions/reporting)
- [Performance Max search terms](https://developers.google.com/google-ads/api/performance-max/campaign-criterion-reporting)
- [Developer-token migration](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
