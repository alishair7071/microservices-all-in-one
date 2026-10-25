const express = require('express');

const router = express.Router();
const safeCapacity = 3;
const processingDelayMs = 3000;
const activeRequests = new Map();
const counters = { admitted: 0, shed: 0, completed: 0 };

function status() {
  return {
    safeCapacity,
    processingDelayMs,
    active: activeRequests.size,
    available: safeCapacity - activeRequests.size,
    admitted: counters.admitted,
    shed: counters.shed,
    completed: counters.completed,
    activeRequests: [...activeRequests.entries()].map(([requestId, request]) => ({ requestId, ...request }))
  };
}

router.get('/status', (_request, response) => {
  response.set('Cache-Control', 'no-store').json(status());
});

router.post('/reset', (_request, response) => {
  if (process.env.RESILIENCE_LABS_ENABLED !== 'true') return response.sendStatus(404);
  if (activeRequests.size) {
    return response.status(409).json({ error: 'Wait for admitted operations to finish before resetting.', status: status() });
  }
  counters.admitted = 0;
  counters.shed = 0;
  counters.completed = 0;
  return response.json({ success: true, status: status() });
});

router.get('/', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const requestId = String(request.query.request || `load-${Date.now()}`).slice(0, 80);

  if (activeRequests.size >= safeCapacity) {
    counters.shed++;
    return response.status(503).json({
      success: false,
      requestId,
      message: 'Service is at its safe concurrency capacity. This request was shed before work started.',
      executed: false,
      status: status()
    });
  }

  const startedAt = Date.now();
  const usedSlots = new Set([...activeRequests.values()].map(active => active.slot));
  const slot = Array.from({ length: safeCapacity }, (_, index) => index + 1).find(value => !usedSlots.has(value));
  activeRequests.set(requestId, { slot, startedAt: new Date(startedAt).toISOString() });
  counters.admitted++;
  try {
    await new Promise(resolve => setTimeout(resolve, processingDelayMs));
    counters.completed++;
    activeRequests.delete(requestId);
    return response.json({
      success: true,
      requestId,
      message: 'Admitted operation completed safely and released its capacity slot.',
      executed: true,
      durationMs: Date.now() - startedAt,
      status: status()
    });
  } finally { activeRequests.delete(requestId); }
});

module.exports = router;
