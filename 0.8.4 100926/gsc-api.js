// Search Console reporting.
//
// `request(url, options)` is supplied by the service worker and owns the access
// token, the scheduler and the HTTP error shaping; it returns parsed JSON. The
// query building and the impression-weighted fallback live here so they can be
// tested without a signed-in browser.

export function normalizeGscDataState(value){
  return value === "all" ? "all" : "final";
}

// Whether a Search Console property covers a page URL. Domain properties match
// the host and its subdomains; URL-prefix properties match by prefix.
export function covers(siteUrl, pageUrl){
  try{
    if(siteUrl.startsWith("sc-domain:")){
      const domain = siteUrl.split(":")[1];
      const u = new URL(pageUrl);
      return u.hostname === domain || u.hostname.endsWith("."+domain);
    }
    return pageUrl.startsWith(siteUrl);
  }catch{ return false; }
}

export function buildSearchAnalyticsBody({ pageUrl, startDate, endDate, pageOnly = true, dimensions = null, rowLimit = null, aggregationType = null, dataState = "final" }){
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

  return { body, hasDimensions };
}

// Average position must be impression-weighted, the way Search Console computes
// it. A plain mean over days lets a day with 4 impressions count as much as a
// day with 40,000, and the number then fails to reconcile with the UI.
export function weightedTotals(rows){
  const sums = rows.reduce((acc, r) => {
    const impressions = Number(r.impressions || 0);
    acc.clicks += Number(r.clicks || 0);
    acc.impressions += impressions;
    if (typeof r.position === "number" && impressions > 0){
      acc.weightedPosition += r.position * impressions;
      acc.positionImpressions += impressions;
    }
    return acc;
  }, { clicks:0, impressions:0, weightedPosition:0, positionImpressions:0 });
  return {
    clicks: sums.clicks,
    impressions: sums.impressions,
    ctr: sums.impressions ? (sums.clicks / sums.impressions) : 0,
    position: sums.positionImpressions ? (sums.weightedPosition / sums.positionImpressions) : 0
  };
}

export function createGscApi({ request }) {
  async function listSites(){
    const data = await request("https://www.googleapis.com/webmasters/v3/sites", { retry: true });
    return data?.siteEntry || [];
  }

  async function inspect(siteUrl, pageUrl){
    return await request("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      retry: true,
      method: "POST",
      body: JSON.stringify({ inspectionUrl: pageUrl, siteUrl })
    });
  }

  async function searchAnalytics(siteUrl, pageUrl, startDate, endDate, pageOnly = true, dimensions = null, rowLimit = null, aggregationType = null, dataState = "final"){
    const { body, hasDimensions } = buildSearchAnalyticsBody({ pageUrl, startDate, endDate, pageOnly, dimensions, rowLimit, aggregationType, dataState });
    const url = "https://www.googleapis.com/webmasters/v3/sites/" + encodeURIComponent(siteUrl) + "/searchAnalytics/query";
    const data = await request(url, { method: "POST", body: JSON.stringify(body), retry: true });

    // A property-level query can come back empty even when the days have data,
    // so fall back to a by-date query and total it correctly.
    if (!hasDimensions && (!data.rows || data.rows.length === 0)) {
      const byDateBody = { ...body, dimensions: ["date"], rowLimit: 1000 };
      const second = await request(url, { method: "POST", body: JSON.stringify(byDateBody), retry: true });
      if (Array.isArray(second.rows) && second.rows.length) {
        data.rows = [weightedTotals(second.rows)];
      }
    }
    return data;
  }

  return { listSites, inspect, searchAnalytics };
}
