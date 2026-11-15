// Google Analytics 4 reporting.
//
// `request(url, options)` is supplied by the service worker and owns the access
// token, the scheduler, the scope retry and the HTTP error shaping; it returns
// parsed JSON. Pagination, the account batching and the report body live here
// so they can be tested without a signed-in browser.
//
// The tab-sniffing helpers that detect a measurement ID stay in the service
// worker: they need chrome.scripting and a real tab, so there is nothing to
// gain by moving them.

export const GA_PAGE_GUARD = 25;
// Accounts are fetched in parallel batches; sequential requests over a large
// agency estate took long enough that the popup looked hung.
export const GA_ACCOUNT_BATCH = 6;

const DEFAULT_METRICS = ["activeUsers", "sessions", "screenPageViews", "eventCount"];

export function buildRunReportBody({ startDate, endDate, dimension, dimensions, metrics, inListFilter, rowLimit, orderByMetric }){
  const metricNames = Array.isArray(metrics) && metrics.length ? metrics : DEFAULT_METRICS;
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
        inListFilter: { values: inListFilter.values, caseSensitive: false }
      }
    };
  }
  if (Number.isFinite(Number(rowLimit)) && Number(rowLimit) > 0){
    body.limit = String(Math.floor(Number(rowLimit)));
  }
  if (orderByMetric){
    body.orderBys = [{ metric: { metricName: orderByMetric }, desc: true }];
  }
  return body;
}

export function normalizeKeyEvents(items){
  return items
    .map(item => ({
      eventName: item.eventName || (item.name || "").split("/").pop() || "",
      custom: !!item.custom,
      countingMethod: item.countingMethod || "",
      createTime: item.createTime || ""
    }))
    .filter(item => item.eventName)
    .sort((a, b) => a.eventName.localeCompare(b.eventName));
}

export function createGaApi({ request }) {
  // Google paginates both accounts and properties. Without following
  // nextPageToken an agency past one page silently loses the tail with no
  // error, which looks identical to "the property does not exist".
  async function pagedList(buildUrl, collectionKey){
    const items = [];
    let pageToken = "";
    let pages = 0;
    do {
      const url = buildUrl();
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const json = await request(url.toString(), { retry: true });
      items.push(...(json?.[collectionKey] || []));
      pageToken = json?.nextPageToken || "";
    } while (pageToken && ++pages < GA_PAGE_GUARD);
    return items;
  }

  async function listProperties(){
    const accounts = await pagedList(() => {
      const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accounts");
      url.searchParams.set("pageSize", "200");
      return url;
    }, "accounts");

    const list = [];
    for (let index = 0; index < accounts.length; index += GA_ACCOUNT_BATCH){
      const batch = accounts.slice(index, index + GA_ACCOUNT_BATCH);
      const results = await Promise.all(batch.map(async account => {
        const properties = await pagedList(() => {
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
    list.sort((x, y) => (x.account + x.displayName).localeCompare(y.account + y.displayName));
    return list;
  }

  async function listKeyEvents(propertyId){
    const items = [];
    let pageToken = "";
    do {
      const url = new URL(`https://analyticsadmin.googleapis.com/v1alpha/properties/${propertyId}/keyEvents`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await request(url.toString(), { retry: true });
      items.push(...(data.keyEvents || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return normalizeKeyEvents(items);
  }

  async function listWebStreams(propertyId){
    return await request(`https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/webDataStreams`, { retry: true });
  }

  async function runReport(propertyId, startDate, endDate, dimension, dimensions, metrics, inListFilter, rowLimit, orderByMetric){
    const body = buildRunReportBody({ startDate, endDate, dimension, dimensions, metrics, inListFilter, rowLimit, orderByMetric });
    return await request(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: "POST",
      body: JSON.stringify(body),
      retry: true
    });
  }

  return { pagedList, listProperties, listKeyEvents, listWebStreams, runReport };
}
