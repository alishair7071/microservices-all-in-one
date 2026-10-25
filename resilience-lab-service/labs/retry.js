const express = require('express');

const router = express.Router();
const MAX_ATTEMPTS = 3;
const DEADLINE_MS = 2000;
const scenarios = new Set(['temporary', 'persistent', 'permanent']);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function executeRetry(scenario, publish = () => {}) {
  const attempts = [];
  const startedAt = Date.now();

  for (let number = 1; number <= MAX_ATTEMPTS; number++) {
    const attemptStartedAt = Date.now();
    publish({ type: 'attempt-started', number, elapsedMs: attemptStartedAt - startedAt });
    let status;
    let message;
    try {
      const response = await fetch(`http://resilience-target-service:4010/retry?attempt=${number}&scenario=${scenario}`);
      const body = await response.json();
      status = response.status;
      message = body.message || body.error || 'No message returned';
    } catch (error) {
      status = 'NETWORK_ERROR';
      message = error.message;
    }

    const attempt = { number, status, message, durationMs: Date.now() - attemptStartedAt,
      retryable: status === 503 || status === 'NETWORK_ERROR' };
    attempts.push(attempt);
    publish({ type: 'attempt-finished', ...attempt, elapsedMs: Date.now() - startedAt });

    if (status >= 200 && status < 300) {
      return { success: true, reason: 'SUCCESS', message, attempts, maxAttempts: MAX_ATTEMPTS,
        deadlineMs: DEADLINE_MS, elapsedMs: Date.now() - startedAt };
    }
    if (!attempt.retryable) {
      return { success: false, reason: 'PERMANENT_ERROR',
        message: `HTTP ${status} is not retryable, so the operation stopped after one attempt.`,
        attempts, maxAttempts: MAX_ATTEMPTS, deadlineMs: DEADLINE_MS, elapsedMs: Date.now() - startedAt };
    }
    if (number === MAX_ATTEMPTS) break;

    const baseBackoffMs = 200 * 2 ** (number - 1);
    const jitterMs = Math.floor(Math.random() * 101);
    const waitMs = baseBackoffMs + jitterMs;
    if (Date.now() - startedAt + waitMs >= DEADLINE_MS) {
      return { success: false, reason: 'DEADLINE_EXCEEDED',
        message: `The ${DEADLINE_MS} ms overall deadline left no time for another attempt.`,
        attempts, maxAttempts: MAX_ATTEMPTS, deadlineMs: DEADLINE_MS, elapsedMs: Date.now() - startedAt };
    }
    Object.assign(attempt, { baseBackoffMs, jitterMs, waitMs });
    publish({ type: 'waiting', afterAttempt: number, baseBackoffMs, jitterMs, waitMs,
      elapsedMs: Date.now() - startedAt });
    await sleep(waitMs);
  }

  return { success: false, reason: 'ATTEMPTS_EXHAUSTED',
    message: `All ${MAX_ATTEMPTS} permitted attempts failed with retryable errors.`,
    attempts, maxAttempts: MAX_ATTEMPTS, deadlineMs: DEADLINE_MS, elapsedMs: Date.now() - startedAt };
}

function requestedScenario(request) {
  return scenarios.has(request.query.scenario) ? request.query.scenario : 'temporary';
}

router.get('/', async (request, response) => {
  const result = await executeRetry(requestedScenario(request));
  const status = result.success ? 200 : result.reason === 'PERMANENT_ERROR' ? 400 : 503;
  response.status(status).json(result);
});

router.get('/stream', async (request, response) => {
  response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  response.flushHeaders();
  const send = event => response.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
  try {
    const result = await executeRetry(requestedScenario(request), send);
    response.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
  } catch (error) {
    response.write(`event: failed\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
  }
  response.end();
});

module.exports = router;
