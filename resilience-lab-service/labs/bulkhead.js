const express = require('express');

const router = express.Router();
const pools = {
  recommendation: { name: 'Recommendation Pool', limit: 2, active: new Map(), admitted: 0, rejected: 0, completed: 0 },
  payment: { name: 'Payment Pool', limit: 1, active: new Map(), admitted: 0, rejected: 0, completed: 0 }
};

function snapshot(pool) {
  return { name: pool.name, limit: pool.limit, occupied: pool.active.size, available: pool.limit - pool.active.size,
    activeRequests: [...pool.active.entries()].map(([requestId, value]) => ({ requestId, ...value })),
    admitted: pool.admitted, rejected: pool.rejected, completed: pool.completed };
}
function allStatus() {
  return { recommendation: snapshot(pools.recommendation), payment: snapshot(pools.payment) };
}

router.get('/status', (_request, response) => response.set('Cache-Control', 'no-store').json({ pools: allStatus() }));

router.post('/reset', (_request, response) => {
  if (process.env.RESILIENCE_LABS_ENABLED !== 'true') return response.sendStatus(404);
  if (Object.values(pools).some(pool => pool.active.size > 0)) {
    return response.status(409).json({ error: 'Wait for active bulkhead requests before resetting.' });
  }
  for (const pool of Object.values(pools)) {
    pool.admitted = 0; pool.rejected = 0; pool.completed = 0;
  }
  return response.json({ success: true, pools: allStatus() });
});

router.get('/', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const poolKey = request.query.pool === 'payment' ? 'payment' : 'recommendation';
  const pool = pools[poolKey];
  const requestId = String(request.query.request || `${poolKey}-${Date.now()}`).slice(0, 80);
  if (pool.active.has(requestId)) {
    return response.status(409).json({ success: false, message: 'This request ID is already active.',
      pool: poolKey, downstreamContacted: false, poolStatus: snapshot(pool) });
  }
  if (pool.active.size >= pool.limit) {
    pool.rejected++;
    return response.status(503).json({ success: false,
      message: `${pool.name} is full. Rejected before contacting the target.`, requestId, pool: poolKey,
      downstreamContacted: false, poolStatus: snapshot(pool) });
  }

  const usedSlots = new Set([...pool.active.values()].map(value => value.slot));
  const slot = Array.from({ length: pool.limit }, (_, index) => index + 1).find(value => !usedSlots.has(value));
  const startedAt = Date.now();
  pool.active.set(requestId, { slot, startedAt: new Date(startedAt).toISOString() });
  pool.admitted++;
  let statusCode;
  let body;
  try {
    const targetResponse = await fetch(`http://resilience-target-service:4010/bulkhead?pool=${poolKey}&requestId=${encodeURIComponent(requestId)}`);
    const targetBody = await targetResponse.json();
    statusCode = targetResponse.status;
    body = { ...targetBody, success: targetResponse.ok, message: `${pool.name} request completed and released slot ${slot}.`,
      requestId, pool: poolKey, slot, downstreamContacted: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    statusCode = 502;
    body = { success: false, message: `Target request failed: ${error.message}`, requestId, pool: poolKey,
      slot, downstreamContacted: true, durationMs: Date.now() - startedAt };
  } finally {
    pool.active.delete(requestId);
    pool.completed++;
  }
  body.poolStatus = snapshot(pool);
  return response.status(statusCode).json(body);
});

module.exports = router;
