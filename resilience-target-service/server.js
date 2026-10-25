const http = require('http');
const { startService } = require('./consul-registration');
const { handleTraceDemo } = require('./trace-demo');

const port = 4010;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const app = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/health') {
    return sendJson(response, 200, { status: 'ok', service: 'resilience-target-service' });
  }

  if (url.pathname === '/trace-demo' && request.method === 'POST') {
    handleTraceDemo(request, response);
    return;
  }

  // Deterministic retry scenarios; only jitter remains intentionally random.
  if (url.pathname === '/retry') {
    const attempt = Number(url.searchParams.get('attempt'));
    const scenario = ['temporary', 'persistent', 'permanent'].includes(url.searchParams.get('scenario'))
      ? url.searchParams.get('scenario') : 'temporary';
    if (!Number.isInteger(attempt) || attempt < 1) {
      return sendJson(response, 400, { error: 'A positive attempt number is required.' });
    }
    if (scenario === 'permanent') {
      return sendJson(response, 400, { success: false, message: 'Invalid demo request: permanent errors are not retryable.', attempt });
    }
    if (scenario === 'persistent' || attempt < 3) {
      return sendJson(response, 503, {
        success: false,
        message: scenario === 'persistent' ? `Dependency is still unavailable on attempt ${attempt}.`
          : `Temporary demo failure on attempt ${attempt}.`,
        attempt
      });
    }
    return sendJson(response, 200, {
      success: true,
      message: 'Demo service recovered and responded successfully.',
      attempt,
      respondedAt: new Date().toISOString()
    });
  }

  if (url.pathname === '/circuit' && process.env.RESILIENCE_LABS_ENABLED === 'true') {
    const mode = url.searchParams.get('mode');
    const requestId = url.searchParams.get('requestId');
    if (mode === 'failing') {
      return sendJson(response, 503, { success: false, error: 'Controlled dependency failure.', requestId, contacted: true });
    }
    const delayMs = mode === 'slow' ? 5000 : 0;
    return setTimeout(() => sendJson(response, 200, {
      success: true,
      message: mode === 'recovered' ? 'Recovered dependency answered the probe.' : 'Healthy dependency responded.',
      mode, requestId, contacted: true, respondedAt: new Date().toISOString()
    }), delayMs);
  }

  if (url.pathname === '/bulkhead' && process.env.RESILIENCE_LABS_ENABLED === 'true') {
    const pool = url.searchParams.get('pool') === 'payment' ? 'payment' : 'recommendation';
    const requestId = url.searchParams.get('requestId');
    const delayMs = pool === 'recommendation' ? 5000 : 800;
    return setTimeout(() => sendJson(response, 200, {
      success: true, pool, requestId, delayMs,
      message: `${pool} dependency completed its simulated work.`,
      respondedAt: new Date().toISOString()
    }), delayMs);
  }

  if (url.pathname !== '/respond') {
    return sendJson(response, 404, { error: 'Route not found' });
  }

  const requestedDelay = Number(url.searchParams.get('delayMs'));
  const delayMs = requestedDelay === 5000 ? 5000 : 0;

  setTimeout(() => {
    sendJson(response, 200, {
      success: true,
      message: 'Downstream demo service responded successfully.',
      delayMs,
      respondedAt: new Date().toISOString()
    });
  }, delayMs);
});

startService(app, 'resilience-target-service', port)
  .then(() => console.log(`Resilience Target Service listening on port ${port}`))
  .catch((error) => { console.error(error); process.exit(1); });
