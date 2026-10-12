const { trace } = require('@opentelemetry/api');

function writeManualLog(level, message, fields = {}) {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: process.env.OTEL_SERVICE_NAME,
    logType: 'manual',
    message,
    traceId: spanContext?.traceId || null,
    spanId: spanContext?.spanId || null,
    ...fields
  }));

  // Jaeger displays these point-in-time events on the current span.
  span?.addEvent(message, { 'log.level': level, ...fields });
}

module.exports = { writeManualLog };
