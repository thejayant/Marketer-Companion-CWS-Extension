import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, RETRYABLE_STATUS } from '../net.js';

const fail = (status, extra = {}) => Object.assign(new Error(`HTTP ${status}`), { httpStatus: status, ...extra });

test('a read is retried on a transient status and the result is returned', async () => {
  const slept = [];
  const scheduler = createScheduler({ sleep: async ms => { slept.push(ms); } });
  let calls = 0;
  const value = await scheduler.run('ga', async () => {
    calls++;
    if (calls < 3) throw fail(503);
    return 'ok';
  });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(slept, [500, 1000]);
});

test('a write is never retried, however transient the failure looks', async () => {
  const scheduler = createScheduler({ sleep: async () => {} });
  let calls = 0;
  await assert.rejects(() => scheduler.run('gbp', async () => { calls++; throw fail(503); }, { retry: false }), /HTTP 503/);
  assert.equal(calls, 1, 'a retried write can publish the same reply twice');
});

test('Retry-After is honoured, and one longer than the ceiling gives up instead of sleeping', async () => {
  const slept = [];
  const scheduler = createScheduler({ sleep: async ms => { slept.push(ms); }, maxDelay: 5000 });
  let calls = 0;
  await scheduler.run('ads', async () => { if (++calls < 2) throw fail(429, { retryAfterSeconds: 2 }); return 'ok'; });
  assert.deepEqual(slept, [2000], 'the delay Google asked for, not the backoff curve');

  let long = 0;
  await assert.rejects(
    () => scheduler.run('ads', async () => { long++; throw fail(429, { retryAfterSeconds: 900 }); }),
    /HTTP 429/
  );
  assert.equal(long, 1);
  assert.deepEqual(slept, [2000], 'a 15 minute Retry-After is reported, never slept through');
});

test('a status that is not transient is not retried', async () => {
  const scheduler = createScheduler({ sleep: async () => {} });
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    await assert.rejects(() => scheduler.run('gsc', async () => { calls++; throw fail(status); }));
    assert.equal(calls, 1, `${status} is the caller's problem, not a transient one`);
  }
  assert.ok(RETRYABLE_STATUS.has(429) && RETRYABLE_STATUS.has(503) && !RETRYABLE_STATUS.has(403));
});

test('attempts are bounded', async () => {
  const scheduler = createScheduler({ sleep: async () => {}, attempts: 3 });
  let calls = 0;
  await assert.rejects(() => scheduler.run('gsc', async () => { calls++; throw fail(429); }));
  assert.equal(calls, 3);
});

test('a lane paces starts in order without serialising the work', async () => {
  const order = [];
  const paces = [];
  const scheduler = createScheduler({ pace: 10, sleep: async ms => { paces.push(ms); } });
  const slow = scheduler.run('a', async () => { order.push('a1-start'); await new Promise(r => setTimeout(r, 30)); order.push('a1-end'); return 1; });
  const next = scheduler.run('a', async () => { order.push('a2-start'); return 2; });
  const other = scheduler.run('b', async () => { order.push('b1'); return 3; });
  assert.deepEqual(await Promise.all([slow, next, other]), [1, 2, 3]);
  assert.ok(order.indexOf('a1-start') < order.indexOf('a2-start'), 'starts in the order they were queued');
  assert.ok(order.indexOf('a2-start') < order.indexOf('a1-end'), 'a slow request does not block the next one: the portfolio workers stay parallel');
  assert.ok(paces.every(ms => ms === 10), 'each start in a paced lane waits the pace');
  assert.ok(order.indexOf('b1') < order.indexOf('a1-end'), 'a different lane is not held up');
});

test('the attempt number is passed to the work, so a caller can vary the request', async () => {
  const scheduler = createScheduler({ sleep: async () => {} });
  const seen = [];
  await scheduler.run('ga', async attempt => { seen.push(attempt); if (attempt < 2) throw fail(500); return 'ok'; });
  assert.deepEqual(seen, [0, 1, 2]);
});
