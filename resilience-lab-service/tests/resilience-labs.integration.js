const assert = require('node:assert/strict');

const gateway = process.env.RESILIENCE_GATEWAY_URL || 'http://localhost:8000/api';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function request(path, options) {
  const response = await fetch(gateway + path, options);
  const body = await response.json();
  return { status: response.status, body };
}

async function testRetry() {
  const temporary = await request('/retry-demo?scenario=temporary');
  assert.equal(temporary.status, 200);
  assert.deepEqual(temporary.body.attempts.map(value => value.status), [503, 503, 200]);
  assert.ok(temporary.body.attempts[0].waitMs >= 200 && temporary.body.attempts[0].waitMs <= 300);
  assert.ok(temporary.body.attempts[1].waitMs >= 400 && temporary.body.attempts[1].waitMs <= 500);

  const persistent = await request('/retry-demo?scenario=persistent');
  assert.equal(persistent.status, 503);
  assert.equal(persistent.body.reason, 'ATTEMPTS_EXHAUSTED');
  assert.equal(persistent.body.attempts.length, 3);

  const permanent = await request('/retry-demo?scenario=permanent');
  assert.equal(permanent.status, 400);
  assert.equal(permanent.body.reason, 'PERMANENT_ERROR');
  assert.equal(permanent.body.attempts.length, 1);

  const streamStarted = Date.now();
  const streamed = await fetch(gateway + '/retry-demo/stream?scenario=temporary');
  const reader = streamed.body.getReader();
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  assert.ok(Date.now() - streamStarted < 400, 'first progress event should arrive before retry waits finish');
  let text = new TextDecoder().decode(firstChunk.value);
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += new TextDecoder().decode(chunk.value);
  }
  assert.match(text, /event: progress/);
  assert.match(text, /event: complete/);
  console.log('Retry: temporary, persistent, permanent, real waits, and progressive stream passed');
}

async function testCircuit() {
  let result = await request('/circuit-breaker-demo/reset', { method: 'POST' });
  assert.equal(result.status, 200);
  result = await request('/circuit-breaker-demo?mode=healthy');
  assert.equal(result.status, 200);
  assert.equal(result.body.breaker.state, 'CLOSED');
  assert.equal(result.body.breaker.lastCall.targetContacted, true);

  await request('/circuit-breaker-demo/reset', { method: 'POST' });
  const slow = await request('/circuit-breaker-demo?mode=slow');
  assert.equal(slow.status, 504);
  assert.equal(slow.body.breaker.lastCall.targetContacted, true);
  assert.equal(slow.body.breaker.timedOutRequests, 1);

  await request('/circuit-breaker-demo/reset', { method: 'POST' });
  for (let count = 0; count < 3; count++) {
    result = await request('/circuit-breaker-demo?mode=failing');
    assert.equal(result.status, 502);
  }
  assert.equal(result.body.breaker.state, 'OPEN');
  assert.equal(result.body.breaker.consecutiveFailures, 3);
  const contactsBeforeReject = result.body.breaker.downstreamContacts;
  const rejected = await request('/circuit-breaker-demo?mode=failing');
  assert.equal(rejected.status, 503);
  assert.equal(rejected.body.breaker.lastCall.targetContacted, false);
  assert.equal(rejected.body.breaker.downstreamContacts, contactsBeforeReject);

  const deadline = Date.now() + 12000;
  let status;
  do {
    await sleep(250);
    status = await request('/circuit-breaker-demo/status');
  } while (status.body.breaker.state !== 'HALF_OPEN' && Date.now() < deadline);
  assert.equal(status.body.breaker.state, 'HALF_OPEN');
  const recovered = await request('/circuit-breaker-demo?mode=healthy');
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.breaker.state, 'CLOSED');
  console.log('Circuit: healthy, timeout, OPEN rejection, HALF-OPEN probe, recovery, and reset passed');
}

async function testBulkhead() {
  let result = await request('/bulkhead-demo/reset', { method: 'POST' });
  assert.equal(result.status, 200);
  const runId = Date.now();
  const recommendationCalls = Array.from({ length: 5 }, (_, index) =>
    request(`/bulkhead-demo?pool=recommendation&request=rec-${runId}-${index + 1}`));
  const paymentCall = request(`/bulkhead-demo?pool=payment&request=pay-${runId}`);
  await sleep(350);
  const active = await request('/bulkhead-demo/status');
  assert.equal(active.body.pools.recommendation.occupied, 2);
  assert.equal(active.body.pools.payment.occupied, 1);
  const recommendation = await Promise.all(recommendationCalls);
  const payment = await paymentCall;
  assert.equal(recommendation.filter(value => value.status === 200).length, 2);
  assert.equal(recommendation.filter(value => value.status === 503).length, 3);
  assert.ok(recommendation.filter(value => value.status === 503).every(value => !value.body.downstreamContacted));
  assert.equal(payment.status, 200);
  const final = await request('/bulkhead-demo/status');
  assert.equal(final.body.pools.recommendation.occupied, 0);
  assert.equal(final.body.pools.recommendation.completed, 2);
  assert.equal(final.body.pools.recommendation.rejected, 3);
  assert.equal(final.body.pools.payment.completed, 1);
  console.log('Bulkhead: 2 admitted, 3 rejected, capacity released, and independent payment pool passed');
}

async function testLoadShedding() {
  let result = await request('/load-shedding-demo/reset', { method: 'POST' });
  assert.equal(result.status, 200);
  const runId = Date.now();
  const calls = Array.from({ length: 10 }, (_, index) => request(`/load-shedding-demo?request=burst-${runId}-${index + 1}`));
  await sleep(250);
  const during = await request('/load-shedding-demo/status');
  assert.equal(during.body.safeCapacity, 3);
  assert.equal(during.body.active, 3);
  const results = await Promise.all(calls);
  assert.equal(results.filter(value => value.status === 200).length, 3);
  assert.equal(results.filter(value => value.status === 503).length, 7);
  assert.ok(results.filter(value => value.status === 503).every(value => value.body.executed === false));
  const final = await request('/load-shedding-demo/status');
  assert.equal(final.body.active, 0);
  assert.equal(final.body.completed, 3);
  assert.equal(final.body.shed, 7);
  const recovered = await request(`/load-shedding-demo?request=recovered-${runId}`);
  assert.equal(recovered.status, 200);
  console.log('Load shedding: 3 admitted, 7 shed, capacity released, and later request accepted');
}

async function testRegressions() {
  assert.equal((await fetch('http://localhost:3000/')).status, 200);
  assert.equal((await fetch(gateway + '/orders')).status, 200);
  assert.equal((await fetch(gateway + '/idempotency-lab/runs/not-a-valid-id')).status, 400);
  console.log('Regression: frontend, Saga order route, and Idempotency route reachable');
}

Promise.resolve().then(testRetry).then(testCircuit).then(testBulkhead).then(testLoadShedding).then(testRegressions).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
