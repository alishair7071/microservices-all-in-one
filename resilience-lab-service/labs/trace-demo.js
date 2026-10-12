const express = require('express');
const { logTraceEvent } = require('../correlated-logger');
const { recordDemoRequest } = require('../demo-metrics');

const router = express.Router();

router.post('/', async (request, response) => {
  const startedAt = process.hrtime.bigint();
  let statusCode = 500;

  try {
    const failTarget = request.query.failTarget === '1';
    logTraceEvent('info', 'lab.request.received', { failTarget });
    logTraceEvent('info', 'lab.target.call.started');
    let targetResponse;
    try {
      targetResponse = await fetch('http://resilience-target-service:4010/trace-demo', {
        method: 'POST',
        headers: { 'x-demo-fail-target': failTarget ? '1' : '0' }
      });
    } catch (error) {
      statusCode = 502;
      throw error;
    }
    const target = await targetResponse.json();
    statusCode = targetResponse.ok ? 200 : 502;
    logTraceEvent(targetResponse.ok ? 'info' : 'error', 'lab.target.response.received', {
      targetStatusCode: targetResponse.status
    });
    logTraceEvent(targetResponse.ok ? 'info' : 'error', 'lab.response.sent', { statusCode });
    return response.status(statusCode).json({
      record: target.record || null,
      error: target.error || null
    });
  } catch (error) {
    if (statusCode < 500) statusCode = 500;
    const message = error instanceof Error ? error.message : String(error);
    logTraceEvent('error', 'lab.request.failed', { error: message });
    logTraceEvent('error', 'lab.response.sent', { statusCode });
    if (!response.headersSent) {
      return response.status(statusCode).json({ record: null, error: message });
    }
    response.destroy();
  } finally {
    recordDemoRequest(startedAt, statusCode);
  }
});

module.exports = router;
