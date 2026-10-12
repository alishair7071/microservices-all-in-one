const express = require('express');
const { writeManualLog } = require('../correlated-logger');
const { recordDemoRequest } = require('../demo-metrics');

const router = express.Router();

router.post('/', async (request, response) => {
  const startedAt = process.hrtime.bigint();
  let statusCode = 500;

  try {
    const failTarget = request.query.failTarget === '1';
    writeManualLog('info', 'Lab Service received a trace-demo request from the frontend.', { failTarget });
    writeManualLog('info', 'Lab Service is calling Target Service.');
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
    writeManualLog(targetResponse.ok ? 'info' : 'error', 'Lab Service received a response from Target Service.', {
      targetStatusCode: targetResponse.status
    });
    writeManualLog(targetResponse.ok ? 'info' : 'error', 'Lab Service sent the final response to the frontend.', { statusCode });
    return response.status(statusCode).json({
      record: target.record || null,
      error: target.error || null
    });
  } catch (error) {
    if (statusCode < 500) statusCode = 500;
    const message = error instanceof Error ? error.message : String(error);
    writeManualLog('error', 'Lab Service could not complete the trace-demo request.', { error: message });
    writeManualLog('error', 'Lab Service sent a failed response to the frontend.', { statusCode });
    if (!response.headersSent) {
      return response.status(statusCode).json({ record: null, error: message });
    }
    response.destroy();
  } finally {
    recordDemoRequest(startedAt, statusCode);
  }
});

module.exports = router;
