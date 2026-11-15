// CallRail reporting.
//
// The service worker supplies `request(path, params)`, which owns the API key,
// the scheduler and the HTTP error shaping. Everything here - pagination, the
// field lists, the voicemail second pass, the transcript states - is plain data
// handling, so it runs under `node --test` without a browser.

// CallRail pages at 100 records by default. Agencies routinely exceed that on
// companies, so both list endpoints follow the page counter to the end.
export const CALLRAIL_PAGE_GUARD = 25;
export const CALLRAIL_PAGE_SIZE = 250;

const CALL_FIELDS = 'id,customer_name,customer_phone_number,customer_city,customer_state,source,source_name,campaign,keywords,landing_page_url,referring_url,duration,formatted_duration,answered,first_call,lead_status,recording,recording_player,tracking_phone_number,start_time,device_type,note,tags';
const CALL_DETAIL_FIELDS = `${CALL_FIELDS},transcription,call_summary,call_highlights`;

export function createCallrailApi({ request }) {
  async function pagedList(path, collectionKey, params = {}){
    const items = [];
    let page = 1;
    for (;;){
      const data = await request(path, Object.assign({}, params, { page, per_page: CALLRAIL_PAGE_SIZE }));
      const batch = data?.[collectionKey] || [];
      items.push(...batch);
      const total = Number(data?.total_records ?? NaN);
      const done = !batch.length
        || (Number.isFinite(total) && items.length >= total)
        || batch.length < CALLRAIL_PAGE_SIZE
        || page >= CALLRAIL_PAGE_GUARD;
      if (done) break;
      page += 1;
    }
    return items;
  }

  async function listAccounts(){
    return { accounts: await pagedList('/a.json', 'accounts', { fields: 'numeric_id' }) };
  }

  async function listCompanies(accountId){
    return { companies: await pagedList(`/a/${accountId}/companies.json`, 'companies') };
  }

  async function listCalls({ accountId, companyId, start_date, end_date, source, device, lead_status, answered, limit=100 }){
    const params = {
      start_date,
      end_date,
      company_id: companyId,
      fields: CALL_FIELDS,
      sort: 'start_time',
      order: 'desc',
      per_page: Math.min(CALLRAIL_PAGE_SIZE, Math.max(1, Number(limit) || 100)),
      page: 1
    };
    if (source) params.source_name = source;
    if (device && device !== 'all') params.device = device;
    if (lead_status) params.lead_status = lead_status;
    if (answered === 'true' || answered === 'false') params.answered = answered;

    const data = await request(`/a/${accountId}/calls.json`, params);
    return {
      calls: data?.calls || [],
      total: Number(data?.total_records ?? (data?.calls || []).length)
    };
  }

  async function callDetail({ accountId, callId }){
    if (!accountId || !callId) throw new Error('CallRail: a call id is required.');
    const call = await request(`/a/${accountId}/calls/${encodeURIComponent(callId)}.json`, { fields: CALL_DETAIL_FIELDS });

    // Transcription is a paid add-on. When it is not on the plan CallRail simply
    // omits the field rather than erroring, so surface that as a state instead of
    // rendering an empty panel the user cannot explain.
    let transcript = null;
    let transcriptState = 'unavailable';
    const raw = call?.transcription;
    if (raw && typeof raw === 'object' && Array.isArray(raw.lines)){
      transcript = raw.lines.map(line => ({
        role: line?.role || line?.speaker || '',
        text: line?.text || '',
        startTime: line?.start_time ?? null
      })).filter(line => line.text);
      transcriptState = transcript.length ? 'ready' : 'empty';
    } else if (typeof raw === 'string' && raw.trim()){
      transcript = [{ role:'', text: raw.trim(), startTime: null }];
      transcriptState = 'ready';
    }

    return {
      call,
      transcript,
      transcriptState,
      summary: call?.call_summary || null,
      highlights: Array.isArray(call?.call_highlights) ? call.call_highlights : []
    };
  }

  async function callSummary({ accountId, companyId, start_date, end_date, group_by, device, lead_status, first_time_callers, min_duration, max_duration, companyName, groupByLabel, include_voicemails=false }){
    const baseParams = {
      group_by,
      fields: 'total_calls,missed_calls,answered_calls,first_time_callers,average_duration,formatted_average_duration',
      start_date,
      end_date,
      company_id: companyId,
      device: device && device !== 'all' ? device : '',
      lead_status,
      first_time_callers,
      min_duration,
      max_duration,
      answer_status: 'all'
    };

    const base = await request(`/a/${accountId}/calls/summary.json`, baseParams);

    const vmMap = new Map();
    if (include_voicemails === true){
      const vm = await request(`/a/${accountId}/calls/summary.json`, {
        ...baseParams,
        fields: 'total_calls',
        answer_status: 'voicemail'
      });
      (vm?.grouped_results || []).forEach(r => vmMap.set(String(r.key), Number(r.total_calls || 0)));
    }

    const rows = (base?.grouped_results || []).map(r => {
      const total = Number(r.total_calls || 0);
      const first = Number(r.first_time_callers || 0);
      const voicemails = vmMap.get(String(r.key)) || 0;
      return {
        key: r.key,
        total_calls: total,
        answered_calls: Number(r.answered_calls || 0),
        missed_calls: Number(r.missed_calls || 0),
        voicemails,
        first_time_callers: first,
        returning_callers: Math.max(0, total - first),
        average_duration: r.average_duration,
        formatted_average_duration: r.formatted_average_duration
      };
    }).sort((a,b) => (b.total_calls||0) - (a.total_calls||0));

    return {
      meta: {
        start: start_date,
        end: end_date,
        groupBy: group_by,
        groupByLabel: groupByLabel || group_by,
        companyId: companyId || '',
        companyName: companyName || '',
        includesVoicemails: include_voicemails === true,
        total_results: base?.total_results || null
      },
      rows
    };
  }

  return { pagedList, listAccounts, listCompanies, listCalls, callDetail, callSummary };
}
