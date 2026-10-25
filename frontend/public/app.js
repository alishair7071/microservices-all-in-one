// HTML elements we update from JavaScript.
const productsList = document.querySelector('#products');
const productSelect = document.querySelector('#product-id');
const ordersList = document.querySelector('#orders');
const message = document.querySelector('#message');
const sagaTimeline = document.querySelector('#saga-timeline');
const gatewayTestResult = document.querySelector('#gateway-test-result');
const circuitBreakerResult = document.querySelector('#circuit-breaker-result');
const retryDemoResult = document.querySelector('#retry-demo-result');
const bulkheadDemoResult = document.querySelector('#bulkhead-demo-result');
const loadSheddingResult = document.querySelector('#load-shedding-result');
const otelTraceResult = document.querySelector('#otel-trace-result');
const eventAccountSelect = document.querySelector('#event-account-select');
const eventAccountAmount = document.querySelector('#event-account-amount');
const eventAccountMessage = document.querySelector('#event-account-message');
const eventAccountSummary = document.querySelector('#event-account-summary');
const eventAccountHistory = document.querySelector('#event-account-history');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function emptyState(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function updateMetric(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function displayValue(value) {
  return value === undefined || value === null || value === '' ? '—' : escapeHtml(value);
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return escapeHtml(timestamp);
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// Show a green success message or a red error message below the order form.
function showMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? 'message error' : 'message';
}

function showGatewayTestResult(title, detail, isError = false) {
  gatewayTestResult.innerHTML = `
    <div class="gateway-result ${isError ? 'error' : ''}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;
}

const retryRun = { events: [], result: null, source: null };
function renderRetryTimeline() {
  const attempts = retryRun.events.filter(event => event.type === 'attempt-finished');
  const waits = retryRun.events.filter(event => event.type === 'waiting');
  const items = [];
  attempts.forEach((attempt, index) => {
    const successful = attempt.status >= 200 && attempt.status < 300;
    items.push(`<div class="retry-step ${successful ? 'success' : 'failure'}"><span class="step-number">${attempt.number}</span><div><strong>Attempt ${attempt.number} → HTTP ${escapeHtml(attempt.status)}</strong><p>${escapeHtml(attempt.message)} · target call ${attempt.durationMs} ms</p></div></div>`);
    const wait = waits.find(value => value.afterAttempt === attempt.number);
    if (wait) items.push(`<div class="retry-wait"><span>↓</span><strong>Wait ${wait.waitMs} ms</strong><small>${wait.baseBackoffMs} ms backoff + ${wait.jitterMs} ms jitter</small></div>`);
    if (index === attempts.length - 1 && retryRun.result) {
      items.push(`<div class="retry-outcome ${retryRun.result.success ? 'success' : 'failure'}"><strong>${retryRun.result.success ? '✓ Success' : '✕ Stopped'}</strong><span>${escapeHtml(retryRun.result.message)}</span><small>${retryRun.result.attempts.length}/${retryRun.result.maxAttempts} attempts · ${retryRun.result.elapsedMs} ms elapsed · ${retryRun.result.reason}</small></div>`);
    }
  });
  if (!items.length) items.push('<div class="retry-step processing"><span class="step-number">…</span><div><strong>Starting attempt 1</strong><p>Waiting for genuine execution progress.</p></div></div>');
  retryDemoResult.innerHTML = items.join('');
}

function runRetryDemo() {
  const button = document.querySelector('#send-retry-request');
  if (retryRun.source) return;
  retryRun.events = [];
  retryRun.result = null;
  button.disabled = true;
  renderRetryTimeline();
  const scenario = document.querySelector('#retry-scenario').value;
  const source = new EventSource(`http://localhost:8000/api/retry-demo/stream?scenario=${encodeURIComponent(scenario)}`);
  retryRun.source = source;
  source.addEventListener('progress', event => {
    retryRun.events.push(JSON.parse(event.data));
    renderRetryTimeline();
  });
  source.addEventListener('complete', event => {
    retryRun.result = JSON.parse(event.data);
    renderRetryTimeline();
    source.close();
    retryRun.source = null;
    button.disabled = false;
  });
  source.addEventListener('failed', event => {
    retryRun.result = { success: false, reason: 'STREAM_FAILED', message: JSON.parse(event.data).message,
      attempts: [], maxAttempts: 3, elapsedMs: 0 };
    renderRetryTimeline();
    source.close();
    retryRun.source = null;
    button.disabled = false;
  });
  source.onerror = () => {
    if (retryRun.source !== source) return;
    retryDemoResult.innerHTML = '<div class="gateway-result error"><strong>Progress stream disconnected.</strong><span>No outcome was invented; run the experiment again.</span></div>';
    source.close();
    retryRun.source = null;
    button.disabled = false;
  };
}

const circuitUi = { pollTimer: null, autoProbe: false, probeStarted: false };
function setCircuitBusy(busy) {
  ['send-circuit-request', 'trigger-circuit-failures', 'restore-circuit-target', 'reset-circuit-demo'].forEach(id => {
    document.getElementById(id).disabled = busy;
  });
}
function renderCircuitStatus(breaker, message, isError = false) {
  if (!breaker) return;
  document.querySelectorAll('[data-circuit-state]').forEach(node => {
    node.classList.toggle('active', node.dataset.circuitState === breaker.state);
  });
  const values = { 'circuit-total': breaker.totalRequests, 'circuit-success': breaker.successfulRequests,
    'circuit-failed': breaker.failedRequests, 'circuit-timeouts': breaker.timedOutRequests,
    'circuit-rejected': breaker.rejectedRequests, 'circuit-contacts': breaker.downstreamContacts };
  Object.entries(values).forEach(([id, value]) => { document.getElementById(id).textContent = value ?? 0; });
  const lastCall = breaker.lastCall;
  const contact = lastCall ? (lastCall.targetContacted ? 'Yes — target was contacted' : 'No — rejected before target') : 'No protected request yet';
  const nextProbe = breaker.nextProbeAt ? Math.max(0, Math.ceil((new Date(breaker.nextProbeAt).getTime() - Date.now()) / 1000)) : null;
  circuitBreakerResult.innerHTML = `<div class="gateway-result ${isError ? 'error' : ''}"><strong>Actual state: ${escapeHtml(breaker.state.replace('_', '-'))}</strong><span>${escapeHtml(message || breaker.lastEvent)}</span><span><b>Last breaker event:</b> ${escapeHtml(breaker.lastEvent)}</span><span><b>Downstream contacted for last call:</b> ${escapeHtml(contact)}</span>${nextProbe === null ? '' : `<span><b>HALF-OPEN eligibility in:</b> about ${nextProbe} seconds</span>`}</div>`;
}
async function readCircuitStatus() {
  const response = await fetch('http://localhost:8000/api/circuit-breaker-demo/status', { cache: 'no-store' });
  const data = await response.json();
  renderCircuitStatus(data.breaker);
  if (circuitUi.autoProbe && data.breaker.state === 'HALF_OPEN' && !circuitUi.probeStarted) {
    circuitUi.probeStarted = true;
    document.getElementById('circuit-message').textContent = 'HALF-OPEN reached. Sending the single recovered dependency probe now…';
    await sendCircuitRequest('recovered', true);
    circuitUi.autoProbe = false;
  }
  return data.breaker;
}
function startCircuitPolling() {
  if (circuitUi.pollTimer) clearInterval(circuitUi.pollTimer);
  circuitUi.pollTimer = setInterval(() => readCircuitStatus().catch(() => {}), 500);
  setTimeout(() => { if (circuitUi.pollTimer) clearInterval(circuitUi.pollTimer); circuitUi.pollTimer = null; }, 20000);
}
async function sendCircuitRequest(forcedMode, automatic = false) {
  const mode = forcedMode || document.querySelector('#circuit-response-mode').value;
  if (!automatic) setCircuitBusy(true);
  try {
    const response = await fetch(`http://localhost:8000/api/circuit-breaker-demo?mode=${encodeURIComponent(mode)}`, { cache: 'no-store' });
    const data = await response.json();
    renderCircuitStatus(data.breaker, data.result?.message || data.message, !response.ok);
    document.getElementById('circuit-message').textContent = data.result?.message || data.message || 'Protected request completed.';
    startCircuitPolling();
    return data;
  } catch (error) {
    document.getElementById('circuit-message').textContent = `Request failed: ${error.message}`;
    throw error;
  } finally { if (!automatic) setCircuitBusy(false); }
}
async function runCircuitBreakerDemo() { await sendCircuitRequest(); }
async function resetCircuitDemo() {
  setCircuitBusy(true);
  try {
    const response = await fetch('http://localhost:8000/api/circuit-breaker-demo/reset', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Reset failed.');
    circuitUi.autoProbe = false; circuitUi.probeStarted = false;
    renderCircuitStatus(data.breaker, 'Clean demonstration state restored.');
    document.getElementById('circuit-message').textContent = 'Breaker reset to CLOSED with zero counters.';
  } catch (error) { document.getElementById('circuit-message').textContent = error.message; }
  finally { setCircuitBusy(false); }
}
async function triggerCircuitFailures() {
  setCircuitBusy(true);
  try {
    const reset = await fetch('http://localhost:8000/api/circuit-breaker-demo/reset', { method: 'POST' });
    if (!reset.ok) throw new Error((await reset.json()).error || 'Could not reset breaker.');
    document.querySelector('#circuit-response-mode').value = 'failing';
    for (let attempt = 1; attempt <= 4; attempt++) {
      document.getElementById('circuit-message').textContent = attempt <= 3 ? `Sending controlled failure ${attempt} of 3…` : 'Sending one more call to prove OPEN rejects before the target…';
      await sendCircuitRequest('failing', true);
    }
    startCircuitPolling();
  } catch (error) { document.getElementById('circuit-message').textContent = error.message; }
  finally { setCircuitBusy(false); }
}
async function restoreCircuitTarget() {
  document.querySelector('#circuit-response-mode').value = 'recovered';
  const breaker = await readCircuitStatus();
  if (breaker.state === 'OPEN') {
    circuitUi.autoProbe = true; circuitUi.probeStarted = false;
    document.getElementById('circuit-message').textContent = 'Dependency restored. Waiting for the real 15-second cooldown and HALF-OPEN event…';
    startCircuitPolling();
  } else {
    await sendCircuitRequest('recovered');
  }
}

const simpleCircuit = { pollTimer: null };
function setSimpleCircuitBusy(busy) {
  ['send-circuit-success', 'send-circuit-slow', 'send-circuit-failure', 'reset-circuit-demo'].forEach(id => {
    document.getElementById(id).disabled = busy;
  });
}
function renderSimpleCircuit(breaker, message, isError = false) {
  if (!breaker) return;
  document.getElementById('circuit-failure-count').textContent = `${breaker.consecutiveFailures || 0} / ${breaker.failuresToOpen || 3}`;
  document.getElementById('circuit-state-label').textContent = breaker.state.replace('_', '-');
  const seconds = breaker.nextProbeAt ? Math.max(0, Math.ceil((new Date(breaker.nextProbeAt).getTime() - Date.now()) / 1000)) : null;
  document.getElementById('circuit-countdown').textContent = breaker.state === 'OPEN' ? `${seconds} seconds remaining`
    : breaker.state === 'HALF_OPEN' ? 'Ready: send success' : 'Ready';
  document.querySelectorAll('.lab-view[data-lab="circuit"] > .circuit-machine [data-circuit-state]').forEach(node => {
    node.classList.toggle('active', node.dataset.circuitState === breaker.state);
  });
  const values = { 'circuit-total': breaker.totalRequests, 'circuit-success': breaker.successfulRequests,
    'circuit-failed': breaker.failedRequests, 'circuit-timeouts': breaker.timedOutRequests,
    'circuit-rejected': breaker.rejectedRequests, 'circuit-contacts': breaker.downstreamContacts };
  Object.entries(values).forEach(([id, value]) => { document.getElementById(id).textContent = value ?? 0; });
  const contacted = breaker.lastCall ? (breaker.lastCall.targetContacted ? 'Target contacted.' : 'Target was not contacted.') : 'No request sent yet.';
  circuitBreakerResult.innerHTML = `<div class="gateway-result ${isError ? 'error' : ''}"><strong>${escapeHtml(message || breaker.lastEvent)}</strong><span>${escapeHtml(contacted)}</span></div>`;
}
async function readSimpleCircuit() {
  const response = await fetch('http://localhost:8000/api/circuit-breaker-demo/status', { cache: 'no-store' });
  const data = await response.json();
  renderSimpleCircuit(data.breaker);
  return data.breaker;
}
function startSimpleCircuitCountdown() {
  if (simpleCircuit.pollTimer) clearInterval(simpleCircuit.pollTimer);
  simpleCircuit.pollTimer = setInterval(async () => {
    try {
      const breaker = await readSimpleCircuit();
      if (breaker.state !== 'OPEN') {
        clearInterval(simpleCircuit.pollTimer);
        simpleCircuit.pollTimer = null;
      }
    } catch (_) {}
  }, 250);
}
async function sendSimpleCircuit(mode) {
  setSimpleCircuitBusy(true);
  try {
    const response = await fetch(`http://localhost:8000/api/circuit-breaker-demo?mode=${mode}`, { cache: 'no-store' });
    const data = await response.json();
    renderSimpleCircuit(data.breaker, data.result?.message || data.message, !response.ok);
    document.getElementById('circuit-message').textContent = data.result?.message || data.message || 'Request completed.';
    if (data.breaker.state === 'OPEN') startSimpleCircuitCountdown();
  } catch (error) {
    document.getElementById('circuit-message').textContent = error.message;
  } finally { setSimpleCircuitBusy(false); }
}
async function resetSimpleCircuit() {
  setSimpleCircuitBusy(true);
  try {
    const response = await fetch('http://localhost:8000/api/circuit-breaker-demo/reset', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Reset failed.');
    if (simpleCircuit.pollTimer) clearInterval(simpleCircuit.pollTimer);
    simpleCircuit.pollTimer = null;
    renderSimpleCircuit(data.breaker, 'Reset complete. Send any of the three request types.');
    document.getElementById('circuit-message').textContent = 'Breaker reset to CLOSED and failure counter reset to 0 / 3.';
  } catch (error) { document.getElementById('circuit-message').textContent = error.message; }
  finally { setSimpleCircuitBusy(false); }
}

const bulkheadRun = { running: false, requests: [], pools: null, pollTimer: null };
function renderBulkhead() {
  ['recommendation', 'payment'].forEach(poolKey => {
    const pool = bulkheadRun.pools?.[poolKey] || { limit: poolKey === 'recommendation' ? 2 : 1, occupied: 0,
      available: poolKey === 'recommendation' ? 2 : 1, admitted: 0, rejected: 0, completed: 0, activeRequests: [] };
    document.getElementById(`${poolKey}-pool-metrics`).innerHTML = `<span><strong>${pool.occupied}</strong> occupied</span><span><strong>${pool.available}</strong> available</span><span><strong>${pool.admitted}</strong> admitted</span><span><strong>${pool.rejected}</strong> rejected</span><span><strong>${pool.completed}</strong> completed</span>`;
    document.getElementById(`${poolKey}-slots`).innerHTML = Array.from({ length: pool.limit }, (_, index) => {
      const slot = index + 1;
      const active = pool.activeRequests.find(request => request.slot === slot);
      return `<div class="bulkhead-slot ${active ? 'occupied' : ''}"><strong>Slot ${slot}</strong><span>${active ? `${escapeHtml(active.requestId)} · Processing` : 'Available'}</span></div>`;
    }).join('');
  });
  bulkheadDemoResult.innerHTML = bulkheadRun.requests.length ? bulkheadRun.requests.map(request => {
    const css = request.state === 'rejected' || request.state === 'failed' ? 'error' : request.state;
    return `<div class="bulkhead-request ${css}"><strong>${escapeHtml(request.label)}</strong><span>${escapeHtml(request.state.toUpperCase())}</span><small>${escapeHtml(request.detail)}</small></div>`;
  }).join('') : '<div class="empty">Start the run to see admission, rejection, processing and completion.</div>';
}
async function pollBulkheadStatus() {
  const response = await fetch('http://localhost:8000/api/bulkhead-demo/status', { cache: 'no-store' });
  const data = await response.json();
  bulkheadRun.pools = data.pools;
  for (const request of bulkheadRun.requests) {
    const active = data.pools[request.pool].activeRequests.find(value => value.requestId === request.id);
    if (active && request.state === 'waiting') {
      request.state = 'processing'; request.detail = `Admitted to slot ${active.slot}; waiting for dependency.`;
    }
  }
  renderBulkhead();
}
async function callBulkhead(request) {
  try {
    const response = await fetch(`http://localhost:8000/api/bulkhead-demo?pool=${request.pool}&request=${encodeURIComponent(request.id)}`, { cache: 'no-store' });
    const data = await response.json();
    request.state = response.ok ? 'completed' : response.status === 503 ? 'rejected' : 'failed';
    request.detail = data.message || `HTTP ${response.status}`;
    bulkheadRun.pools[request.pool] = data.poolStatus;
  } catch (error) { request.state = 'failed'; request.detail = error.message; }
  renderBulkhead();
}
async function resetBulkheadDemo(showMessage = true) {
  if (bulkheadRun.running) return;
  const response = await fetch('http://localhost:8000/api/bulkhead-demo/reset', { method: 'POST' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Bulkhead reset failed.');
  bulkheadRun.pools = data.pools; bulkheadRun.requests = [];
  renderBulkhead();
  if (showMessage) document.getElementById('bulkhead-message').textContent = 'Both independent pools reset to empty.';
}
async function runBulkheadDemo() {
  if (bulkheadRun.running) return;
  document.getElementById('send-bulkhead-requests').disabled = true;
  document.getElementById('reset-bulkhead-demo').disabled = true;
  try {
    await resetBulkheadDemo(false);
    bulkheadRun.running = true;
    const runId = Date.now();
    bulkheadRun.requests = Array.from({ length: 5 }, (_, index) => ({ id: `recommendation-${runId}-${index + 1}`,
      label: `Recommendation ${index + 1}`, pool: 'recommendation', state: 'waiting', detail: 'Request sent; awaiting admission decision.' }));
    bulkheadRun.requests.push({ id: `payment-${runId}-1`, label: 'Simulated Payment 1', pool: 'payment',
      state: 'waiting', detail: 'Request sent to its independent pool.' });
    renderBulkhead();
    bulkheadRun.pollTimer = setInterval(() => pollBulkheadStatus().catch(() => {}), 150);
    document.getElementById('bulkhead-message').textContent = 'Six requests sent together. Watch each real pool change.';
    await Promise.all(bulkheadRun.requests.map(callBulkhead));
    await pollBulkheadStatus();
    document.getElementById('bulkhead-message').textContent = 'Run complete: recommendation excess was rejected while the separate payment slot remained available.';
  } catch (error) { document.getElementById('bulkhead-message').textContent = error.message; }
  finally {
    if (bulkheadRun.pollTimer) clearInterval(bulkheadRun.pollTimer);
    bulkheadRun.pollTimer = null; bulkheadRun.running = false;
    document.getElementById('send-bulkhead-requests').disabled = false;
    document.getElementById('reset-bulkhead-demo').disabled = false;
  }
}

const loadSheddingRun = { running: false, requests: [], status: null, pollTimer: null };
function renderLoadShedding() {
  const status = loadSheddingRun.status || { safeCapacity: 3, active: 0, available: 3, admitted: 0, shed: 0, completed: 0, activeRequests: [] };
  document.getElementById('load-safe-capacity').textContent = status.safeCapacity;
  document.getElementById('load-active').textContent = status.active;
  document.getElementById('load-available').textContent = status.available;
  document.getElementById('load-admitted').textContent = status.admitted;
  document.getElementById('load-shed').textContent = status.shed;
  document.getElementById('load-completed').textContent = status.completed;
  document.getElementById('load-capacity-slots').innerHTML = Array.from({ length: status.safeCapacity }, (_, index) => {
    const active = status.activeRequests.find(request => request.slot === index + 1) || status.activeRequests[index];
    return `<div class="bulkhead-slot ${active ? 'occupied' : ''}"><strong>Capacity ${index + 1}</strong><span>${active ? `${escapeHtml(active.requestId)} · Processing` : 'Available'}</span></div>`;
  }).join('');
  loadSheddingResult.innerHTML = loadSheddingRun.requests.length ? loadSheddingRun.requests.map(request => {
    const css = request.state === 'shed' || request.state === 'failed' ? 'error' : request.state;
    return `<div class="bulkhead-request ${css}"><strong>${escapeHtml(request.label)}</strong><span>${escapeHtml(request.state.toUpperCase())}</span><small>${escapeHtml(request.detail)}</small></div>`;
  }).join('') : emptyState('Run the controlled burst to see three operations admitted and excess work shed.');
}
async function pollLoadSheddingStatus() {
  const response = await fetch('http://localhost:8000/api/load-shedding-demo/status', { cache: 'no-store' });
  const data = await response.json();
  loadSheddingRun.status = data;
  loadSheddingRun.requests.forEach(request => {
    if (data.activeRequests.some(active => active.requestId === request.id) && request.state === 'waiting') {
      request.state = 'processing';
      request.detail = 'Admitted: executing bounded work.';
    }
  });
  renderLoadShedding();
  return data;
}
async function callLoadShedding(request) {
  try {
    const response = await fetch(`http://localhost:8000/api/load-shedding-demo?request=${encodeURIComponent(request.id)}`, { cache: 'no-store' });
    const data = await response.json();
    request.state = response.ok ? 'completed' : response.status === 503 ? 'shed' : 'failed';
    request.detail = data.message || `HTTP ${response.status}`;
    loadSheddingRun.status = data.status || loadSheddingRun.status;
  } catch (error) {
    request.state = 'failed';
    request.detail = error.message;
  }
  renderLoadShedding();
}
async function resetLoadShedding(showMessage = true) {
  if (loadSheddingRun.running) return;
  const response = await fetch('http://localhost:8000/api/load-shedding-demo/reset', { method: 'POST' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Load-shedding reset failed.');
  loadSheddingRun.status = data.status;
  loadSheddingRun.requests = [];
  renderLoadShedding();
  if (showMessage) document.getElementById('load-shedding-message').textContent = 'Counters reset. All three safe capacity slots are available.';
}
async function runLoadSheddingDemo() {
  if (loadSheddingRun.running) return;
  const runButton = document.getElementById('send-load-shedding-burst');
  const resetButton = document.getElementById('reset-load-shedding-demo');
  runButton.disabled = true;
  resetButton.disabled = true;
  try {
    await resetLoadShedding(false);
    loadSheddingRun.running = true;
    const runId = Date.now();
    loadSheddingRun.requests = Array.from({ length: 10 }, (_, index) => ({ id: `burst-${runId}-${index + 1}`,
      label: `Request ${index + 1}`, state: 'waiting', detail: 'Sent to the service for an admission decision.' }));
    renderLoadShedding();
    document.getElementById('load-shedding-message').textContent = 'Ten simultaneous requests sent. Only safe capacity is admitted; excess is rejected immediately.';
    loadSheddingRun.pollTimer = setInterval(() => pollLoadSheddingStatus().catch(() => {}), 120);
    await Promise.all(loadSheddingRun.requests.map(callLoadShedding));
    await pollLoadSheddingStatus();
    document.getElementById('load-shedding-message').textContent = 'Run complete: admitted work finished; shed requests never started the simulated operation.';
  } catch (error) {
    document.getElementById('load-shedding-message').textContent = error.message;
  } finally {
    if (loadSheddingRun.pollTimer) clearInterval(loadSheddingRun.pollTimer);
    loadSheddingRun.pollTimer = null;
    loadSheddingRun.running = false;
    runButton.disabled = false;
    resetButton.disabled = false;
  }
}

async function runOtelTraceDemo() {
  const button = document.querySelector('#send-otel-trace');
  const failTarget = document.querySelector('#fail-otel-trace-target').checked;
  button.disabled = true;
  otelTraceResult.innerHTML = '<div class="gateway-result">Following the request...</div>';

  try {
    const url = `http://localhost:8000/api/otel-trace-demo${failTarget ? '?failTarget=1' : ''}`;
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();
    otelTraceResult.innerHTML = `
      <div class="gateway-result ${response.ok ? '' : 'error'}">
        <strong>${escapeHtml(data.error || (response.ok ? 'Record saved and read from MongoDB' : 'Request failed'))}</strong>
        ${data.record ? `<span>MongoDB record: ${escapeHtml(data.record.id)} · ${escapeHtml(formatTimestamp(data.record.createdAt))}</span>` : ''}
        <a href="http://localhost:16686/" target="_blank" rel="noopener noreferrer">Open Jaeger: service resilience-lab-service, operation POST /trace-demo</a>
      </div>
    `;
  } catch (error) {
    otelTraceResult.innerHTML = `<div class="gateway-result error">${escapeHtml(error.message)}</div>`;
  } finally {
    button.disabled = false;
  }
}

function formatAccountMoney(amountCents) {
  return `USD ${(amountCents / 100).toFixed(2)}`;
}

async function loadEventSourcingAccount() {
  const accountId = eventAccountSelect.value;
  if (!accountId) {
    eventAccountSummary.innerHTML = emptyState('Open a demo account to begin.');
    eventAccountHistory.innerHTML = '';
    return;
  }

  try {
    const [accountResponse, eventsResponse] = await Promise.all([
      fetch(`http://localhost:8000/api/accounts/${accountId}`),
      fetch(`http://localhost:8000/api/accounts/${accountId}/events`)
    ]);
    const accountData = await accountResponse.json();
    const eventsData = await eventsResponse.json();
    if (!accountResponse.ok) throw new Error(accountData.error || 'Could not load account');
    if (!eventsResponse.ok) throw new Error(eventsData.error || 'Could not load account history');

    const account = accountData.account;
    eventAccountSummary.innerHTML = `
      <div class="gateway-result">
        <strong>Current balance: ${escapeHtml(formatAccountMoney(account.balanceCents))}</strong>
        <span>Rebuilt from ${escapeHtml(account.version)} event(s) · Account ${escapeHtml(account.accountId)}</span>
      </div>
    `;
    eventAccountHistory.innerHTML = eventsData.events.map((event) => `
      <div class="gateway-result">
        <strong>#${escapeHtml(event.sequence)} · ${escapeHtml(event.type)}</strong>
        <span>${escapeHtml(event.type === 'AccountOpened' ? 'Account opened' : formatAccountMoney(event.amountCents))} · ${escapeHtml(formatTimestamp(event.occurredAt))}</span>
      </div>
    `).join('');
  } catch (error) {
    eventAccountSummary.innerHTML = `<div class="gateway-result error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadEventSourcingAccounts(preferredAccountId = '') {
  try {
    const response = await fetch('http://localhost:8000/api/accounts');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load accounts');

    const oldAccountId = eventAccountSelect.value;
    eventAccountSelect.innerHTML = data.accounts.map((account) => `
      <option value="${escapeHtml(account.accountId)}">${escapeHtml(account.accountId.slice(0, 8))} · ${escapeHtml(formatAccountMoney(account.balanceCents))}</option>
    `).join('');
    eventAccountSelect.value = preferredAccountId || oldAccountId;
    if (!eventAccountSelect.value && data.accounts.length > 0) {
      eventAccountSelect.value = data.accounts[0].accountId;
    }
    await loadEventSourcingAccount();
  } catch (error) {
    eventAccountSummary.innerHTML = `<div class="gateway-result error">${escapeHtml(error.message)}</div>`;
  }
}

async function openEventSourcingAccount() {
  try {
    const response = await fetch('http://localhost:8000/api/accounts', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not open account');
    await loadEventSourcingAccounts(data.account.accountId);
    eventAccountMessage.textContent = 'Demo account opened; AccountOpened was appended to the event history.';
    eventAccountMessage.className = 'message';
  } catch (error) {
    eventAccountMessage.textContent = error.message;
    eventAccountMessage.className = 'message error';
  }
}

async function changeEventSourcingBalance(operation) {
  const accountId = eventAccountSelect.value;
  const amount = Number(eventAccountAmount.value);
  const amountCents = Math.round(amount * 100);
  if (!accountId) {
    eventAccountMessage.textContent = 'Open or select an account first.';
    eventAccountMessage.className = 'message error';
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amountCents)) {
    eventAccountMessage.textContent = 'Enter a valid amount greater than zero.';
    eventAccountMessage.className = 'message error';
    return;
  }

  try {
    const response = await fetch(`http://localhost:8000/api/accounts/${accountId}/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Could not ${operation} money`);
    await loadEventSourcingAccounts(accountId);
    eventAccountAmount.value = '';
    eventAccountMessage.textContent = `${data.event.type} appended. Current balance: ${formatAccountMoney(data.account.balanceCents)}.`;
    eventAccountMessage.className = 'message';
  } catch (error) {
    eventAccountMessage.textContent = error.message;
    eventAccountMessage.className = 'message error';
  }
}

async function testLoadBalancing() {
  try {
    const response = await fetch('http://localhost:8000/api/load-balanced/email-health');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Gateway request failed');

    showGatewayTestResult(
      'Load-balanced request accepted',
      `Kong selected ${data.instance || 'an Email Service instance'}. Click again to observe round-robin routing.`
    );
  } catch (error) {
    showGatewayTestResult('Load-balancing request failed', error.message, true);
  }
}

async function testRateLimit() {
  try {
    const response = await fetch('http://localhost:8000/api/rate-limit-test');
    const data = await response.json().catch(() => ({}));
    const limit = response.headers.get('RateLimit-Limit-Minute') || response.headers.get('X-RateLimit-Limit-Minute') || '5';
    const remaining = response.headers.get('RateLimit-Remaining-Minute') || response.headers.get('X-RateLimit-Remaining-Minute');
    const retryAfter = response.headers.get('Retry-After');
    if (!response.ok) {
      showGatewayTestResult(`Rate limit blocked the request (${response.status})`,
        retryAfter ? `Kong allows ${limit} requests per minute. Retry after about ${retryAfter} seconds.`
          : data.message || `Kong allows ${limit} requests per minute. Wait for the quota window to reset.`, true);
      return;
    }
    showGatewayTestResult('Rate-limited request accepted',
      `Kong allowed this request. Remaining this minute: ${remaining ?? 'unknown'} of ${limit}.`);
  } catch (error) {
    showGatewayTestResult('Rate-limit request failed', error.message, true);
  }
}

// Kong forwards this request to Inventory Service.
// The product list also fills the order dropdown.
async function loadProducts() {
  const response = await fetch('http://localhost:8000/api/products');
  const products = await response.json();

  if (!response.ok) {
    throw new Error(products.error || 'Could not fetch products');
  }

  updateMetric('product-count', products.length);
  updateMetric('stock-count', products.reduce((total, product) => total + product.stock, 0));

  productsList.innerHTML = products.length
    ? products.map((product) => `
        <div class="product-item">
          <div><div class="item-title">${escapeHtml(product.name)}</div><div class="item-meta">Inventory service / REST</div></div>
          <div class="item-actions"><span class="stock ${product.stock < 5 ? 'low' : ''}">${product.stock} in stock</span><button class="delete" type="button" data-delete-product="${escapeHtml(product._id)}">Delete</button></div>
        </div>
      `).join('')
    : emptyState('No products yet. Add the first item above.');

  productSelect.innerHTML = products
    .map((product) => `<option value="${escapeHtml(product._id)}" ${product.stock === 0 ? 'disabled' : ''}>${escapeHtml(product.name)} (${product.stock} available)</option>`).join('');
}

// Render the emails returned by the Email Service through Kong.
function renderEmails(emails, instanceName) {
  return emails.length
    ? emails.slice().reverse().map((email) => `
        <div class="event-item">
          <span class="event-mark mail">@</span>
          <div class="event-copy">
            <div class="item-title">Email sent to ${escapeHtml(email.to)}</div>
            <div class="item-meta">Subject: ${escapeHtml(email.subject)} / order: ${escapeHtml(email.orderId)}</div>
            <div class="item-meta">Consumed by: ${escapeHtml(email.consumedBy || instanceName)} / ${escapeHtml(email.createdAt)}</div>
          </div>
        </div>
      `).join('')
    : emptyState(`No emails consumed by ${instanceName} yet.`);
}

function renderKafkaEmails(emails, instanceName) {
  return emails.length
    ? emails.slice().reverse().map((email) => `
        <div class="event-item kafka-event">
          <span class="event-mark mail">K</span>
          <div class="event-copy">
            <div class="item-title">Payment approved for ${displayValue(email.customerName)}</div>
            <div class="item-meta">Email: ${displayValue(email.to)} · Product: ${displayValue(email.productName)} × ${displayValue(email.quantity)}</div>
            <div class="event-details">
              <span><b>Amount</b>${displayValue(email.amount)}</span>
              <span><b>Event created</b>${formatTimestamp(email.eventCreatedAt)}</span>
              <span><b>Consumed</b>${formatTimestamp(email.consumedAt || email.createdAt)}</span>
              <span><b>Consumer</b>${displayValue(email.consumedBy || instanceName)}</span>
            </div>
            <div class="item-meta event-id">Order: ${displayValue(email.orderId)} · Payment: ${displayValue(email.paymentId)}</div>
          </div>
        </div>
      `).join('')
    : emptyState(`No Kafka events consumed by ${instanceName} yet.`);
}

function renderKafkaNotifications(notifications) {
  return notifications.length
    ? notifications.slice().reverse().map((notification) => `
        <div class="event-item kafka-event">
          <span class="event-mark">K</span>
          <div class="event-copy">
            <div class="item-title">Payment approved for ${displayValue(notification.customerName)}</div>
            <div class="item-meta">Product: ${displayValue(notification.productName)} × ${displayValue(notification.quantity)}</div>
            <div class="event-details">
              <span><b>Amount</b>${displayValue(notification.amount)}</span>
              <span><b>Event created</b>${formatTimestamp(notification.eventCreatedAt)}</span>
              <span><b>Consumed</b>${formatTimestamp(notification.consumedAt || notification.createdAt)}</span>
              <span><b>Consumer</b>${displayValue(notification.consumedBy)}</span>
            </div>
            <div class="item-meta event-id">Order: ${displayValue(notification.orderId)} · Payment: ${displayValue(notification.paymentId)}</div>
          </div>
        </div>
      `).join('')
    : emptyState('No Kafka notifications received yet.');
}

async function loadEmailInstance(api, elementId, instanceName) {
  const response = await fetch(api);
  const emails = await response.json();

  if (!response.ok) throw new Error(emails.error || `Could not fetch ${instanceName} emails`);
  document.querySelector(`#${elementId}`).innerHTML = renderEmails(emails, instanceName);
  return emails.length;
}

// Fetch both local in-memory email lists. RabbitMQ decides which instance receives each message.
async function loadEmails() {
  try {
    const [emailCountA, emailCountB] = await Promise.all([
      loadEmailInstance('http://localhost:8000/api/emails/a', 'emails-a', 'email-service-A'),
      loadEmailInstance('http://localhost:8000/api/emails/b', 'emails-b', 'email-service-B')
    ]);

    currentEmailCount = emailCountA + emailCountB;
    updateMetric('event-count', currentEmailCount + currentNotificationCount + currentKafkaEmailCount + currentKafkaNotificationCount);
  } catch (error) {
    console.error('Could not fetch emails:', error);
  }
}

async function loadKafkaEmails() {
  try {
    const [responseA, responseB] = await Promise.all([
      fetch('http://localhost:8000/api/kafka/emails/a'),
      fetch('http://localhost:8000/api/kafka/emails/b')
    ]);
    const [dataA, dataB] = await Promise.all([responseA.json(), responseB.json()]);
    if (!responseA.ok || !responseB.ok) throw new Error('Could not fetch Kafka email events');

    document.querySelector('#kafka-emails-a').innerHTML = renderKafkaEmails(dataA.emails, 'email-service-A');
    document.querySelector('#kafka-emails-b').innerHTML = renderKafkaEmails(dataB.emails, 'email-service-B');
    currentKafkaEmailCount = dataA.emails.length + dataB.emails.length;
    updateMetric('event-count', currentEmailCount + currentNotificationCount + currentKafkaEmailCount + currentKafkaNotificationCount);
  } catch (error) {
    console.error('Could not fetch Kafka emails:', error);
  }
}

// Fetch all notifications from notification-service and render them.
async function loadNotifications() {
  try {
    const response = await fetch('http://localhost:8000/api/notifications');
    const notifications = await response.json();

    currentNotificationCount = notifications.length;
    updateMetric('event-count', currentEmailCount + currentNotificationCount + currentKafkaEmailCount + currentKafkaNotificationCount);
    const notificationsHtml = notifications.length
      ? notifications.slice().reverse().map((n) => `
        <div class="event-item">
          <span class="event-mark">!</span>
          <div class="event-copy"><div class="item-title">Notification for ${escapeHtml(n.userName)}</div><div class="item-meta">${escapeHtml(n.message)}</div></div>
        </div>
      `).join('')
      : emptyState('No notification events received yet.');

    document.querySelector('#notifications').innerHTML = notificationsHtml;
  } catch (error) {
    console.error('Could not fetch notifications:', error);
  }
}

async function loadKafkaNotifications() {
  try {
    const response = await fetch('http://localhost:8000/api/kafka/notifications');
    const data = await response.json();
    if (!response.ok) throw new Error('Could not fetch Kafka notifications');

    document.querySelector('#kafka-notifications').innerHTML = renderKafkaNotifications(data.notifications);
    currentKafkaNotificationCount = data.notifications.length;
    updateMetric('event-count', currentEmailCount + currentNotificationCount + currentKafkaEmailCount + currentKafkaNotificationCount);
  } catch (error) {
    console.error('Could not fetch Kafka notifications:', error);
  }
}

let currentEmailCount = 0;
let currentNotificationCount = 0;
let currentKafkaEmailCount = 0;
let currentKafkaNotificationCount = 0;

// Fetch all saved orders from order-service and render them.
// A Pay button is shown only while an order is waiting for payment.
async function loadOrders() {
  const response = await fetch('http://localhost:8000/api/orders');
  const orders = await response.json();
  if (!response.ok) throw new Error(orders.error || 'Could not fetch orders');

  updateMetric('order-count', orders.length);
  ordersList.innerHTML = orders.length ? orders.map((order) => {
      const payButton = order.status === 'pending_payment'
        ? `<button class="pay" data-pay-id="${escapeHtml(order._id)}">Pay</button>`
        : '';

      return `<div class="order-item"><div><div class="item-title">${escapeHtml(order.productName)} <span class="item-meta">x ${order.quantity}</span></div><div class="item-meta">For ${escapeHtml(order.customerName)} / ${escapeHtml(order._id)}</div></div><div class="item-actions">${payButton}<span class="status ${escapeHtml(order.status)}">${escapeHtml(order.status.replace('_', ' '))}</span><button class="delete" type="button" data-delete-order="${escapeHtml(order._id)}">Delete</button></div></div>`;
    }).join('') : emptyState('No orders yet. Create one to start the flow.');
}

// Add a product through Kong's Inventory route.
document.querySelector('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault(); // Keep the page from reloading.

  const form = new FormData(event.target);
  const newProduct = {
    name: form.get('name'),
    stock: Number(form.get('stock'))
  };

  try {
    const response = await fetch('http://localhost:8000/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProduct)
    });
    const product = await response.json();

    if (!response.ok) {
      throw new Error(product.error || 'Could not create product');
    }

    event.target.reset();
    showMessage('Product added.');
    await loadProducts(); // Refresh stock list and order dropdown.
  } catch (error) {
    showMessage(error.message, true);
  }
});

productsList.addEventListener('click', async (event) => {
  const productId = event.target.closest('[data-delete-product]')?.dataset.deleteProduct;
  if (!productId || !window.confirm('Delete this product?')) return;

  try {
    const response = await fetch(`http://localhost:8000/api/products/${productId}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete product');
    showMessage('Product deleted.');
    await loadProducts();
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Create an order. This reduces inventory and saves an unpaid order.
document.querySelector('#order-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const form = new FormData(event.target);
  const newOrder = {
    productId: productSelect.value,
    quantity: Number(form.get('quantity')),
    customerName: form.get('customerName'),
    userEmail: form.get('userEmail'),
    simulateSagaFailure: form.get('simulateSagaFailure') === 'on'
  };

  try {
    const response = await fetch('http://localhost:8000/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newOrder)
    });
    const order = await response.json();
    if (!response.ok) {
      if (order.sagaCompensated) await loadProducts();
      throw new Error(order.error || 'Could not create order');
    }

    event.target.reset();
    showMessage(`Order ${order._id} created. Click Pay when ready.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.all([loadProducts(), loadOrders(), loadEmails(), loadNotifications(), loadKafkaEmails(), loadKafkaNotifications()]);
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Use one click listener for every current/future Pay button in the order list.
ordersList.addEventListener('click', async (event) => {
  const orderId = event.target.closest('[data-pay-id]')?.dataset.payId;
  const deleteOrderId = event.target.closest('[data-delete-order]')?.dataset.deleteOrder;

  if (deleteOrderId) {
    if (!window.confirm('Delete this order?')) return;

    try {
      const response = await fetch(`http://localhost:8000/api/orders/${deleteOrderId}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete order');
      showMessage(result.success ? 'Order deleted.' : 'Could not delete order.', !result.success);
      await loadOrders();
    } catch (error) {
      showMessage(error.message, true);
    }
    return;
  }

  // Ignore clicks that were not on a Pay button.
  if (!orderId) return;

  try {
    const response = await fetch(`http://localhost:8000/api/orders/${orderId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simulatePaymentFailure: document.querySelector('#simulate-payment-failure').checked })
    });
    const result = await response.json();
    if (!response.ok && result.saga) sagaTimeline.innerHTML = '<div class="gateway-result error"><strong>' + escapeHtml(result.error) + '</strong><span>Order created -> Inventory reserved -> Payment attempted -> Payment failed -> Compensation requested -> ' + (result.saga.stockRestored ? 'Inventory restored -> order compensated' : 'Inventory restoration pending') + '</span><span>Final order status: ' + escapeHtml(result.order?.status || 'unknown') + '</span></div>';
    if (!response.ok && result.saga) await Promise.all([loadProducts(), loadOrders()]);
    if (!response.ok) throw new Error(result.error || 'Could not pay for order');

    showMessage(`Payment successful. Transaction: ${result.transactionId}`);
    sagaTimeline.innerHTML = '<div class="gateway-result"><strong>Payment succeeded - Order completed</strong><span>Inventory reservation remains committed. Final order status: ' + escapeHtml(result.order.status) + '.</span></div>';
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.all([loadOrders(), loadEmails(), loadNotifications(), loadKafkaEmails(), loadKafkaNotifications()]);
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Refresh button and initial page load.
document.querySelector('#refresh-orders').addEventListener('click', loadOrders);
document.querySelector('#test-load-balancing').addEventListener('click', testLoadBalancing);
document.querySelector('#test-rate-limit').addEventListener('click', testRateLimit);
document.querySelector('#send-circuit-request').addEventListener('click', runCircuitBreakerDemo);
document.querySelector('#trigger-circuit-failures').addEventListener('click', triggerCircuitFailures);
document.querySelector('#restore-circuit-target').addEventListener('click', restoreCircuitTarget);
document.querySelector('#send-retry-request').addEventListener('click', runRetryDemo);
document.querySelector('#send-bulkhead-requests').addEventListener('click', runBulkheadDemo);
document.querySelector('#reset-bulkhead-demo').addEventListener('click', () => resetBulkheadDemo().catch(error => {
  document.getElementById('bulkhead-message').textContent = error.message;
}));
document.querySelector('#send-load-shedding-burst').addEventListener('click', runLoadSheddingDemo);
document.querySelector('#reset-load-shedding-demo').addEventListener('click', () => resetLoadShedding().catch(error => {
  document.getElementById('load-shedding-message').textContent = error.message;
}));
readCircuitStatus().catch(() => {});
document.querySelector('#send-circuit-success').addEventListener('click', () => sendSimpleCircuit('healthy'));
document.querySelector('#send-circuit-slow').addEventListener('click', () => sendSimpleCircuit('slow'));
document.querySelector('#send-circuit-failure').addEventListener('click', () => sendSimpleCircuit('failing'));
document.querySelector('#reset-circuit-demo').addEventListener('click', resetSimpleCircuit);
readSimpleCircuit().catch(() => {});
renderBulkhead();
pollLoadSheddingStatus().catch(() => renderLoadShedding());
document.querySelector('#send-otel-trace').addEventListener('click', runOtelTraceDemo);
document.querySelector('#open-demo-account').addEventListener('click', openEventSourcingAccount);
document.querySelector('#event-account-select').addEventListener('change', loadEventSourcingAccount);
document.querySelector('#deposit-account-money').addEventListener('click', () => changeEventSourcingBalance('deposit'));
document.querySelector('#withdraw-account-money').addEventListener('click', () => changeEventSourcingBalance('withdraw'));

Promise.all([loadProducts(), loadOrders(), loadEmails(), loadNotifications(), loadKafkaEmails(), loadKafkaNotifications(), loadEventSourcingAccounts()])
  .catch((error) => showMessage(error.message, true));

// Dashboard navigation only changes visibility. Existing lab controls, DOM nodes, and API functions remain shared.
const labRegistry = {
  overview: { workspace: 'overview', title: 'Lab directory' },
  commerce: { workspace: 'commerce', title: 'Commerce workflow & Saga' },
  saga: { workspace: 'commerce', title: 'Saga compensation' },
  rabbitmq: { workspace: 'rabbitmq', title: 'RabbitMQ' },
  kafka: { workspace: 'kafka', title: 'Kafka' },
  gateway: { workspace: 'gateway', title: 'API Gateway' },
  'rate-limiting': { workspace: 'gateway', title: 'Rate limiting' },
  circuit: { workspace: 'circuit', title: 'Circuit breaker' },
  timeouts: { workspace: 'circuit', title: 'Timeouts' },
  retry: { workspace: 'retry', title: 'Retry' },
  bulkhead: { workspace: 'bulkhead', title: 'Bulkhead' },
  'event-sourcing': { workspace: 'event-sourcing', title: 'Event sourcing' },
  observability: { workspace: 'observability', title: 'Observability' },
  idempotency: { workspace: 'idempotency', title: 'Idempotency' },
  'load-shedding': { workspace: 'load-shedding', title: 'Load shedding' }
};

const labViews = [...document.querySelectorAll('[data-lab]')];
const labLinks = [...document.querySelectorAll('[data-lab-link]')];
const focusModeToggle = document.querySelector('#focus-mode-toggle');

function getRequestedLab() {
  const requested = window.location.hash.slice(1);
  return labRegistry[requested] ? requested : 'overview';
}

function selectLab(labId, updateHash = true) {
  const lab = labRegistry[labId] || labRegistry.overview;

  labViews.forEach((view) => {
    view.hidden = view.dataset.lab !== lab.workspace;
  });

  labLinks.forEach((link) => {
    link.classList.toggle('active', (link.dataset.navKey || link.dataset.labLink) === labId);
  });

  document.title = lab.title + ' - Beyond Microservices Live Labs';

  if (updateHash && window.location.hash !== '#' + labId) {
    window.location.hash = labId;
  }
}

labLinks.forEach((link) => {
  link.addEventListener('click', () => selectLab(link.dataset.navKey || link.dataset.labLink));
});

window.addEventListener('hashchange', () => selectLab(getRequestedLab(), false));

function setFocusMode(enabled) {
  document.body.classList.toggle('focus-mode', enabled);
  focusModeToggle.setAttribute('aria-pressed', String(enabled));
  focusModeToggle.textContent = enabled ? 'Exit focus mode' : 'Focus mode';
}

focusModeToggle.addEventListener('click', () => {
  setFocusMode(!document.body.classList.contains('focus-mode'));
});

document.addEventListener('keydown', (event) => {
  const typingInControl = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key === 'Escape' && document.body.classList.contains('focus-mode') && !typingInControl) {
    setFocusMode(false);
  }
});

selectLab(getRequestedLab(), false);
const idempotencyState = { account: null, attempts: [], busy: false };
const idempotencyApi = 'http://localhost:8000/api/idempotency-lab';
const idempotencyElement = id => document.getElementById(id);
const idempotencyStorageKey = 'idempotency-demo-account';
function saveIdempotencySession() {
  if (idempotencyState.account) sessionStorage.setItem(idempotencyStorageKey, JSON.stringify({
    runId: idempotencyState.account.runId, mode: idempotencyState.account.mode,
    attempts: idempotencyState.attempts
  }));
  else sessionStorage.removeItem(idempotencyStorageKey);
}
const idempotencyMoney = cents => 'PKR ' + (cents / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function idempotencyCents(inputId) {
  const value = idempotencyElement(inputId).value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0 || Number(value) > 10000000) {
    throw new Error('Enter a positive amount with up to two decimal places.');
  }
  return Math.round(Number(value) * 100);
}
function idempotencyMessage(message, error = false) {
  const element = idempotencyElement('idempotency-message');
  element.textContent = message;
  element.classList.toggle('error', error);
}
function idempotencyBusy(busy) {
  idempotencyState.busy = busy;
  ['idempotency-new-run', 'idempotency-fund', 'idempotency-success', 'idempotency-first', 'idempotency-retry', 'idempotency-refresh'].forEach(id => {
    idempotencyElement(id).disabled = busy;
  });
}
async function idempotencyJson(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}
function renderIdempotencyAccount() {
  const account = idempotencyState.account;
  idempotencyElement('idempotency-balance').textContent = idempotencyMoney(account ? account.balanceCents : 0);
  idempotencyElement('idempotency-effects').textContent = account ? account.serverSidePaymentEffects : 0;
  idempotencyElement('idempotency-attempts').textContent = idempotencyState.attempts.length;
  idempotencyElement('idempotency-transactions').innerHTML = account && account.effects.length
    ? '<h4>Saved payments</h4>' + account.effects.map((effect, index) =>
      '<div class="gateway-result"><strong>#' + (index + 1) + ' − ' + idempotencyMoney(effect.amountCents) + ' deducted</strong><span>Transaction ' + escapeHtml(effect.transactionId) + '</span></div>').join('')
    : '<div class="empty">No saved payments yet.</div>';
}
function renderIdempotencyTimeline() {
  const attempts = idempotencyState.attempts;
  idempotencyElement('idempotency-history').innerHTML = attempts.length ? attempts.map((attempt, index) => {
    const steps = [
      '<span>✓ Request ' + (index + 1) + ' sent: ' + escapeHtml(attempt.label) + '</span>',
      attempt.effect === 'saved' ? '<span>✓ Payment saved; ' + idempotencyMoney(attempt.amountCents) + ' deducted</span>' :
        attempt.effect === 'reused' ? '<span>✓ Existing payment reused; no new deduction</span>' :
          '<span>— Payment effect could not be confirmed</span>',
      attempt.outcome === 'lost' ? '<span class="idempotency-failed-step">✕ Response lost before the client received it</span>' :
        attempt.outcome === 'received' ? '<span>✓ Response returned successfully to client</span>' :
          '<span class="idempotency-failed-step">✕ Request failed: ' + escapeHtml(attempt.error || 'Unknown error') + '</span>'
    ];
    return '<div class="idempotency-attempt"><strong>Attempt ' + (index + 1) + '</strong>' + steps.join('') + '</div>';
  }).join('') : '<div class="empty">Send a payment to see the request steps.</div>';
}
function renderIdempotencySummary() {
  const account = idempotencyState.account;
  const last = idempotencyState.attempts.at(-1);
  const summary = idempotencyElement('idempotency-summary');
  if (!account) {
    summary.innerHTML = '<div class="empty">Start a demo account to begin.</div>';
  } else if (!last) {
    summary.innerHTML = '<div class="gateway-result"><strong>Account ready</strong><span>Balance: ' + idempotencyMoney(account.balanceCents) + '. Choose one of the two payment buttons.</span></div>';
  } else {
    const detail = last.outcome === 'lost' ? 'The client did not receive a payment response. The server state below confirms what was saved.' :
      last.outcome === 'received' ? 'The client received the payment response.' : last.error || 'The request failed.';
    summary.innerHTML = '<div class="gateway-result' + (last.outcome === 'failed' ? ' error' : '') + '"><strong>' +
      account.serverSidePaymentEffects + ' saved payment effect' + (account.serverSidePaymentEffects === 1 ? '' : 's') +
      ' · ' + idempotencyMoney(account.balanceCents) + ' remains</strong><span>' + escapeHtml(detail) + '</span></div>';
  }
  renderIdempotencyAccount();
  renderIdempotencyTimeline();
}
async function fetchIdempotencyAccount() {
  if (!idempotencyState.account) return null;
  const response = await fetch(idempotencyApi + '/runs/' + idempotencyState.account.runId, { cache: 'no-store' });
  idempotencyState.account = await idempotencyJson(response);
  renderIdempotencySummary();
  return idempotencyState.account;
}
async function newIdempotencyRun() {
  idempotencyBusy(true);
  try {
    const startingBalanceCents = idempotencyCents('idempotency-starting-balance');
    const response = await fetch(idempotencyApi + '/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: idempotencyElement('idempotency-mode').value, startingBalanceCents })
    });
    idempotencyState.account = await idempotencyJson(response);
    idempotencyState.account.serverSidePaymentEffects = 0;
    idempotencyState.attempts = [];
    saveIdempotencySession();
    idempotencyMessage('New dummy account created. Its balance is stored in the payment service.');
    renderIdempotencySummary();
  } catch (error) { idempotencyMessage(error.message, true); }
  finally { idempotencyBusy(false); }
}
async function fundIdempotencyAccount() {
  if (!idempotencyState.account) return idempotencyMessage('Start a demo account first.', true);
  idempotencyBusy(true);
  try {
    const amountCents = idempotencyCents('idempotency-add-amount');
    const response = await fetch(idempotencyApi + '/runs/' + idempotencyState.account.runId + '/fund', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountCents })
    });
    await idempotencyJson(response);
    await fetchIdempotencyAccount();
    idempotencyMessage(idempotencyMoney(amountCents) + ' added to the dummy account.');
  } catch (error) { idempotencyMessage(error.message, true); }
  finally { idempotencyBusy(false); }
}
async function sendIdempotencyPayment(lost, label) {
  if (!idempotencyState.account) return idempotencyMessage('Start a demo account first.', true);
  idempotencyBusy(true);
  const before = idempotencyState.account.serverSidePaymentEffects;
  let attempt;
  try {
    const amountCents = idempotencyCents('idempotency-payment-amount');
    attempt = { label, amountCents, outcome: 'failed', effect: 'unknown' };
    const account = idempotencyState.account;
    let response;
    try {
      response = await fetch(idempotencyApi + '/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: account.runId, logicalPaymentId: account.logicalPaymentId,
          idempotencyKey: account.idempotencyKey, amountCents, currency: 'PKR', simulateLostResponse: lost })
      });
    } catch (error) {
      if (!lost) throw error;
    }
    if (response && response.ok) {
      const result = await response.json();
      attempt.outcome = 'received';
      attempt.effect = result.deduplicated ? 'reused' : 'saved';
    } else if (!lost || (response && response.status !== 502 && response.status !== 503)) {
      if (response) await idempotencyJson(response);
      throw new Error('Payment response could not be received.');
    } else {
      attempt.outcome = 'lost';
    }
    await fetchIdempotencyAccount();
    if (attempt.outcome === 'lost') {
      attempt.effect = idempotencyState.account.serverSidePaymentEffects > before ? 'saved' :
        idempotencyState.account.effects.length ? 'reused' : 'unknown';
      idempotencyMessage('Response lost. Server state confirms ' + idempotencyState.account.serverSidePaymentEffects + ' saved payment effect(s).', true);
    } else {
      idempotencyMessage(attempt.effect === 'reused' ? 'Existing payment returned; no extra deduction.' : 'Payment saved and response returned successfully.');
    }
  } catch (error) {
    idempotencyMessage(error.message, true);
    if (attempt) { attempt.error = error.message; try { await fetchIdempotencyAccount(); } catch (_) {} }
  } finally {
    if (attempt) idempotencyState.attempts.push(attempt);
    saveIdempotencySession();
    renderIdempotencySummary();
    idempotencyBusy(false);
  }
}
idempotencyElement('idempotency-mode').addEventListener('change', () => {
  idempotencyState.account = null;
  idempotencyState.attempts = [];
  saveIdempotencySession();
  idempotencyMessage('Mode changed. Start a new demo account for this scenario.');
  renderIdempotencySummary();
});
idempotencyElement('idempotency-new-run').addEventListener('click', newIdempotencyRun);
idempotencyElement('idempotency-fund').addEventListener('click', fundIdempotencyAccount);
idempotencyElement('idempotency-success').addEventListener('click', () => sendIdempotencyPayment(false, 'Receive response'));
idempotencyElement('idempotency-first').addEventListener('click', () => sendIdempotencyPayment(true, 'Lose response'));
idempotencyElement('idempotency-retry').addEventListener('click', () => sendIdempotencyPayment(false, 'Retry same payment'));
idempotencyElement('idempotency-refresh').addEventListener('click', async () => {
  if (!idempotencyState.account) return idempotencyMessage('Start a demo account first.', true);
  try { await fetchIdempotencyAccount(); idempotencyMessage('Server state refreshed.'); }
  catch (error) { idempotencyMessage(error.message, true); }
});
renderIdempotencySummary();
try {
  const saved = JSON.parse(sessionStorage.getItem(idempotencyStorageKey) || 'null');
  if (saved && saved.runId && ['protected', 'unprotected'].includes(saved.mode)) {
    idempotencyElement('idempotency-mode').value = saved.mode;
    idempotencyState.account = { runId: saved.runId };
    idempotencyState.attempts = Array.isArray(saved.attempts) ? saved.attempts : [];
    idempotencyBusy(true);
    fetchIdempotencyAccount().then(() => idempotencyMessage('Demo account restored from the payment service.'))
      .catch(error => { idempotencyState.account = null; idempotencyState.attempts = []; saveIdempotencySession(); renderIdempotencySummary(); idempotencyMessage(error.message, true); })
      .finally(() => idempotencyBusy(false));
  }
} catch (_) { sessionStorage.removeItem(idempotencyStorageKey); }
