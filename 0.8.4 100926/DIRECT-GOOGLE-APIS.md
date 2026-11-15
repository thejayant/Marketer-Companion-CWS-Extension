# Direct Google Ads and Merchant API integration

Version 0.8.5 calls Google directly. It does not use an MCP server, proxy, or
developer-controlled backend.

## Google Ads

- REST API: `https://googleads.googleapis.com/v25/`
- OAuth scope: `https://www.googleapis.com/auth/adwords`
- Optional session setting: manager (`login-customer-id`) customer ID
- Account discovery: `customers:listAccessibleCustomers`
- Reporting: `customers/{customerId}/googleAds:search` with built-in GAQL
  presets. Users cannot submit arbitrary GAQL through the interface.
- The reporting workspace includes 19 views, complete paginated results,
  report-specific filters, account timezone/currency, KPI totals, daily trends,
  period comparisons, sortable tables, and CSV exports. See
  [GOOGLE-ADS-REPORTING.md](GOOGLE-ADS-REPORTING.md) for coverage and validation.

Developer tokens were sunset on 9 September 2026. The extension does not ask
for or send one. API access level is assigned to the Google Cloud project that
owns the OAuth client ID. Confirm that project has the required production
access in Google Cloud Console.

## Merchant Center

- REST API: `https://merchantapi.googleapis.com/`
- OAuth scope: `https://www.googleapis.com/auth/content`
- Account discovery: `GET accounts/v1/accounts`
- Reporting: `POST reports/v1/accounts/{accountId}/reports:search`
- The panel uses Merchant Center Query Language presets for product
  performance, product status, price competitiveness, price insights, best
  sellers, and competitive visibility.

Merchant API must be enabled in the same Google Cloud project as the OAuth
client. Each Merchant account must complete Google's one-time developer
registration and the signed-in user needs the relevant account/report roles.

## Testing

After loading `dist/` as an unpacked extension:

1. Reconnect Google so Chrome grants the two new OAuth scopes.
2. In Settings, enter a manager customer ID only when using an MCC to access
   client accounts. No developer token is required.
3. Open Google Ads, reload accounts, select an account, and run a report.
4. Open Merchant Center, reload accounts, select an account, and run Product
   performance before trying eligibility-dependent market-insight reports.
