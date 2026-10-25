const express = require('express');
const CircuitBreaker = require('opossum');
const { randomUUID } = require('crypto');

const router = express.Router();
const TIMEOUT_MS = 3000;
const RESET_TIMEOUT_MS = 15000;
const modes = new Set(['healthy', 'slow', 'failing', 'recovered']);
let breaker;
let activeFires = 0;
let downstreamContacts = 0;
let lastEvent = 'Circuit breaker is ready in CLOSED state.';
let lastEventAt = new Date().toISOString();
let nextProbeAt = null;
let lastCall = null;

function recordEvent(message) {
  lastEvent = message;
  lastEventAt = new Date().toISOString();
}

function createBreaker() {
  const instance = new CircuitBreaker(async context => {
    context.targetContacted = true;
    downstreamContacts++;
    const response = await fetch(`http://resilience-target-service:4010/circuit?mode=${context.mode}&requestId=${context.requestId}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Target request failed');
    return body;
  }, { timeout: TIMEOUT_MS, errorThresholdPercentage: 50, volumeThreshold: 3, resetTimeout: RESET_TIMEOUT_MS });
  instance.on('open', () => {
    nextProbeAt = new Date(Date.now() + RESET_TIMEOUT_MS).toISOString();
    recordEvent('OPEN: failure policy reached; normal calls now fail fast.');
  });
  instance.on('halfOpen', () => { nextProbeAt = null; recordEvent('HALF-OPEN: one recovery probe is permitted.'); });
  instance.on('close', () => { nextProbeAt = null; recordEvent('CLOSED: a successful recovery probe restored normal calls.'); });
  instance.on('timeout', () => recordEvent(`A protected request exceeded the ${TIMEOUT_MS} ms timeout.`));
  instance.on('reject', () => recordEvent('OPEN: request rejected without contacting the target.'));
  return instance;
}

breaker = createBreaker();

function getStatus() {
  const stats = breaker.stats;
  return {
    state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
    lastEvent, lastEventAt, nextProbeAt,
    timeoutMs: TIMEOUT_MS, resetAfterMs: RESET_TIMEOUT_MS,
    failureThresholdPercentage: 50, minimumRequestVolume: 3,
    totalRequests: stats.fires, successfulRequests: stats.successes,
    failedRequests: stats.failures, rejectedRequests: stats.rejects,
    timedOutRequests: stats.timeouts, downstreamContacts,
    activeRequests: activeFires, lastCall
  };
}

router.get('/', async (request, response) => {
  const mode = modes.has(request.query.mode) ? request.query.mode : 'healthy';
  if (mode !== 'healthy' && process.env.RESILIENCE_LABS_ENABLED !== 'true') return response.sendStatus(404);
  const context = { mode, requestId: randomUUID(), targetContacted: false };
  const startedAt = Date.now();
  activeFires++;
  try {
    const result = await breaker.fire(context);
    lastCall = { requestId: context.requestId, mode, outcome: 'SUCCESS', targetContacted: context.targetContacted,
      durationMs: Date.now() - startedAt };
    return response.json({ success: true, result, breaker: getStatus() });
  } catch (error) {
    const isOpen = error.code === 'EOPENBREAKER';
    const isTimeout = error.code === 'ETIMEDOUT';
    lastCall = { requestId: context.requestId, mode, outcome: isOpen ? 'REJECTED' : isTimeout ? 'TIMED_OUT' : 'FAILED',
      targetContacted: context.targetContacted, durationMs: Date.now() - startedAt };
    return response.status(isOpen ? 503 : isTimeout ? 504 : 502).json({
      success: false,
      message: isOpen ? 'Circuit is OPEN: request rejected immediately without contacting the target.'
        : isTimeout ? `Caller stopped waiting after ${TIMEOUT_MS} ms. This does not prove remote failure.`
          : `Target returned a failure: ${error.message}`,
      breaker: getStatus()
    });
  } finally {
    activeFires--;
  }
});

router.get('/status', (_request, response) => response.json({ breaker: getStatus() }));

router.post('/reset', (_request, response) => {
  if (process.env.RESILIENCE_LABS_ENABLED !== 'true') return response.sendStatus(404);
  if (activeFires > 0) return response.status(409).json({ error: 'Wait for active protected requests before resetting.' });
  breaker.removeAllListeners();
  breaker.shutdown();
  downstreamContacts = 0;
  lastCall = null;
  nextProbeAt = null;
  recordEvent('Circuit breaker reset to a clean CLOSED state.');
  breaker = createBreaker();
  return response.json({ success: true, breaker: getStatus() });
});

module.exports = router;
