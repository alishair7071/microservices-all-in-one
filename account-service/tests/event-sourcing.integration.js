const assert = require('node:assert/strict');

const baseUrl = process.env.ACCOUNT_SERVICE_URL || 'http://localhost:8000/api/accounts';

async function request(path, options) {
  const response = await fetch(baseUrl + path, options);
  const body = await response.json();
  return { status: response.status, body };
}

function commandId(label) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function command(accountId, operation, amountCents, id = commandId(operation)) {
  return request(`/${accountId}/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountCents, commandId: id })
  });
}

function replay(events) {
  return events.reduce((balance, event) => event.type === 'MoneyDeposited' ? balance + event.amountCents
    : event.type === 'MoneyWithdrawn' ? balance - event.amountCents : balance, 0);
}

async function main() {
  const created = await request('/', { method: 'POST' });
  assert.equal(created.status, 201);
  const accountId = created.body.account.accountId;

  assert.equal((await command(accountId, 'deposit', 10000)).status, 201);
  assert.equal((await command(accountId, 'withdraw', 3000)).status, 201);
  assert.equal((await command(accountId, 'deposit', 5000)).status, 201);
  let account = await request(`/${accountId}`);
  assert.equal(account.status, 200);
  assert.equal(account.body.account.balanceCents, 12000);

  let events = await request(`/${accountId}/events`);
  assert.deepEqual(events.body.events.map(event => event.sequence), [1, 2, 3, 4]);
  assert.equal(replay(events.body.events), account.body.account.balanceCents);

  assert.equal((await command(accountId, 'deposit', -1)).status, 400);
  assert.equal((await command(accountId, 'withdraw', 99999999)).status, 400);

  const duplicateId = commandId('duplicate');
  const first = await command(accountId, 'deposit', 250, duplicateId);
  const retry = await command(accountId, 'deposit', 250, duplicateId);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.reused, true);
  events = await request(`/${accountId}/events`);
  assert.equal(events.body.events.filter(event => event.commandId === duplicateId).length, 1);

  const concurrent = await Promise.all(Array.from({ length: 5 }, (_, index) => command(accountId, 'deposit', 100, commandId(`concurrent-${index}`))));
  assert.ok(concurrent.every(result => result.status === 201 || result.status === 409));
  events = await request(`/${accountId}/events`);
  assert.deepEqual(events.body.events.map(event => event.sequence), events.body.events.map((_event, index) => index + 1));
  account = await request(`/${accountId}`);
  assert.equal(replay(events.body.events), account.body.account.balanceCents);

  console.log('Event sourcing: ordered immutable ledger, replayed balance, validation, retry protection, and concurrent sequence safety passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
