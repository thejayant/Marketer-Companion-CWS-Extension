// Shared request scheduler.
//
// Every service used to carry its own retry loop: Business Profile retried
// 429/503 twice with Retry-After, Google Ads retried but gave up on any delay
// over two seconds, and Search Console, Analytics and CallRail did not retry at
// all - a single 429 went straight to the user. This is the one place that
// decides how a request is paced and when it is tried again.
//
// Two rules are deliberate and must not be relaxed:
//
//   1. A write is never retried. A retried review reply or post can publish
//      twice, and a confirmation we failed to read is not proof it failed.
//   2. A Retry-After longer than the ceiling is honoured by giving up, not by
//      sleeping. The caller is told how long Google asked for and decides.

export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function createScheduler({
  pace = 0,
  attempts = 3,
  maxDelay = 5000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const lanes = new Map();

  // Requests in the same lane START in order, `pace` apart, so a loop over
  // locations or pages cannot burst into its own rate limit. The work itself
  // still overlaps: the Business Profile portfolio run keeps two locations in
  // flight, and serialising here would halve it.
  async function slot(lane) {
    const prior = lanes.get(lane) || Promise.resolve();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    lanes.set(lane, held);
    await prior;
    if (pace) await sleep(pace);
    release();
  }

  function delayFor(error, attempt) {
    const asked = Number(error && error.retryAfterSeconds) * 1000;
    if (Number.isFinite(asked) && asked > 0) return asked;
    return 500 * 2 ** attempt;
  }

  async function run(lane, work, { retry = true } = {}) {
    for (let attempt = 0; ; attempt++) {
      await slot(lane);
      try {
        return await work(attempt);
      } catch (error) {
        const status = error && error.httpStatus;
        const last = attempt >= attempts - 1;
        if (!retry || last || !RETRYABLE_STATUS.has(status)) throw error;
        const delay = delayFor(error, attempt);
        if (delay > maxDelay) throw error;
        await sleep(delay);
      }
    }
  }

  return { run };
}
