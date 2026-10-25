const assert = require('node:assert/strict');

const base = process.env.IDEMPOTENCY_LAB_URL || 'http://localhost:8000/api/idempotency-lab';

async function json(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function run(mode) {
  const start = await json('/runs', 'POST', { mode, startingBalanceCents: 10000 });
  assert.equal(start.status, 201);
  const payment = {
    runId: start.body.runId, logicalPaymentId: start.body.logicalPaymentId,
    idempotencyKey: start.body.idempotencyKey, amountCents: 2000,
    currency: 'PKR', simulateLostResponse: false
  };
  const first = await json('/payments', 'POST', payment);
  assert.equal(first.status, 201);
  assert.equal(first.body.balanceCents, 8000);

  let lostResponse;
  try {
    const response = await fetch(base + '/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payment, simulateLostResponse: true })
    });
    lostResponse = response.status;
  } catch (_) { lostResponse = 'connection closed'; }
  assert.notEqual(lostResponse, 200);
  assert.notEqual(lostResponse, 201);

  const afterLoss = await json('/runs/' + start.body.runId);
  assert.equal(afterLoss.status, 200);
  assert.equal(afterLoss.body.serverSidePaymentEffects, mode === 'protected' ? 1 : 2);
  assert.equal(afterLoss.body.balanceCents, mode === 'protected' ? 8000 : 6000);

  const retry = await json('/payments', 'POST', payment);
  assert.equal(retry.status, mode === 'protected' ? 200 : 201);
  assert.equal(retry.body.deduplicated, mode === 'protected');
  assert.equal(retry.body.balanceCents, mode === 'protected' ? 8000 : 4000);
  if (mode === 'protected') assert.equal(retry.body.transactionId, first.body.transactionId);

  const funded = await json('/runs/' + start.body.runId + '/fund', 'POST', { amountCents: 500 });
  assert.equal(funded.status, 200);
  assert.equal(funded.body.balanceCents, mode === 'protected' ? 8500 : 4500);

  if (mode === 'protected') {
    const conflict = await json('/payments', 'POST', { ...payment, amountCents: 3000 });
    assert.equal(conflict.status, 409);
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => json('/payments', 'POST', payment)));
    assert.ok(concurrent.every(result => result.status === 200 && result.body.deduplicated));
    const final = await json('/runs/' + start.body.runId);
    assert.equal(final.body.serverSidePaymentEffects, 1);
    assert.equal(final.body.balanceCents, 8500);
  }
  console.log(mode + ': successful response, lost response, retry, and balance verified');
}

async function concurrentFirstPayment() {
  const start = await json('/runs', 'POST', { mode: 'protected', startingBalanceCents: 10000 });
  assert.equal(start.status, 201);
  const payment = {
    runId: start.body.runId, logicalPaymentId: start.body.logicalPaymentId,
    idempotencyKey: start.body.idempotencyKey, amountCents: 2000,
    currency: 'PKR', simulateLostResponse: false
  };
  const results = await Promise.all(Array.from({ length: 5 }, () => json('/payments', 'POST', payment)));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 200).length, 4);
  assert.equal(new Set(results.map(result => result.body.transactionId)).size, 1);
  const account = await json('/runs/' + start.body.runId);
  assert.equal(account.body.serverSidePaymentEffects, 1);
  assert.equal(account.body.balanceCents, 8000);
  console.log('protected: five simultaneous first attempts caused one deduction');
}

Promise.resolve().then(() => run('unprotected')).then(() => run('protected'))
  .then(concurrentFirstPayment).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
